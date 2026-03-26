const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  isChemicalRefillEligible,
  buildChemicalRefillUpdate
} = require('./inventory-quantity');
const {
  isInventoryTemplateGroupHeaderRow,
  isInventoryTemplateHeaderRow,
  isInventoryTemplateInlineHintRow,
  validateInventoryTemplateHeaderRows,
  buildEmptyInventoryTemplatePreviewResult,
  normalizeLabelCodeInput,
  collectInventoryImportLookupKeys,
  buildZoneMapsByCategory,
  buildInventoryImportPreviewRow,
  decorateInventoryImportPreviewRows,
  buildInventoryImportPayload
} = require('./inventory-import');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function chunkArray(list = [], size = 50) {
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
}

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

async function loadActiveZoneRecords() {
  const rows = [];
  let skip = 0;

  while (true) {
    try {
      const res = await db.collection('warehouse_zones').skip(skip).limit(100).get();
      const batch = res.data || [];
      rows.push(...batch);
      if (batch.length < 100) {
        break;
      }
      skip += 100;
    } catch (_error) {
      break;
    }
  }

  return rows;
}

async function loadMaterialsByCodes(productCodes = []) {
  const rows = [];
  for (const codes of chunkArray(productCodes, 50)) {
    if (!codes.length) {
      continue;
    }
    const res = await db.collection('materials').where({
      product_code: _.in(codes)
    }).get();
    rows.push(...(res.data || []));
  }
  return new Map(rows.map(item => [String(item.product_code || '').trim(), item]));
}

async function loadExistingUniqueCodes(uniqueCodes = []) {
  const rows = [];
  for (const codes of chunkArray(uniqueCodes, 50)) {
    if (!codes.length) {
      continue;
    }
    const res = await db.collection('inventory').where({
      unique_code: _.in(codes)
    }).get();
    rows.push(...(res.data || []));
  }
  return new Set(rows.map(item => String(item.unique_code || '').trim()).filter(Boolean));
}

async function loadExistingInventoryByUniqueCodes(uniqueCodes = []) {
  const rows = [];
  for (const codes of chunkArray(uniqueCodes, 50)) {
    if (!codes.length) {
      continue;
    }
    const res = await db.collection('inventory').where({
      unique_code: _.in(codes)
    }).get();
    rows.push(...(res.data || []));
  }

  return new Map(
    rows
      .map(item => [String(item.unique_code || '').trim(), item])
      .filter(([uniqueCode]) => !!uniqueCode)
  );
}

async function loadCurrentInStockInventoryByCodes(productCodes = []) {
  const grouped = new Map();

  for (const codes of chunkArray(productCodes, 20)) {
    if (!codes.length) {
      continue;
    }

    let skip = 0;
    while (true) {
      const res = await db.collection('inventory').where({
        product_code: _.in(codes),
        status: 'in_stock'
      }).skip(skip).limit(100).field({
        product_code: true,
        category: true,
        status: true,
        unique_code: true,
        batch_number: true,
        quantity: true,
        dynamic_attrs: true
      }).get();

      const batch = res.data || [];
      batch.forEach((item) => {
        const productCode = String(item.product_code || '').trim();
        if (!productCode) {
          return;
        }
        if (!grouped.has(productCode)) {
          grouped.set(productCode, []);
        }
        grouped.get(productCode).push(item);
      });

      if (batch.length < 100) {
        break;
      }
      skip += 100;
    }
  }

  return grouped;
}

function normalizeRawRows(rawRows = []) {
  const headerCheck = validateInventoryTemplateHeaderRows(rawRows);
  const dataStartRowIndex = headerCheck.ok && headerCheck.details && headerCheck.details.dataStartRowIndex
    ? Number(headerCheck.details.dataStartRowIndex)
    : 4;

  return (Array.isArray(rawRows) ? rawRows : [])
    .map((item, index) => {
      if (item && Array.isArray(item.values)) {
        return {
          rowIndex: Number(item.rowIndex) || index + 2,
          values: item.values
        };
      }
      if (Array.isArray(item)) {
        return {
          rowIndex: index + 2,
          values: item
        };
      }
      return null;
    })
    .filter(Boolean)
    .filter(item => Array.isArray(item.values))
    .filter(item => item.rowIndex >= dataStartRowIndex)
    .filter(item => item.values.some(value => String(value == null ? '' : value).trim()))
    .filter(item => !isInventoryTemplateGroupHeaderRow(item.values))
    .filter(item => !isInventoryTemplateHeaderRow(item.values))
    .filter(item => !isInventoryTemplateInlineHintRow(item.values));
}

