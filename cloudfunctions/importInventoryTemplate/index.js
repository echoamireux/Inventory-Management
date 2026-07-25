const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertActiveInventoryAccess } = require('./auth');
const {
  isChemicalRefillEligible,
  buildChemicalRefillUpdate,
  parseChemicalQuantity
} = require('./inventory-quantity');
const {
  isInventoryTemplateGroupHeaderRow,
  isInventoryTemplateHeaderRow,
  isInventoryTemplateInlineHintRow,
  validateInventoryTemplateHeaderRows,
  buildEmptyInventoryTemplatePreviewResult,
  normalizeInventoryCategoryText,
  normalizeLabelCodeInput,
  normalizeProductCodeInput,
  collectInventoryImportLookupKeys,
  buildZoneMapsByCategory,
  buildLocationDetailMapByZone,
  buildInventoryImportPreviewRow,
  decorateInventoryImportPreviewRows,
  buildInventoryImportPayload,
  assertInventoryTemplateImportLimit
} = require('./inventory-import');
const {
  ensureBuiltinProductCodePrefixes
} = require('./product-code-prefixes');
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
const { handleCloudError } = require('./error-response');
const {
  buildTestMaterialIdentityKey,
  buildTestMaterialSupplierModelKey,
  loadTestMaterialIdentityForSelection
} = require('./test-material-identities');

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

