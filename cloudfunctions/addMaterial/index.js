// cloudfunctions/addMaterial/index.js
const cloud = require('wx-server-sdk');
const { buildFilmInventoryState } = require('./film-quantity');
const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('./label-code');
const {
  normalizePositiveNumber,
  resolveFilmThicknessGovernance
} = require('./thickness-governance');
const {
  isChemicalRefillEligible,
  buildChemicalRefillUpdate,
  parseChemicalQuantity,
  parsePositiveIntegerMeters,
  buildInventoryIdentityKey
} = require('./inventory-quantity');
const {
  isTestMaterial,
  buildTestMaterialStockInValidation,
  resolveInventorySourceText
} = require('./test-material');
const {
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildInventoryLocationPayload
} = require('./warehouse-zones');
const { assertActiveUserAccess } = require('./auth');
const {
  assertPreprintJobConsumable,
  loadPreprintJobForLabel
} = require('./preprint-jobs');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded
} = require('./operation-receipts');
const { writeInventoryAuditEvent } = require('./audit-events');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return res.data && res.data[0] ? res.data[0] : null;
}

function resolvePreprintFilmSpecs(preprintLabel = {}) {
  const specs = preprintLabel.specs || {};
  return {
    thickness_um: normalizePositiveNumber(specs.thickness_um),
    width_mm: normalizePositiveNumber(specs.width_mm !== undefined ? specs.width_mm : specs.standard_width_mm)
  };
}

function alignFilmSpecsWithPreprint(specs = {}, preprintLabel = {}) {
  const preprintSpecs = resolvePreprintFilmSpecs(preprintLabel);
  const nextSpecs = { ...specs };

  if (preprintSpecs.thickness_um) {
    const inboundThickness = normalizePositiveNumber(nextSpecs.thickness_um);
    if (inboundThickness && inboundThickness !== preprintSpecs.thickness_um) {
      throw new Error('与预生成标签规格不一致');
    }
    nextSpecs.thickness_um = preprintSpecs.thickness_um;
  }

  if (preprintSpecs.width_mm) {
    const inboundWidth = normalizePositiveNumber(
      nextSpecs.standard_width_mm !== undefined ? nextSpecs.standard_width_mm : nextSpecs.width_mm
    );
    if (inboundWidth && inboundWidth !== preprintSpecs.width_mm) {
      throw new Error('与预生成标签规格不一致');
    }
    nextSpecs.standard_width_mm = preprintSpecs.width_mm;
  }

  return nextSpecs;
}

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function assertPreprintSourceConsistency(preprintLabel, source = {}) {
  if (!preprintLabel) {
    return;
  }

  const preprintSupplierModel = normalizeText(preprintLabel.supplier_model);
  const inboundSupplierModel = normalizeText(source.supplier_model);
  if (preprintSupplierModel && inboundSupplierModel && preprintSupplierModel !== inboundSupplierModel) {
    throw new Error('预生成标签原厂型号与当前入库信息不一致');
  }
}

function normalizeExplicitExpiryDate(value) {
  if (!value) {
    return {
      ok: true,
      value: null
    };
  }

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      msg: '过期日期格式不正确'
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const normalizedDate = new Date(parsed.getTime());
  normalizedDate.setHours(0, 0, 0, 0);
  if (normalizedDate.getTime() < today.getTime()) {
    return {
      ok: false,
      msg: '过期日期不能早于当天'
    };
  }

  return {
    ok: true,
    value: parsed
  };
}