function buildDuplicateUniqueCodeSet(rows = []) {
  const counts = new Map();

  rows.forEach((item) => {
    const uniqueCode = normalizeLabelCodeInput((item.values && item.values[0]) || '');
    if (!uniqueCode) {
      return;
    }
    counts.set(uniqueCode, (counts.get(uniqueCode) || 0) + 1);
  });

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([code]) => code)
  );
}

async function previewRows(rawRows = [], templateMeta = null) {
  if (
    templateMeta
    && String(templateMeta.templateKind || '').trim() === 'inventory_import'
    && String(templateMeta.schemaVersion || '').trim()
    && String(templateMeta.schemaVersion || '').trim() !== 'inventory-import-v2'
  ) {
    return {
      success: false,
      code: 'legacy_runtime_mismatch',
      msg: '当前云函数与前端模板协议不一致，请部署最新版 importInventoryTemplate',
      details: {
        templateKind: String(templateMeta.templateKind || '').trim(),
        schemaVersion: String(templateMeta.schemaVersion || '').trim()
      }
    };
  }

  const headerValidation = validateInventoryTemplateHeaderRows(rawRows);
  if (!headerValidation.ok) {
    return {
      success: false,
      code: headerValidation.code || '',
      msg: headerValidation.msg,
      details: headerValidation.details || null
    };
  }

  const rows = normalizeRawRows(rawRows);
  if (!rows.length) {
    return buildEmptyInventoryTemplatePreviewResult();
  }

  const lookupKeys = collectInventoryImportLookupKeys(rows);
  const [materialsByCode, existingInventoryByUniqueCode, zoneRecords, currentInventoryByProductCode] = await Promise.all([
    loadMaterialsByCodes(lookupKeys.productCodes),
    loadExistingInventoryByUniqueCodes(lookupKeys.uniqueCodes),
    loadActiveZoneRecords(),
    loadCurrentInStockInventoryByCodes(lookupKeys.productCodes)
  ]);
  const existingUniqueCodes = new Set(existingInventoryByUniqueCode.keys());

  const decorated = decorateInventoryImportPreviewRows(rows.map(row => buildInventoryImportPreviewRow(row, {
    materialsByCode,
    existingUniqueCodes,
    existingInventoryByUniqueCode,
    duplicateUniqueCodes: buildDuplicateUniqueCodeSet(rows),
    zoneMapsByCategory: buildZoneMapsByCategory(zoneRecords),
    currentInventoryByProductCode
  })));

  return {
    success: true,
    list: decorated,
    validCount: decorated.filter(item => !item.hasError).length,
    errorCount: decorated.filter(item => item.hasError).length,
    warningCount: decorated.filter(item => item.hasWarning && !item.hasError).length
  };
}

