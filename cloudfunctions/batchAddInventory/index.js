// cloudfunctions/batchAddInventory/index.js
const cloud = require('wx-server-sdk');
const {
  assertBatchInventoryItemLimit,
  assertUniqueCodes,
  buildBatchInventoryPayload
} = require('./batch-add');
const { assertActiveUserAccess } = require('./auth');
const {
  isChemicalRefillEligible,
  buildChemicalRefillUpdate
} = require('./inventory-quantity');
const {
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildInventoryLocationPayload
} = require('./warehouse-zones');
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
const {
  normalizeTestMaterialSupplierModel
} = require('./test-material-identities');

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

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

async function loadTestMaterialIdentitiesForMaterials(materials = []) {
  const productCodes = Array.from(new Set(
    (materials || [])
      .filter(item => item && item.is_test_material)
      .map(item => normalizeText(item.product_code))
      .filter(Boolean)
  ));
  if (!productCodes.length) {
    return [];
  }

  const rows = [];
  for (let index = 0; index < productCodes.length; index += 50) {
    const codes = productCodes.slice(index, index + 50);
    const res = await db.collection('test_material_identities').where({
      product_code: _.in(codes)
    }).get();
    rows.push(...(res.data || []));
  }
  return rows;
}

function normalizePositiveSpec(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function resolvePreprintFilmSpecs(preprintLabel = {}) {
  const specs = preprintLabel.specs || {};
  return {
    thickness_um: normalizePositiveSpec(specs.thickness_um),
    width_mm: normalizePositiveSpec(specs.width_mm !== undefined ? specs.width_mm : specs.standard_width_mm)
  };
}

function buildFilmMasterSpecUpdateFromCurrent(material = {}, backfill = {}, rowLabel = '') {
  const specs = material && material.specs ? material.specs : {};
  const updateData = {};
  const prefix = rowLabel || '';

  if (backfill.thickness_um !== undefined) {
    const currentThickness = normalizePositiveSpec(specs.thickness_um);
    if (currentThickness && currentThickness !== backfill.thickness_um) {
      throw new Error(`${prefix}膜材厚度已被其他入库补齐为 ${currentThickness} μm，请核实规格后重试`);
    }
    if (!currentThickness) {
      updateData['specs.thickness_um'] = backfill.thickness_um;
    }
  }

  if (backfill.standard_width_mm !== undefined) {
    const currentWidth = normalizePositiveSpec(
      specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm
    );
    if (currentWidth && currentWidth !== backfill.standard_width_mm) {
      throw new Error(`${prefix}膜材默认幅宽已被其他入库补齐为 ${currentWidth} mm，请核实规格后重试`);
    }
    if (!currentWidth) {
      updateData['specs.standard_width_mm'] = backfill.standard_width_mm;
    }
  }

  return updateData;
}

function assertPreprintSourceConsistency(preprintLabel, inventoryData = {}, rowLabel = '') {
  if (!preprintLabel) {
    return;
  }

  const prefix = rowLabel || '';
  const preprintSupplierModel = normalizeTestMaterialSupplierModel(preprintLabel.supplier_model);
  const inboundSupplierModel = normalizeTestMaterialSupplierModel(inventoryData.supplier_model);
  if (preprintSupplierModel && inboundSupplierModel && preprintSupplierModel !== inboundSupplierModel) {
    throw new Error(`${prefix}预生成标签原厂型号与当前入库信息不一致`);
  }

  if (inventoryData.category === 'film') {
    const preprintSpecs = resolvePreprintFilmSpecs(preprintLabel);
    const inboundAttrs = inventoryData.dynamic_attrs || {};
    const inboundThickness = normalizePositiveSpec(inboundAttrs.thickness_um);
    const inboundWidth = normalizePositiveSpec(inboundAttrs.width_mm);
    if ((preprintSpecs.thickness_um && inboundThickness && preprintSpecs.thickness_um !== inboundThickness)
        || (preprintSpecs.width_mm && inboundWidth && preprintSpecs.width_mm !== inboundWidth)) {
      throw new Error(`${prefix}与预生成标签规格不一致`);
    }
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { items } = event;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, msg: '未提供待入库数据' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行批量入库');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    assertBatchInventoryItemLimit(items.length);
    assertUniqueCodes(items);
    const operationContext = buildOperationReceiptContext({
      openid: OPENID,
      operationId: event.operation_id,
      requestPayload: { items }
    });

    const materialIds = Array.from(new Set(
      items.map(item => item && item.material_id).filter(Boolean)
    ));

    if (materialIds.length !== items.length && items.some(item => !item || !item.material_id)) {
      return { success: false, msg: '存在缺少物料主数据标识的入库项' };
    }

    const materialRes = await db.collection('materials')
      .where({ _id: _.in(materialIds) })
      .get();
    const materialMap = new Map((materialRes.data || []).map(item => [item._id, item]));
    const inactiveMaterial = Array.from(materialMap.values()).find(item => item.status !== 'active');
    if (inactiveMaterial) {
      return {
        success: false,
        msg: `产品代码 ${inactiveMaterial.product_code || ''} 未启用，不能入库`
      };
    }
    const missingUnitMaterial = Array.from(materialMap.values()).find(item => !String(item.default_unit || '').trim());
    if (missingUnitMaterial) {
      return {
        success: false,
        msg: `产品代码 ${missingUnitMaterial.product_code || ''} 缺少主数据默认单位，不能入库`
      };
    }
    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const detailRecords = await ensureBuiltinLocationDetails(db, zoneRecords);
    const detailMapByZone = buildLocationDetailMapByZone(detailRecords);
    const zoneMaps = {
      chemical: buildZoneMap(filterZoneRecordsByCategory(zoneRecords, 'chemical')),
      film: buildZoneMap(filterZoneRecordsByCategory(zoneRecords, 'film'))
    };

    const testMaterialIdentities = await loadTestMaterialIdentitiesForMaterials(Array.from(materialMap.values()));
    const preparedItems = items.map((item, index) => {
      const prepared = buildBatchInventoryPayload(item, materialMap.get(item.material_id), index, {
        testMaterialIdentities
      });
      const category = prepared.inventoryData.category === 'film' ? 'film' : 'chemical';
      const locationPayload = buildInventoryLocationPayload({
        zoneKey: item && item.zone_key,
        locationDetailKey: item && item.location_detail_key,
        locationDetail: item && item.location_detail
      }, zoneMaps[category], detailMapByZone);

      prepared.inventoryData = Object.assign({}, prepared.inventoryData, locationPayload);
      return prepared;
    });

    return await db.runTransaction(async transaction => {
      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      const ids = [];
      const preprintJobUsageCounts = new Map();

      for (let i = 0; i < preparedItems.length; i += 1) {
        const prepared = preparedItems[i];
        const inventoryData = Object.assign({}, prepared.inventoryData, {
          create_time: db.serverDate(),
          update_time: db.serverDate()
        });
        if (prepared.masterSpecBackfill && Object.keys(prepared.masterSpecBackfill).length > 0) {
          const currentMaterialRes = await transaction.collection('materials')
            .doc(inventoryData.material_id)
            .get();
          const currentMaterial = currentMaterialRes.data || {};
          const materialSpecUpdate = buildFilmMasterSpecUpdateFromCurrent(
            currentMaterial,
            prepared.masterSpecBackfill,
            `第${i + 1}条`
          );

          if (Object.keys(materialSpecUpdate).length > 0) {
            await transaction.collection('materials').doc(inventoryData.material_id).update({
              data: {
                ...materialSpecUpdate,
                updated_by: OPENID,
                updated_at: db.serverDate()
              }
            });
          }
        }

        const exist = await transaction.collection('inventory').where({
          unique_code: inventoryData.unique_code
        }).get();

        if (exist.data && exist.data.length > 0) {
          const existingItem = exist.data[0];
          const submitAction = normalizeText(prepared.rawItem && prepared.rawItem.submit_action) || 'create';
          const refillInventoryId = normalizeText(prepared.rawItem && prepared.rawItem.refill_inventory_id);

          // 化材补料条件：同产品代码、同批号、在库状态
          if (
            submitAction === 'refill'
            &&
            inventoryData.category === 'chemical'
            && isChemicalRefillEligible(existingItem, {
              category: inventoryData.category,
              product_code: inventoryData.product_code,
              batch_number: inventoryData.batch_number,
              supplier_model: inventoryData.supplier_model,
              supplier_model_key: inventoryData.supplier_model_key,
              is_test_material: inventoryData.is_test_material,
              quantity: inventoryData.quantity
            })
          ) {
            if (!refillInventoryId || refillInventoryId !== existingItem._id) {
              throw new Error(`第${i + 1}条补料目标库存不一致，请刷新后重试`);
            }
            const addQty = (inventoryData.quantity && inventoryData.quantity.val) || 0;
            const refillUpdate = buildChemicalRefillUpdate(existingItem, addQty);

            await transaction.collection('inventory').doc(existingItem._id).update({
              data: {
                ...refillUpdate.updateData,
                update_time: db.serverDate()
              }
            });

            // 写 refill 类型日志
            const refillLog = Object.assign({}, prepared.logData, {
                type: 'refill',
                description: '补料入库',
                inventory_id: existingItem._id,
                operator: (operator && operator.name) || 'System',
                operator_id: OPENID,
                _openid: OPENID,
                timestamp: db.serverDate()
            });
            await transaction.collection('inventory_log').add({
              data: refillLog
            });
            await writeInventoryAuditEvent(transaction, db, refillLog, {
              operationId: operationContext.operationId
            });

            ids.push(existingItem._id);
            continue;
          }

          // 非化材或不满足补料条件：冲突回滚
          throw new Error(`冲突：标签编号 ${inventoryData.unique_code} 已存在，如需补料请明确选择补料入库，批量操作已回滚`);
        }

        const preprintLabelId = String(prepared.rawItem && prepared.rawItem.preprint_label_id || '').trim();
        let preprintLabel = null;
        let preprintJob = null;
        if (preprintLabelId) {
          const preprintRes = await transaction.collection('preprinted_labels').doc(preprintLabelId).get();
          preprintLabel = preprintRes.data || null;
        } else {
          const preprintRes = await transaction.collection('preprinted_labels').where({
            unique_code: inventoryData.unique_code
          }).get();
          preprintLabel = preprintRes.data && preprintRes.data[0];
        }

        if (preprintLabel) {
          if (preprintLabel.unique_code !== inventoryData.unique_code) {
            throw new Error(`第${i + 1}条预生成标签编号与当前入库标签不一致`);
          }
          if (preprintLabel.status !== 'unused') {
            throw new Error(preprintLabel.status === 'voided'
              ? `第${i + 1}条预生成标签已作废，不能入库`
              : `第${i + 1}条预生成标签已入库，不能重复使用`);
          }
          if (preprintLabel.material_id && preprintLabel.material_id !== inventoryData.material_id) {
            throw new Error(`第${i + 1}条预生成标签不属于当前物料`);
          }
          if (preprintLabel.product_code && preprintLabel.product_code !== inventoryData.product_code) {
            throw new Error(`第${i + 1}条预生成标签不属于当前物料`);
          }
          if (preprintLabel.category && preprintLabel.category !== inventoryData.category) {
            throw new Error(`第${i + 1}条预生成标签类型与当前物料不一致`);
          }
          assertPreprintSourceConsistency(preprintLabel, inventoryData, `第${i + 1}条`);
          preprintJob = await loadPreprintJobForLabel(transaction, preprintLabel);
          assertPreprintJobConsumable(preprintJob);
        }

        const addRes = await transaction.collection('inventory').add({
          data: inventoryData
        });

        if (preprintLabel) {
          await transaction.collection('preprinted_labels').doc(preprintLabel._id).update({
            data: {
              status: 'used',
              inventory_id: addRes._id,
              used_time: db.serverDate(),
              update_time: db.serverDate()
            }
          });
          if (preprintJob) {
            preprintJobUsageCounts.set(
              preprintJob.job_id,
              (preprintJobUsageCounts.get(preprintJob.job_id) || 0) + 1
            );
          }
        }

        const inboundLog = Object.assign({}, prepared.logData, {
            inventory_id: addRes._id,
            operator: (operator && operator.name) || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate()
        });
        await transaction.collection('inventory_log').add({
          data: inboundLog
        });
        await writeInventoryAuditEvent(transaction, db, inboundLog, {
          operationId: operationContext.operationId
        });

        ids.push(addRes._id);
      }

      for (const [jobId, usedCount] of preprintJobUsageCounts.entries()) {
        await transaction.collection('preprint_jobs').doc(jobId).update({
          data: {
            used_count: _.inc(usedCount),
            updated_at: db.serverDate()
          }
        });
      }

      const response = {
        success: true,
        total: ids.length,
        ids
      };
      await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      return response;
    });
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
