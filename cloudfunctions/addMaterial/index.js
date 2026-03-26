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
  buildChemicalRefillUpdate
} = require('./inventory-quantity');
const {
  ensureBuiltinZones,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildInventoryLocationPayload
} = require('./warehouse-zones');
const { assertActiveUserAccess } = require('./auth');

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
  const { base, specs, inventory, unique_code } = event; // 接收 unique_code
  const normalizedUniqueCode = normalizeLabelCodeInput(unique_code);

  // 1. 参数校验
  if (!base.name || !base.category || !normalizedUniqueCode) {
    return { success: false, msg: 'Missing required info: name, category, or unique_code' };
  }

  if (!isValidLabelCode(normalizedUniqueCode)) {
    return { success: false, msg: '标签编号格式不正确，应为 L + 6位数字' };
  }

  // 1.2 数量有效性校验 (Security Fix)
  const quantityVal = Number(inventory.quantity_val);
  if (!Number.isFinite(quantityVal) || quantityVal <= 0) {
      return { success: false, msg: '错误：入库数量必须为有效的正数' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行入库');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

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
    const zoneMap = buildZoneMap(filterZoneRecordsByCategory(zoneRecords, base.category));
    const locationPayload = buildInventoryLocationPayload({
      zoneKey: inventory.zone_key,
      locationDetail: inventory.location_detail
    }, zoneMap);

    const existingInventoryRes = await db.collection('inventory').where({
      unique_code: normalizedUniqueCode
    }).get();
    const existingInventory = existingInventoryRes.data && existingInventoryRes.data[0];

    return await db.runTransaction(async transaction => {
      // 2. 写入/验证 Materials 集合
      // MDM 强管控模式：必须查到已有主数据，否则报错
      const materialQuery = await db.collection('materials').where({
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
      const category = materialRecord.category || base.category;
      const materialSpecs = materialRecord.specs || {};
      const defaultUnit = String(materialRecord.default_unit || inventory.quantity_unit || '').trim();
      const productCode = materialRecord.product_code || base.product_code || '';
      const materialName = materialRecord.material_name || base.name;

      if (existingInventory) {
        const canRefill = isChemicalRefillEligible(existingInventory, {
          category,
          product_code: productCode,
          batch_number: inventory.batch_number
        });

        if (!canRefill) {
          throw new Error(`冲突：标签编号 ${normalizedUniqueCode} 已被占用，请尝试重新生成或检查网络`);
        }

        const refillUpdate = buildChemicalRefillUpdate(existingInventory, Number(inventory.quantity_val));
        await transaction.collection('inventory').doc(existingInventory._id).update({
          data: {
            ...refillUpdate.updateData,
            update_time: db.serverDate()
          }
        });

        await transaction.collection('inventory_log').add({
          data: {
            type: 'refill',
            inventory_id: existingInventory._id,
            material_id: materialId,
            material_name: materialName,
            category,
            product_code: productCode,
            unique_code: normalizedUniqueCode,
            quantity_change: Number(inventory.quantity_val),
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
          }
        });

        return {
          success: true,
          materialId,
          inventoryId: existingInventory._id,
          uniqueCode: normalizedUniqueCode,
          action: 'refill'
        };
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
        supplier: materialRecord.supplier || base.supplier || '',
        supplier_model: materialRecord.supplier_model || base.supplier_model || '',
        ...locationPayload,
        status: 'in_stock',
        quantity: {
          val: Number(inventory.quantity_val),
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

      let logQuantityChange = Number(inventory.quantity_val);
      let logUnit = defaultUnit || '份';

      if (category === 'chemical') {
        invData.batch_number = inventory.batch_number;
        // 化材动态属性: 重量
        if (inventory.weight_kg) {
             invData.dynamic_attrs = { weight_kg: Number(inventory.weight_kg) };
        }
      } else if (category === 'film') {
         invData.batch_number = inventory.batch_number; // 膜材也有批号
         const resolvedWidthMm = normalizePositiveNumber(
           specs.standard_width_mm !== undefined
             ? specs.standard_width_mm
             : (
               specs.width_mm !== undefined
                 ? specs.width_mm
                 : (
                   materialSpecs.standard_width_mm !== undefined
                     ? materialSpecs.standard_width_mm
                     : materialSpecs.width_mm
                 )
             )
         );
         const inboundThicknessUm = normalizePositiveNumber(
           specs.thickness_um !== undefined
             ? specs.thickness_um
             : (specs && specs.thickness_um)
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

         if (thicknessGovernance.shouldBackfillMasterThickness || shouldBackfillMasterWidth) {
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
           Number(inventory.length_m || 0),
           defaultUnit,
           resolvedWidthMm,
           Number(inventory.length_m || 0)
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

      // 5. 写入 inventory_log 集合 (原 logs 集合)
      await transaction.collection('inventory_log').add({
         data: {
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
         }
      });

      return {
        success: true,
        materialId: materialId,
        inventoryId: invRes._id,
        uniqueCode: normalizedUniqueCode
      };
    });

    return result;

  } catch (err) {
    console.error('Transaction failed', err);
    return {
      success: false,
      msg: err.message || 'Database transaction failed'
    };
  }
};