async function submitRows(items = [], openid, operatorName) {
  const normalizedItems = (Array.isArray(items) ? items : []).filter(item => item && !item.error);
  if (!normalizedItems.length) {
    return {
      success: false,
      msg: '没有可入库的数据'
    };
  }

  const lookupKeys = {
    productCodes: Array.from(new Set(normalizedItems.map(item => String(item.product_code || '').trim()).filter(Boolean))),
    uniqueCodes: Array.from(new Set(normalizedItems.map(item => String(item.unique_code || '').trim()).filter(Boolean)))
  };

  const [materialsByCode, existingInventoryByUniqueCode, zoneRecords] = await Promise.all([
    loadMaterialsByCodes(lookupKeys.productCodes),
    loadExistingInventoryByUniqueCodes(lookupKeys.uniqueCodes),
    loadActiveZoneRecords()
  ]);
  const zoneMapsByCategory = buildZoneMapsByCategory(zoneRecords);
  const seenUniqueCodes = new Set();

  return db.runTransaction(async (transaction) => {
    const ids = [];
    let created = 0;
    let refilled = 0;

    for (const item of normalizedItems) {
      const uniqueCode = normalizeLabelCodeInput(item.unique_code);
      if (seenUniqueCodes.has(uniqueCode)) {
        throw new Error(`标签编号 ${uniqueCode} 在本次提交内重复`);
      }
      seenUniqueCodes.add(uniqueCode);

      const zoneMap = (zoneMapsByCategory[item.category === 'film' ? 'film' : 'chemical']) || new Map();
      const activeZone = Array.from(zoneMap.values()).find(zone => zone.zone_key === item.zone_key);
      if (!activeZone) {
        throw new Error(`库区已失效，请刷新后重新选择：${item.zone_key || '未选择'}`);
      }

      const material = materialsByCode.get(String(item.product_code || '').trim());
      const existingInventory = existingInventoryByUniqueCode.get(uniqueCode);
      const submitAction = String(item.submit_action || 'create').trim() || 'create';

      if (submitAction === 'refill') {
        if (!existingInventory) {
          throw new Error(`标签编号 ${uniqueCode} 对应原库存不存在，请刷新预览后重试`);
        }

        if (!isChemicalRefillEligible(existingInventory, item)) {
          throw new Error(`标签编号 ${uniqueCode} 当前不满足补料条件，请刷新预览后重试`);
        }

        const refillQuantity = Number(item.net_content);
        if (!Number.isFinite(refillQuantity) || refillQuantity <= 0) {
          throw new Error(`标签编号 ${uniqueCode} 的补料数量必须为有效正数`);
        }
        const refillUpdate = buildChemicalRefillUpdate(existingInventory, refillQuantity);
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
            material_id: material && material._id,
            material_name: String(material && (material.material_name || material.name) || item.material_name || '').trim(),
            category: item.category === 'film' ? 'film' : 'chemical',
            product_code: String(item.product_code || '').trim(),
            unique_code: uniqueCode,
            quantity_change: refillQuantity,
            spec_change_unit: (existingInventory.quantity && existingInventory.quantity.unit) || item.quantity_unit || '',
            unit: (existingInventory.quantity && existingInventory.quantity.unit) || item.quantity_unit || '',
            description: '补料入库',
            operator: operatorName || 'System',
            operator_id: openid,
            _openid: openid,
            timestamp: db.serverDate()
          }
        });

        ids.push(existingInventory._id);
        refilled += 1;
        continue;
      }

      if (existingInventory) {
        throw new Error(`标签编号 ${uniqueCode} 已存在，请刷新预览后重试`);
      }

      const payload = buildInventoryImportPayload(item, material);

      if (payload.masterSpecBackfill && Object.keys(payload.masterSpecBackfill).length > 0) {
        const materialUpdateData = {
          updated_by: openid,
          updated_at: db.serverDate()
        };

        if (payload.masterSpecBackfill.thickness_um !== undefined) {
          materialUpdateData['specs.thickness_um'] = payload.masterSpecBackfill.thickness_um;
        }
        if (payload.masterSpecBackfill.standard_width_mm !== undefined) {
          materialUpdateData['specs.standard_width_mm'] = payload.masterSpecBackfill.standard_width_mm;
        }

        await transaction.collection('materials').doc(payload.inventoryData.material_id).update({
          data: materialUpdateData
        });
      }

      const addRes = await transaction.collection('inventory').add({
        data: Object.assign({}, payload.inventoryData, {
          create_time: db.serverDate(),
          update_time: db.serverDate()
        })
      });

      await transaction.collection('inventory_log').add({
        data: Object.assign({}, payload.logData, {
          inventory_id: addRes._id,
          operator: operatorName || 'System',
          operator_id: openid,
          _openid: openid,
          timestamp: db.serverDate()
        })
      });

      ids.push(addRes._id);
      created += 1;
    }

    return {
      success: true,
      created,
      refilled,
      total: ids.length,
      ids,
      msg: `成功处理 ${ids.length} 条`
    };
  });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || '').trim();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行模板导入入库');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    if (action === 'preview') {
      return await previewRows(
        (event.data && event.data.rows) || [],
        (event.data && event.data.templateMeta) || null
      );
    }

    if (action === 'submit') {
      return await submitRows((event.data && event.data.items) || [], OPENID, operator && operator.name);
    }

    return {
      success: false,
      msg: '未知操作'
    };
  } catch (error) {
    console.error('库存模板导入失败', error);
    return {
      success: false,
      code: error.code || '',
      details: error.details || null,
      msg: error.message || '导入失败'
    };
  }
};