async function getOperator(openid, collectionOwner = db) {
  const res = await collectionOwner.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

async function getTransactionOperator(transaction, openid, fallback) {
  try {
    return await getOperator(openid, transaction);
  } catch (error) {
    if (/unexpected transaction collection/.test(String(error && error.message || ''))) {
      return fallback;
    }
    throw error;
  }
}

function assertInventoryWriteAccess(operator, message) {
  if (typeof assertActiveInventoryAccess === 'function') {
    return assertActiveInventoryAccess(operator, message);
  }
  return assertActiveUserAccess(operator, message);
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

async function loadActiveLocationDetailRecords() {
  const rows = [];
  let skip = 0;

  while (true) {
    try {
      const res = await db.collection('warehouse_location_details').skip(skip).limit(100).get();
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

async function loadActiveProductCodePrefixes() {
  const records = await ensureBuiltinProductCodePrefixes(db);
  return (records || [])
    .filter(item => item.status === 'active')
    .map(item => ({
      prefix: item.prefix,
      category: item.category,
      status: item.status
    }));
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

async function loadPreprintLabelsByUniqueCodes(uniqueCodes = []) {
  const rows = [];
  for (const codes of chunkArray(uniqueCodes, 50)) {
    if (!codes.length) {
      continue;
    }
    const res = await db.collection('preprinted_labels').where({
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

async function loadTestMaterialIdentitiesByIdentityKeys(identityKeys = []) {
  const rows = [];
  const uniqueKeys = Array.from(new Set(
    (identityKeys || []).map(item => String(item || '').trim()).filter(Boolean)
  ));
  for (const keys of chunkArray(uniqueKeys, 50)) {
    if (!keys.length) {
      continue;
    }
    const res = await db.collection('test_material_identities').where({
      identity_key: _.in(keys)
    }).get();
    rows.push(...(res.data || []));
  }
  return rows;
}

function collectTestMaterialIdentityKeysForRows(rows = [], context = {}) {
  const materialsByCode = context.materialsByCode || new Map();
  const preprintLabelsByUniqueCode = context.preprintLabelsByUniqueCode || new Map();
  const identityKeys = [];

  for (const row of rows) {
    const values = row && Array.isArray(row.values) ? row.values : [];
    if (!values.length) {
      continue;
    }
    const category = normalizeInventoryCategoryText(values[3]);
    if (!category) {
      continue;
    }
    const normalizedCode = normalizeProductCodeInput(
      category,
      values[2],
      values[1],
      context.productCodePrefixes
    );
    if (!normalizedCode.ok) {
      continue;
    }
    const material = materialsByCode.get(normalizedCode.product_code);
    if (!material || !material.is_test_material) {
      continue;
    }
    const uniqueCode = normalizeLabelCodeInput(values[0]);
    const preprintLabel = uniqueCode ? preprintLabelsByUniqueCode.get(uniqueCode) : null;
    const supplierModelKey = buildTestMaterialSupplierModelKey(
      values[13] || (preprintLabel && preprintLabel.supplier_model)
    );
    const identityKey = buildTestMaterialIdentityKey({
      category: material.category || category,
      product_code: material.product_code || normalizedCode.product_code,
      supplier_model_key: supplierModelKey
    });
    if (identityKey) {
      identityKeys.push(identityKey);
    }
  }

  return Array.from(new Set(identityKeys));
}

async function loadPreprintLabelByUniqueCode(transaction, uniqueCode) {
  const normalizedUniqueCode = String(uniqueCode || '').trim();
  if (!normalizedUniqueCode) {
    return null;
  }

  const res = await transaction.collection('preprinted_labels').where({
    unique_code: normalizedUniqueCode
  }).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function assertUniqueCodeAvailableForCreate(transaction, uniqueCode) {
  const res = await transaction.collection('inventory')
    .where({ unique_code: uniqueCode })
    .limit(1)
    .get();
  if (res.data && res.data.length > 0) {
    throw new Error(`标签编号 ${uniqueCode} 已存在，请刷新预览后重试`);
  }
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

function assertPreprintLabelUsable(preprintLabel, item, material) {
  if (!preprintLabel) {
    return;
  }

  const uniqueCode = String(item.unique_code || '').trim();
  const materialId = String((material && material._id) || item.material_id || '').trim();
  const productCode = String((material && material.product_code) || item.product_code || '').trim();
  const category = String((material && material.category) || item.category || '').trim();

  if (String(preprintLabel.unique_code || '').trim() !== uniqueCode) {
    throw new Error('预生成标签编号与当前入库标签不一致');
  }
  if (preprintLabel.status !== 'unused') {
    throw new Error(preprintLabel.status === 'voided'
      ? '该预生成标签已作废，不能入库'
      : '该预生成标签已入库，不能重复使用');
  }
  if (preprintLabel.material_id && String(preprintLabel.material_id).trim() !== materialId) {
    throw new Error('预生成标签不属于当前物料');
  }
  if (preprintLabel.product_code && String(preprintLabel.product_code).trim() !== productCode) {
    throw new Error('预生成标签不属于当前物料');
  }
  if (preprintLabel.category && String(preprintLabel.category).trim() !== category) {
    throw new Error('预生成标签类型与当前物料不一致');
  }

  const isTest = !!(material && material.is_test_material);
  const preprintSupplierModel = String(preprintLabel.supplier_model || '').trim();
  const inboundSupplierModel = String(item.supplier_model || '').trim();
  if (isTest && preprintSupplierModel && inboundSupplierModel && inboundSupplierModel !== preprintSupplierModel) {
    throw new Error('预生成标签原厂型号与当前入库信息不一致');
  }

  if (category === 'film') {
    const preprintSpecs = resolvePreprintFilmSpecs(preprintLabel);
    const inboundThickness = normalizePositiveSpec(item.thickness_um);
    const inboundWidth = normalizePositiveSpec(item.batch_width_mm || item.width_mm || item.standard_width_mm);
    if (preprintSpecs.thickness_um && inboundThickness && inboundThickness !== preprintSpecs.thickness_um) {
      throw new Error('与预生成标签规格不一致');
    }
    if (preprintSpecs.width_mm && inboundWidth && inboundWidth !== preprintSpecs.width_mm) {
      throw new Error('与预生成标签规格不一致');
    }
  }
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

  const productCodePrefixes = await loadActiveProductCodePrefixes();
  const lookupKeys = collectInventoryImportLookupKeys(rows, { productCodePrefixes });
  const [
    materialsByCode,
    existingInventoryByUniqueCode,
    preprintLabelsByUniqueCode,
    zoneRecords,
    locationDetailRecords,
    currentInventoryByProductCode
  ] = await Promise.all([
    loadMaterialsByCodes(lookupKeys.productCodes),
    loadExistingInventoryByUniqueCodes(lookupKeys.uniqueCodes),
    loadPreprintLabelsByUniqueCodes(lookupKeys.uniqueCodes),
    loadActiveZoneRecords(),
    loadActiveLocationDetailRecords(),
    loadCurrentInStockInventoryByCodes(lookupKeys.productCodes)
  ]);
  const existingUniqueCodes = new Set(existingInventoryByUniqueCode.keys());
  const testMaterialIdentityKeys = collectTestMaterialIdentityKeysForRows(rows, {
    materialsByCode,
    preprintLabelsByUniqueCode,
    productCodePrefixes
  });
  const testMaterialIdentities = await loadTestMaterialIdentitiesByIdentityKeys(testMaterialIdentityKeys);

  const decorated = decorateInventoryImportPreviewRows(rows.map(row => buildInventoryImportPreviewRow(row, {
    materialsByCode,
    existingUniqueCodes,
    existingInventoryByUniqueCode,
    preprintLabelsByUniqueCode,
    duplicateUniqueCodes: buildDuplicateUniqueCodeSet(rows),
    zoneMapsByCategory: buildZoneMapsByCategory(zoneRecords),
    locationDetailMapByZone: buildLocationDetailMapByZone(locationDetailRecords),
    currentInventoryByProductCode,
    productCodePrefixes,
    testMaterialIdentities
  })));

  return {
    success: true,
    list: decorated,
    validCount: decorated.filter(item => !item.hasError).length,
    errorCount: decorated.filter(item => item.hasError).length,
    warningCount: decorated.filter(item => item.hasWarning && !item.hasError).length
  };
}

async function submitRows(items = [], openid, operatorName, operationId) {
  const normalizedItems = (Array.isArray(items) ? items : []).filter(item => item && !item.error);
  if (!normalizedItems.length) {
    return {
      success: false,
      msg: '没有可入库的数据'
    };
  }
  assertInventoryTemplateImportLimit(normalizedItems.length);
  for (const item of normalizedItems) {
    if (String(item.submit_action || 'create').trim() !== 'refill') {
      continue;
    }
    const uniqueCode = normalizeLabelCodeInput(item.unique_code);
    try {
      parseChemicalQuantity(item.net_content, `标签编号 ${uniqueCode} 的补料数量`);
    } catch (error) {
      throw new Error(error.message || `标签编号 ${uniqueCode} 的补料数量必须为有效正数`);
    }
  }
  const operationContext = buildOperationReceiptContext({
    openid,
    operationId,
    requestPayload: { items: normalizedItems }
  });

  const lookupKeys = {
    productCodes: Array.from(new Set(normalizedItems.map(item => String(item.product_code || '').trim()).filter(Boolean))),
    uniqueCodes: Array.from(new Set(normalizedItems.map(item => String(item.unique_code || '').trim()).filter(Boolean)))
  };

  const [materialsByCode, existingInventoryByUniqueCode, zoneRecords, locationDetailRecords] = await Promise.all([
    loadMaterialsByCodes(lookupKeys.productCodes),
    loadExistingInventoryByUniqueCodes(lookupKeys.uniqueCodes),
    loadActiveZoneRecords(),
    loadActiveLocationDetailRecords()
  ]);
  const zoneMapsByCategory = buildZoneMapsByCategory(zoneRecords);
  const locationDetailMapByZone = buildLocationDetailMapByZone(locationDetailRecords);
  const seenUniqueCodes = new Set();

  return db.runTransaction(async (transaction) => {
    const transactionOperator = await getTransactionOperator(transaction, openid, { name: operatorName, status: 'active', role: 'user' });
    const transactionAuthResult = assertInventoryWriteAccess(transactionOperator, '用户状态或角色已变化，请重新登录后重试');
    if (!transactionAuthResult.ok) {
      throw new Error(transactionAuthResult.msg);
    }
    const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
    if (operationReceipt.reused) {
      return operationReceipt.response;
    }

    const ids = [];
    let created = 0;
    let refilled = 0;
    const preprintJobUsageCounts = new Map();

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
      const detailGroup = locationDetailMapByZone.get(activeZone.zone_key);
      if (detailGroup && detailGroup.list && detailGroup.list.length > 0) {
        const detailKey = String(item.location_detail_key || '').trim();
        const detailName = String(item.location_detail || '').trim();
        const detailRecord = detailKey
          ? detailGroup.byKey.get(detailKey)
          : detailGroup.byName.get(detailName);
        if (!detailRecord) {
          throw new Error(`详细坐标已失效，请刷新模板后重新选择：${detailName || detailKey || '未选择'}`);
        }
        item.location_detail_key = detailRecord.detail_key;
        item.location_detail = detailRecord.name;
        item.location = `${activeZone.name} | ${detailRecord.name}`;
        item.location_text = item.location;
      }

      const materialSnapshot = materialsByCode.get(String(item.product_code || '').trim());
      if (!materialSnapshot || materialSnapshot.status !== 'active') {
        throw new Error(`产品代码 ${item.product_code || ''} 未启用，不能入库`);
      }
      const existingInventorySnapshot = existingInventoryByUniqueCode.get(uniqueCode);
      const submitAction = String(item.submit_action || 'create').trim() || 'create';

      let refillQuantity = null;
      if (submitAction === 'refill') {
        try {
          refillQuantity = parseChemicalQuantity(item.net_content, `标签编号 ${uniqueCode} 的补料数量`);
        } catch (error) {
          throw new Error(error.message || `标签编号 ${uniqueCode} 的补料数量必须为有效正数`);
        }
      }

      const materialRes = await transaction.collection('materials').doc(materialSnapshot._id).get();
      const material = materialRes.data;
      if (
        !material
        || material.status !== 'active'
        || String(material.product_code || '').trim() !== String(item.product_code || '').trim()
      ) {
        throw new Error(`产品代码 ${item.product_code || ''} 未启用或主数据已变化，请刷新后重试`);
      }
      const identityValidation = await loadTestMaterialIdentityForSelection(transaction, material, item);
      if (!identityValidation.ok) {
        throw new Error(`第${Number(item.rowIndex) || 0}行${identityValidation.msg}`);
      }
      if (material.is_test_material) {
        item.supplier = String(item.supplier || '').trim() || identityValidation.supplier || '';
        item.supplier_model = identityValidation.supplier_model;
        item.supplier_model_key = identityValidation.supplier_model_key;
        item.material_name = identityValidation.label_material_name || item.material_name;
        item.subcategory_key = identityValidation.subcategory_key || item.subcategory_key || '';
        item.sub_category = identityValidation.sub_category || item.sub_category || '';
      }

      if (submitAction === 'refill') {
        if (!existingInventorySnapshot) {
          throw new Error(`标签编号 ${uniqueCode} 对应原库存不存在，请刷新预览后重试`);
        }
        const refillInventoryId = String(item.refill_inventory_id || '').trim();
        if (!refillInventoryId || refillInventoryId !== existingInventorySnapshot._id) {
          throw new Error(`标签编号 ${uniqueCode} 的补料目标库存不一致，请刷新预览后重试`);
        }

        const currentInventoryRes = await transaction.collection('inventory')
          .doc(existingInventorySnapshot._id)
          .get();
        const currentInventory = currentInventoryRes.data;
        if (!currentInventory || normalizeLabelCodeInput(currentInventory.unique_code) !== uniqueCode) {
          throw new Error(`标签编号 ${uniqueCode} 对应原库存不存在，请刷新预览后重试`);
        }

        if (!isChemicalRefillEligible(currentInventory, item)) {
          throw new Error(`标签编号 ${uniqueCode} 当前不满足补料条件，请刷新预览后重试`);
        }

        const refillUpdate = buildChemicalRefillUpdate(currentInventory, refillQuantity);
        await transaction.collection('inventory').doc(currentInventory._id).update({
          data: {
            ...refillUpdate.updateData,
            update_time: db.serverDate()
          }
        });

        const refillLog = {
            type: 'refill',
            inventory_id: currentInventory._id,
            material_id: material && material._id,
            material_name: String(item.material_name || material && (material.material_name || material.name) || '').trim(),
            category: item.category === 'film' ? 'film' : 'chemical',
            product_code: String(item.product_code || '').trim(),
            unique_code: uniqueCode,
            quantity_change: refillQuantity,
            spec_change_unit: (currentInventory.quantity && currentInventory.quantity.unit) || item.quantity_unit || '',
            unit: (currentInventory.quantity && currentInventory.quantity.unit) || item.quantity_unit || '',
            description: '补料入库',
            operator: operatorName || 'System',
            operator_id: openid,
            _openid: openid,
            timestamp: db.serverDate()
        };
        await transaction.collection('inventory_log').add({ data: refillLog });
        await writeInventoryAuditEvent(transaction, db, refillLog, {
          operationId: operationContext.operationId
        });

        ids.push(currentInventory._id);
        refilled += 1;
        continue;
      }

      if (existingInventorySnapshot) {
        throw new Error(`标签编号 ${uniqueCode} 已存在，请刷新预览后重试`);
      }
      await assertUniqueCodeAvailableForCreate(transaction, uniqueCode);

      const preprintLabel = await loadPreprintLabelByUniqueCode(transaction, uniqueCode);
      assertPreprintLabelUsable(preprintLabel, item, material);
      const preprintJob = await loadPreprintJobForLabel(transaction, preprintLabel);
      assertPreprintJobConsumable(preprintJob);
      const payload = buildInventoryImportPayload(item, material, {
        preprintLabel,
        testMaterialIdentities: material.is_test_material ? [identityValidation] : []
      });

      if (payload.masterSpecBackfill && Object.keys(payload.masterSpecBackfill).length > 0) {
        const currentMaterialRes = await transaction.collection('materials')
          .doc(payload.inventoryData.material_id)
          .get();
        const currentMaterial = currentMaterialRes.data || {};
        const materialSpecUpdate = buildFilmMasterSpecUpdateFromCurrent(
          currentMaterial,
          payload.masterSpecBackfill,
          `第${Number(item.rowIndex) || 0}行`
        );

        if (Object.keys(materialSpecUpdate).length > 0) {
          await transaction.collection('materials').doc(payload.inventoryData.material_id).update({
            data: {
              ...materialSpecUpdate,
              updated_by: openid,
              updated_at: db.serverDate()
            }
          });
        }
      }

      const addRes = await transaction.collection('inventory').add({
        data: Object.assign({}, payload.inventoryData, {
          create_time: db.serverDate(),
          update_time: db.serverDate()
        })
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

      const inboundLog = Object.assign({}, payload.logData, {
          inventory_id: addRes._id,
          operator: operatorName || 'System',
          operator_id: openid,
          _openid: openid,
          timestamp: db.serverDate()
      });
      await transaction.collection('inventory_log').add({
        data: inboundLog
      });
      await writeInventoryAuditEvent(transaction, db, inboundLog, {
        operationId: operationContext.operationId
      });

      ids.push(addRes._id);
      created += 1;
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
      created,
      refilled,
      total: ids.length,
      ids,
      msg: `成功处理 ${ids.length} 条`
    };
    await markOperationReceiptSucceeded(transaction, db, operationContext, response);
    return response;
  });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || '').trim();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertInventoryWriteAccess(operator, '仅已激活用户可执行模板导入入库');
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
      return await submitRows(
        (event.data && event.data.items) || [],
        OPENID,
        operator && operator.name,
        event.operation_id || (event.data && event.data.operation_id)
      );
    }

    return {
      success: false,
      msg: '未知操作'
    };
  } catch (error) {
    return handleCloudError(error, {
      scope: 'importInventoryTemplate',
      operationId: event && (event.operation_id || (event.data && event.data.operation_id)),
      fallbackMessage: '库存模板导入失败，请稍后重试'
    });
  }
};