// 生成唯一码: 前缀 + 年月日 + 4位随机
function generateUniqueCode(prefix) {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${yyyy}${mm}${dd}-${random}`;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
    base = {},
    specs = {},
    inventory = {},
    unique_code
  } = event; // 接收 unique_code
  const normalizedUniqueCode = normalizeLabelCodeInput(unique_code);
  const preprintLabelId = String(event.preprint_label_id || '').trim();
  const submitAction = normalizeText(event.submit_action || 'create') || 'create';
  const refillInventoryId = normalizeText(event.refill_inventory_id);

  // 1. 参数校验
  if (!base.product_code || !normalizedUniqueCode) {
    return { success: false, msg: 'Missing required info: product_code or unique_code' };
  }

  if (!isValidLabelCode(normalizedUniqueCode)) {
    return { success: false, msg: '标签编号格式不正确，应为 L + 6位数字' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行入库');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }
    const operationContext = buildOperationReceiptContext({
      openid: OPENID,
      operationId: event.operation_id,
      requestPayload: {
        base,
        specs,
        inventory,
        unique_code: normalizedUniqueCode,
        preprint_label_id: preprintLabelId,
        submit_action: submitAction,
        refill_inventory_id: refillInventoryId
      }
    });

    const hasExpiryDate = !!inventory.expiry_date;
    const isLongTermValid = !!inventory.is_long_term_valid;

    if (!hasExpiryDate && !isLongTermValid) {
      return { success: false, msg: '必须填写过期日期或明确设为长期有效' };
    }

    if (hasExpiryDate && isLongTermValid) {
      return { success: false, msg: '过期日期和长期有效不能同时设置' };
    }

    const explicitExpiryState = normalizeExplicitExpiryDate(hasExpiryDate ? inventory.expiry_date : null);
    if (!explicitExpiryState.ok) {
      return { success: false, msg: explicitExpiryState.msg };
    }
    const explicitExpiryDate = explicitExpiryState.value;

    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const detailRecords = await ensureBuiltinLocationDetails(db, zoneRecords);
    const detailMapByZone = buildLocationDetailMapByZone(detailRecords);

    return await db.runTransaction(async transaction => {
      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      const existingInventoryRes = await transaction.collection('inventory').where({
        unique_code: normalizedUniqueCode
      }).get();
      const existingInventory = existingInventoryRes.data && existingInventoryRes.data[0];

      // 2. 写入/验证 Materials 集合
      // MDM 强管控模式：必须查到已有主数据，否则报错
      const materialQuery = await transaction.collection('materials').where({
          product_code: base.product_code
      }).get();

      let materialId;
      if (materialQuery.data.length > 0) {
          // 已存在：复用该主数据 ID
          materialId = materialQuery.data[0]._id;
      } else {
          // 不存在：禁止入库！
          throw new Error(`产品代码 ${base.product_code} 未在标准库中，请先申请建档`);
      }

      /* 废弃：不再自动新建主数据
      const materialRes = await transaction.collection('materials').add({
        data: {
          ...base,
          // ...
        }
      });
      materialId = materialRes._id;
      */

      const materialRecord = materialQuery.data[0];
      if (materialRecord.status !== 'active') {
        throw new Error(`产品代码 ${base.product_code} 未启用，不能入库`);
      }
      const category = materialRecord.category || base.category;
      const materialSpecs = materialRecord.specs || {};
      const defaultUnit = String(materialRecord.default_unit || '').trim();
      if (!defaultUnit) {
        throw new Error(`产品代码 ${base.product_code} 缺少主数据默认单位，请先联系管理员维护`);
      }
      const productCode = materialRecord.product_code || base.product_code || '';
      const materialName = materialRecord.material_name || base.name;
      const isTest = isTestMaterial(materialRecord, base);
      const normalizedQuantityVal = category === 'film'
        ? parsePositiveIntegerMeters(inventory.length_m, '膜材入库长度')
        : parseChemicalQuantity(inventory.quantity_val, '入库数量');
      const zoneMap = buildZoneMap(filterZoneRecordsByCategory(zoneRecords, category));
      const locationPayload = buildInventoryLocationPayload({
        zoneKey: inventory.zone_key,
        locationDetailKey: inventory.location_detail_key,
        locationDetail: inventory.location_detail
      }, zoneMap, detailMapByZone);

      if (existingInventory) {
        if (submitAction !== 'refill') {
          throw new Error(`标签编号 ${normalizedUniqueCode} 已存在，如需补料请明确选择补料入库`);
        }
        if (!refillInventoryId || refillInventoryId !== existingInventory._id) {
          throw new Error(`标签编号 ${normalizedUniqueCode} 的补料目标库存不一致，请刷新后重试`);
        }
        const canRefill = isChemicalRefillEligible(existingInventory, {
          category,
          product_code: productCode,
          batch_number: inventory.batch_number,
          supplier_model: base.supplier_model,
          is_test_material: isTest,
          quantity: { unit: defaultUnit }
        });

        if (!canRefill) {
          throw new Error(`冲突：标签编号 ${normalizedUniqueCode} 已被占用，请尝试重新生成或检查网络`);
        }

        const refillUpdate = buildChemicalRefillUpdate(existingInventory, normalizedQuantityVal);
        await transaction.collection('inventory').doc(existingInventory._id).update({
          data: {
            ...refillUpdate.updateData,
            update_time: db.serverDate()
          }
        });

        const refillLog = {
            type: 'refill',
            inventory_id: existingInventory._id,
            material_id: materialId,
            material_name: materialName,
            category,
            product_code: productCode,
            unique_code: normalizedUniqueCode,
            quantity_change: normalizedQuantityVal,
            spec_change_unit: existingInventory.quantity && existingInventory.quantity.unit
              ? existingInventory.quantity.unit
              : (defaultUnit || '份'),
            unit: existingInventory.quantity && existingInventory.quantity.unit
              ? existingInventory.quantity.unit
              : (defaultUnit || '份'),
            operator: (operator && operator.name) || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate(),
            description: '补料入库'
        };
        await transaction.collection('inventory_log').add({ data: refillLog });
        await writeInventoryAuditEvent(transaction, db, refillLog, {
          operationId: operationContext.operationId
        });

        const response = {
          success: true,
          materialId,
          inventoryId: existingInventory._id,
          uniqueCode: normalizedUniqueCode,
          action: 'refill'
        };
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
        return response;
      }

      let preprintLabel = null;
      let preprintJob = null;
      if (preprintLabelId) {
        const preprintRes = await transaction.collection('preprinted_labels').doc(preprintLabelId).get();
        preprintLabel = preprintRes.data || null;
      } else {
        const preprintRes = await transaction.collection('preprinted_labels').where({
          unique_code: normalizedUniqueCode
        }).get();
        preprintLabel = preprintRes.data && preprintRes.data[0];
      }
      if (preprintLabel) {
        if (preprintLabel.unique_code !== normalizedUniqueCode) {
          throw new Error('预生成标签编号与当前入库标签不一致');
        }
        if (preprintLabel.status !== 'unused') {
          throw new Error(preprintLabel.status === 'voided'
            ? '该预生成标签已作废，不能入库'
            : '该预生成标签已入库，不能重复使用');
        }
        if (preprintLabel.material_id && preprintLabel.material_id !== materialId) {
          throw new Error('预生成标签不属于当前物料');
        }
        if (preprintLabel.product_code && preprintLabel.product_code !== productCode) {
          throw new Error('预生成标签不属于当前物料');
        }
        if (preprintLabel.category && preprintLabel.category !== category) {
          throw new Error('预生成标签类型与当前物料不一致');
        }
        preprintJob = await loadPreprintJobForLabel(transaction, preprintLabel);
        assertPreprintJobConsumable(preprintJob);
      }

      assertPreprintSourceConsistency(preprintLabel, base);
      const sourceBase = preprintLabel
        ? {
          ...base,
          supplier: preprintLabel.supplier || base.supplier,
          supplier_model: preprintLabel.supplier_model || base.supplier_model,
          sample_note: preprintLabel.sample_note || base.sample_note
        }
        : base;
      const supplier = resolveInventorySourceText({ material: materialRecord, item: sourceBase, field: 'supplier' });
      const supplierModel = resolveInventorySourceText({ material: materialRecord, item: sourceBase, field: 'supplier_model' });
      const sampleNote = String((inventory && inventory.sample_note) || (sourceBase && sourceBase.sample_note) || '').trim();
      const testMaterialValidation = buildTestMaterialStockInValidation({
        ...sourceBase,
        batch_number: inventory.batch_number
      }, materialRecord);
      if (!testMaterialValidation.ok) {
        throw new Error(testMaterialValidation.msg);
      }

      // 4. 写入 Inventory 集合
      const invData = {
        material_id: materialId,
        material_name: materialName,
        category,
        subcategory_key: materialRecord.subcategory_key || '',
        sub_category: materialRecord.sub_category || '',
        product_code: productCode,
        unique_code: normalizedUniqueCode, // 使用传入的 code
        supplier,
        supplier_model: supplierModel,
        sample_note: sampleNote,
        is_test_material: isTest,
        identity_key: buildInventoryIdentityKey({
          product_code: productCode,
          is_test_material: isTest,
          supplier_model: supplierModel
        }),
        ...locationPayload,
        status: 'in_stock',
        quantity: {
          val: normalizedQuantityVal,
          unit: defaultUnit
        },
        create_time: db.serverDate(),
        update_time: db.serverDate()
      };

      if (explicitExpiryDate) {
        invData.expiry_date = explicitExpiryDate;
      }
      if (inventory.is_long_term_valid) {
        invData.is_long_term_valid = true;
      }

      let logQuantityChange = normalizedQuantityVal;
      let logUnit = defaultUnit || '份';

      if (category === 'chemical') {
        invData.batch_number = inventory.batch_number;
        // 化材动态属性: 重量
        invData.dynamic_attrs = { weight_kg: normalizedQuantityVal };
      } else if (category === 'film') {
         invData.batch_number = inventory.batch_number; // 膜材也有批号
         const filmSpecs = alignFilmSpecsWithPreprint(specs, preprintLabel);
         const resolvedWidthMm = normalizePositiveNumber(
           filmSpecs.standard_width_mm !== undefined
             ? filmSpecs.standard_width_mm
             : (
               filmSpecs.width_mm !== undefined
                 ? filmSpecs.width_mm
                 : (
                   materialSpecs.standard_width_mm !== undefined
                     ? materialSpecs.standard_width_mm
                     : materialSpecs.width_mm
                 )
             )
         );
         const inboundThicknessUm = normalizePositiveNumber(
           filmSpecs.thickness_um !== undefined
             ? filmSpecs.thickness_um
             : (filmSpecs && filmSpecs.thickness_um)
         );
         const thicknessGovernance = resolveFilmThicknessGovernance({
           materialThicknessUm: materialSpecs.thickness_um,
           inboundThicknessUm
         });
         const resolvedThicknessUm = thicknessGovernance.resolvedThicknessUm;

         if (!resolvedWidthMm) {
           throw new Error('膜材入库缺少有效宽度');
         }

         if (!resolvedThicknessUm) {
           throw new Error('膜材入库缺少有效厚度');
         }

         const materialWidthMm = normalizePositiveNumber(
           materialSpecs.standard_width_mm !== undefined
             ? materialSpecs.standard_width_mm
             : materialSpecs.width_mm
         );
         const shouldBackfillMasterWidth = !materialWidthMm && !!resolvedWidthMm;

         if (!isTest && (thicknessGovernance.shouldBackfillMasterThickness || shouldBackfillMasterWidth)) {
           const materialUpdateData = {
             updated_by: OPENID,
             updated_at: db.serverDate()
           };
           if (thicknessGovernance.shouldBackfillMasterThickness) {
             materialUpdateData['specs.thickness_um'] = thicknessGovernance.inboundThicknessUm;
           }
           if (shouldBackfillMasterWidth) {
             materialUpdateData['specs.standard_width_mm'] = resolvedWidthMm;
           }
           await transaction.collection('materials').doc(materialId).update({
             data: materialUpdateData
           });
         }

         const filmState = buildFilmInventoryState(
           normalizedQuantityVal,
           defaultUnit,
           resolvedWidthMm,
           normalizedQuantityVal
         );
         invData.quantity.val = filmState.quantityVal;
         invData.quantity.unit = filmState.quantityUnit;
         invData.dynamic_attrs = {
             current_length_m: filmState.currentLengthM,
             initial_length_m: filmState.initialLengthM,
             width_mm: resolvedWidthMm,
             thickness_um: resolvedThicknessUm,
             current_roll_diameter_mm: 0 // 初始卷径未知可填0
         };
         logQuantityChange = filmState.currentLengthM;
         logUnit = 'm';
      }

      const invRes = await transaction.collection('inventory').add({
        data: invData
      });

      if (preprintLabel) {
        await transaction.collection('preprinted_labels').doc(preprintLabel._id).update({
          data: {
            status: 'used',
            inventory_id: invRes._id,
            used_time: db.serverDate(),
            update_time: db.serverDate()
          }
        });
        if (preprintJob) {
          await transaction.collection('preprint_jobs').doc(preprintJob.job_id).update({
            data: {
              used_count: _.inc(1),
              updated_at: db.serverDate()
            }
          });
        }
      }

      // 5. 写入 inventory_log 集合 (原 logs 集合)
      const inboundLog = {
            type: 'inbound', // 初始入库
            inventory_id: invRes._id,
            material_id: materialId,
            material_name: materialName,
            category, // Added for Log Display Logic
            product_code: productCode, // Added for Log Display Logic
            quantity_change: logQuantityChange,
            spec_change_unit: logUnit,
            unit: logUnit,
            operator: (operator && operator.name) || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate(),
            description: '初始录入'
      };
      await transaction.collection('inventory_log').add({ data: inboundLog });
      await writeInventoryAuditEvent(transaction, db, inboundLog, {
        operationId: operationContext.operationId
      });

      const response = {
        success: true,
        materialId: materialId,
        inventoryId: invRes._id,
        uniqueCode: normalizedUniqueCode
      };
      await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      return response;
    });

  } catch (err) {
    console.error('Transaction failed', err);
    return {
      success: false,
      msg: err.message || 'Database transaction failed'
    };
  }
};
