// cloudfunctions/manageMaterial/index.js
const cloud = require('wx-server-sdk');
const { normalizeUnitInput } = require('./material-units');
const { normalizeTestMaterialFlag } = require('./test-material');
const { validateStandardProductCode } = require('./product-code');
const { createImportResultTracker } = require('./import-batch-results');
const { buildContainsRegExp, normalizeSearchKeyword } = require('./search');
const { assertAdminMutationAccess, assertActiveUserAccess } = require('./auth');
const { writeAuditEvent } = require('./audit-events');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategoryDisplay,
  resolveSubcategorySelection
} = require('./material-subcategories');
const {
  ensureBuiltinProductCodePrefixes,
  filterProductCodePrefixRecordsByCategory
} = require('./product-code-prefixes');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const MATERIAL_EDITABLE_FIELDS = new Set([
  'product_code',
  'material_name',
  'category',
  'subcategory_key',
  'sub_category',
  'supplier',
  'supplier_model',
  'default_unit',
  'is_test_material',
  'package_type',
  'thickness_um',
  'width_mm',
  'standard_width_mm'
]);

function pickEditableMaterialFields(data = {}) {
  return Object.keys(data).reduce((result, key) => {
    if (MATERIAL_EDITABLE_FIELDS.has(key)) {
      result[key] = data[key];
    }
    return result;
  }, {});
}

function hasMaterialIdentityChanged(current = {}, next = {}) {
  return String(current.product_code || '').trim() !== String(next.product_code || '').trim()
    || String(current.category || '').trim() !== String(next.category || '').trim()
    || !!current.is_test_material !== !!next.is_test_material;
}

async function loadSubcategoryContext(category = '') {
  const allRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const records = category
    ? filterSubcategoryRecordsByCategory(allRecords, category, { includeDisabled: true })
    : allRecords;

  return {
    records,
    map: buildSubcategoryMap(records)
  };
}

async function loadProductCodePrefixOptions(category = '') {
  try {
    const allRecords = await ensureBuiltinProductCodePrefixes(db);
    return filterProductCodePrefixRecordsByCategory(allRecords, category, { includeDisabled: false });
  } catch (_error) {
    return [];
  }
}

async function resolveMaterialSubcategory(data, category) {
  const context = await loadSubcategoryContext(category);
  const resolved = resolveSubcategorySelection({
    category,
    subcategory_key: data && data.subcategory_key,
    sub_category: data && data.sub_category
  }, context.records, context.map);

  if (!resolved.subcategory_key) {
    return {
      ok: false,
      msg: '请选择有效子类别'
    };
  }

  return {
    ok: true,
    ...resolved
  };
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  return normalized;
}

function buildMaterialSearchCondition(regex, normalizedKeyword) {
  const textSearchConditions = [
    { product_code: regex },
    { material_name: regex },
    { supplier: regex },
    { supplier_model: regex },
    { default_unit: regex },
    { package_type: regex },
    { subcategory_key: regex },
    { sub_category: regex }
  ];

  const numericSearchValue = Number(normalizedKeyword);
  if (normalizedKeyword && Number.isFinite(numericSearchValue)) {
    textSearchConditions.push(
      { 'specs.thickness_um': numericSearchValue },
      { 'specs.standard_width_mm': numericSearchValue },
      { 'specs.width_mm': numericSearchValue }
    );
  }

  return textSearchConditions;
}

async function getOperator(openid) {
  const operatorRes = await db.collection('users').where({
    _openid: openid
  }).limit(1).get();

  return operatorRes.data && operatorRes.data.length > 0
    ? operatorRes.data[0]
    : null;
}

async function assertManageMaterialAdminMutation(openid, message = '仅管理员可执行该操作') {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, message);
  if (!authResult.ok) {
    return authResult;
  }

  return { ok: true, operator };
}

async function assertManageMaterialActiveAccess(openid, message = '仅已激活用户可查看物料主数据') {
  const operator = await getOperator(openid);
  const authResult = assertActiveUserAccess(operator, message);
  if (!authResult.ok) {
    return authResult;
  }

  return { ok: true, operator };
}

async function runMaterialTransaction(handler) {
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(handler);
  }
  return handler({ collection: db.collection.bind(db) });
}

async function writeMaterialAuditEvent(collectionOwner, openid, logData = {}) {
  await writeAuditEvent(collectionOwner, db, {
    domain: 'material',
    action: logData.action || 'change',
    actorId: openid,
    target: {
      type: 'material',
      id: logData.material_id || '',
      label: logData.product_code || ''
    },
    before: logData.old_data || {},
    after: logData.new_data || logData.changes || {},
    detail: {
      product_code: logData.product_code || '',
      note: logData.action || ''
    }
  });
}

function buildGovernedMaterialMasterFields(source = {}, category, options = {}) {
  const removeIrrelevant = !!options.removeIrrelevant;
  const testMaterialFlag = normalizeTestMaterialFlag(source.is_test_material);
  const fields = {
    material_name: sanitizeText(source.material_name),
    category,
    supplier: sanitizeText(source.supplier),
    supplier_model: sanitizeText(source.supplier_model),
    default_unit: sanitizeText(source.default_unit),
    is_test_material: testMaterialFlag.value
  };

  if (category === 'chemical') {
    fields.package_type = sanitizeText(source.package_type);
    if (removeIrrelevant) {
      fields.specs = _.remove();
    }
    return fields;
  }

  if (category === 'film') {
    const thicknessUm = normalizeOptionalNumber(
      source.thickness_um !== undefined
        ? source.thickness_um
        : source.specs && source.specs.thickness_um
    );
    const standardWidthMm = normalizeOptionalNumber(
      source.width_mm !== undefined
        ? source.width_mm
        : (
          source.standard_width_mm !== undefined
            ? source.standard_width_mm
            : (source.specs && (
              source.specs.standard_width_mm !== undefined
                ? source.specs.standard_width_mm
                : source.specs.width_mm
            ))
        )
    );
    const specs = {};

    if (thicknessUm !== null) {
      specs.thickness_um = thicknessUm;
    }
    if (standardWidthMm !== null) {
      specs.standard_width_mm = standardWidthMm;
    }

    fields.specs = specs;
    if (removeIrrelevant) {
      fields.package_type = _.remove();
    }
  }

  return fields;
}

function validateTestMaterialFlag(source = {}) {
  const testMaterialFlag = normalizeTestMaterialFlag(source.is_test_material);
  if (!testMaterialFlag.ok) {
    return {
      ok: false,
      msg: testMaterialFlag.msg
    };
  }

  return { ok: true };
}

function validateBatchCreateMasterFields(item = {}, category = '') {
  const testMaterialFlag = normalizeTestMaterialFlag(item.is_test_material);
  if (!testMaterialFlag.ok) {
    return {
      ok: false,
      msg: testMaterialFlag.msg
    };
  }

  if (category === 'film') {
    const thicknessUm = normalizeOptionalNumber(item.thickness_um);
    if (thicknessUm === null) {
      return {
        ok: false,
        msg: '膜材厚度必填'
      };
    }
  }

  return { ok: true };
}

function buildBatchCreateComparableSignature(payload = {}) {
  return JSON.stringify({
    material_name: sanitizeText(payload.material_name),
    category: sanitizeText(payload.category),
    sub_category: sanitizeText(payload.sub_category),
    default_unit: sanitizeText(payload.default_unit),
    package_type: sanitizeText(payload.package_type),
    thickness_um: payload.thickness_um == null ? null : Number(payload.thickness_um),
    standard_width_mm: payload.standard_width_mm == null ? null : Number(payload.standard_width_mm),
    supplier: sanitizeText(payload.supplier),
    supplier_model: sanitizeText(payload.supplier_model),
    is_test_material: !!payload.is_test_material
  });
}

function buildBatchCreateConflictMap(preparedItems = []) {
  const rowsByProductCode = new Map();
  const conflictMap = new Map();

  preparedItems.forEach((prepared) => {
    const productCode = prepared.normalizedCode;
    if (!productCode) {
      return;
    }

    if (!rowsByProductCode.has(productCode)) {
      rowsByProductCode.set(productCode, []);
    }
    rowsByProductCode.get(productCode).push(prepared);
  });

  rowsByProductCode.forEach((groupedItems, productCode) => {
    if (groupedItems.length < 2) {
      return;
    }

    const signatures = new Set(groupedItems.map(item => buildBatchCreateComparableSignature({
      material_name: item.material_name,
      category: item.category,
      sub_category: item.resolvedSubcategory.sub_category,
      default_unit: item.normalizedUnit,
      package_type: item.category === 'chemical' ? item.item.package_type : '',
      thickness_um: item.category === 'film' ? normalizeOptionalNumber(item.item.thickness_um) : null,
      standard_width_mm: item.category === 'film' ? normalizeOptionalNumber(item.item.standard_width_mm) : null,
      supplier: item.item.supplier,
      supplier_model: item.item.supplier_model,
      is_test_material: normalizeTestMaterialFlag(item.item.is_test_material).value
    })));

    if (signatures.size === 1) {
      return;
    }

    const error = `产品代码 ${productCode} 在本次导入文件中重复，且主数据字段不一致，请统一后再导入`;
    groupedItems.forEach((item) => {
      conflictMap.set(item.rowIndex, error);
    });
  });

  return conflictMap;
}

async function materialExistsByProductCode(collectionOwner, productCode) {
  const query = collectionOwner.collection('materials').where({ product_code: productCode });
  if (query && typeof query.limit === 'function' && typeof query.get === 'function') {
    const res = await query.limit(1).get();
    return !!(res.data && res.data.length > 0);
  }
  if (query && typeof query.count === 'function') {
    const res = await query.count();
    return Number(res.total) > 0;
  }
  throw new Error('当前数据库接口不支持物料查重');
}

async function createBatchMaterialWithAudit(newMaterial, openid) {
  return runMaterialTransaction(async (transaction) => {
    const exists = await materialExistsByProductCode(transaction, newMaterial.product_code);
    if (exists) {
      return {
        status: 'skipped',
        reason: '产品代码已存在'
      };
    }

    const res = await transaction.collection('materials').add({ data: newMaterial });
    await writeMaterialAuditEvent(transaction, openid, {
      material_id: res._id,
      product_code: newMaterial.product_code,
      action: 'create',
      changes: newMaterial
    });

    return {
      status: 'created',
      id: res._id
    };
  });
}

/**
 * 物料主数据管理云函数
 *
 * @param {string} action - 操作类型: list / get / create / update / archive
 * @param {object} data - 操作数据
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, data } = event;

  try {
    switch (action) {
      case 'list':
        {
          const authResult = await assertManageMaterialActiveAccess(OPENID);
          if (!authResult.ok) {
            return { success: false, msg: authResult.msg };
          }
        }
        return await listMaterials(data);
      case 'get':
        {
          const authResult = await assertManageMaterialActiveAccess(OPENID);
          if (!authResult.ok) {
            return { success: false, msg: authResult.msg };
          }
        }
        return await getMaterial(data);
      case 'create':
        return await createMaterial(data, OPENID);
      case 'update':
        return await updateMaterial(data, OPENID);
      case 'archive':
        return await archiveMaterial(data, OPENID);
      case 'batchCreate':
        return await batchCreateMaterials(data, OPENID);
      case 'batchDelete':
        return await batchDeleteMaterials(data, OPENID);
      case 'restore':
        return await restoreMaterial(data, OPENID);
      case 'checkStatus':
        {
          const authResult = await assertManageMaterialActiveAccess(OPENID);
          if (!authResult.ok) {
            return { success: false, msg: authResult.msg };
          }
        }
        return await checkMaterialStatus(data);
      case 'checkHistory':
        {
          const authResult = await assertManageMaterialActiveAccess(OPENID);
          if (!authResult.ok) {
            return { success: false, msg: authResult.msg };
          }
        }
        return await checkMaterialHistory(data);
      default:
        return { success: false, msg: '未知操作' };
    }
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};

/**
 * 获取物料列表
 */
async function listMaterials(params = {}) {
  const { searchVal, category, status, page = 1, pageSize = 20 } = params;

  // Default to non-archived if status not specified
  // If status === 'archived', query archived
  // If status === 'active', query active (which is status!=archived AND status!=deleted, but here assume 'active' or undefined for simplicity)

  let query = {};
  if (status === 'archived') {
      query.status = 'archived';
  } else {
      query.status = _.neq('archived');
  }

  if (category) {
    query.category = category;
  }

  const normalizedKeyword = normalizeSearchKeyword(searchVal);
  const regex = buildContainsRegExp(db, normalizedKeyword);
  if (regex) {
    query = _.and([
      query,
      _.or(buildMaterialSearchCondition(regex, normalizedKeyword))
    ]);
  }

  const countRes = await db.collection('materials').where(query).count();
  const total = countRes.total;

  const res = await db.collection('materials')
    .where(query)
    .orderBy('product_code', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const context = await loadSubcategoryContext();
  const list = (res.data || []).map(item => ({
    ...item,
    sub_category: resolveSubcategoryDisplay(item, context.map)
  }));

  return {
    success: true,
    list,
    total,
    page,
    pageSize
  };
}

/**
 * 获取单个物料详情
 */
async function getMaterial(params) {
  const { id, product_code } = params;

  let res;
  if (id) {
    res = await db.collection('materials').doc(id).get();
    const context = await loadSubcategoryContext(res.data && res.data.category);
    return {
      success: true,
      data: {
        ...res.data,
        sub_category: resolveSubcategoryDisplay(res.data, context.map)
      }
    };
  } else if (product_code) {
    res = await db.collection('materials').where({ product_code }).get();
    if (res.data.length === 0) {
      return { success: false, msg: '物料不存在' };
    }
    const context = await loadSubcategoryContext(res.data[0] && res.data[0].category);
    return {
      success: true,
      data: {
        ...res.data[0],
        sub_category: resolveSubcategoryDisplay(res.data[0], context.map)
      }
    };
  } else {
    return { success: false, msg: '缺少查询参数' };
  }
}

/**
 * 创建新物料
 */
async function createMaterial(data, openid) {
  const { product_code, material_name, category } = data;
  const authResult = await assertManageMaterialAdminMutation(openid);
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  // 验证必填字段
  if (!product_code || !material_name || !category) {
    return { success: false, msg: '缺少必填字段' };
  }

  const prefixOptions = await loadProductCodePrefixOptions(category);
  const normalizedCode = validateStandardProductCode(category, product_code, {
    allowedPrefixes: prefixOptions
  });
  if (!normalizedCode.ok) {
    return { success: false, msg: normalizedCode.msg };
  }

  const normalizedUnit = normalizeUnitInput(category, data.default_unit);
  if (!normalizedUnit.ok) {
    return { success: false, msg: normalizedUnit.msg };
  }
  const resolvedSubcategory = await resolveMaterialSubcategory(data, category);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }
  const testMaterialValidation = validateTestMaterialFlag(data);
  if (!testMaterialValidation.ok) {
    return { success: false, msg: testMaterialValidation.msg };
  }

  // 检查 product_code 是否已存在
  const existing = await db.collection('materials')
    .where({ product_code: normalizedCode.product_code })
    .count();

  if (existing.total > 0) {
    return { success: false, msg: '产品代码已存在' };
  }

  const now = db.serverDate();
  const masterFields = buildGovernedMaterialMasterFields({
    ...data,
    default_unit: normalizedUnit.unit,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category
  }, category);
  const newMaterial = {
    product_code: normalizedCode.product_code,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category,
    ...masterFields,
    status: 'active',
    created_by: openid,
    created_at: now,
    updated_by: openid,
    updated_at: now
  };

  const res = await runMaterialTransaction(async (transaction) => {
    const addRes = await transaction.collection('materials').add({ data: newMaterial });
    await writeMaterialAuditEvent(transaction, openid, {
      material_id: addRes._id,
      product_code: normalizedCode.product_code,
      action: 'create',
      changes: newMaterial
    });
    return addRes;
  });

  return { success: true, id: res._id };
}

/**
 * 更新物料信息
 */
async function updateMaterial(data, openid) {
  const { id } = data;
  const updateData = pickEditableMaterialFields(data);
  const authResult = await assertManageMaterialAdminMutation(openid);
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  if (!id) {
    return { success: false, msg: '缺少物料ID' };
  }

  // 获取原数据用于日志
  const oldRes = await db.collection('materials').doc(id).get();
  const oldData = oldRes.data;
  if (!oldData) {
    return { success: false, msg: '物料不存在' };
  }
  const nextCategory = updateData.category || oldData.category;

  if (updateData.product_code) {
    const prefixOptions = await loadProductCodePrefixOptions(nextCategory);
    const normalizedCode = validateStandardProductCode(nextCategory, updateData.product_code, {
      allowedPrefixes: prefixOptions
    });
    if (!normalizedCode.ok) {
      return { success: false, msg: normalizedCode.msg };
    }
    updateData.product_code = normalizedCode.product_code;
  }

  // 如果修改了 product_code，检查是否冲突
  if (updateData.product_code && updateData.product_code !== oldData.product_code) {
    const existing = await db.collection('materials')
      .where({ product_code: updateData.product_code })
      .count();
    if (existing.total > 0) {
      return { success: false, msg: '产品代码已存在' };
    }
  }

  const nextUnit = Object.prototype.hasOwnProperty.call(updateData, 'default_unit')
    ? updateData.default_unit
    : oldData.default_unit;
  const normalizedUnit = normalizeUnitInput(nextCategory, nextUnit);
  if (!normalizedUnit.ok) {
    return { success: false, msg: normalizedUnit.msg };
  }
  const resolvedSubcategory = await resolveMaterialSubcategory({
    subcategory_key: updateData.subcategory_key || oldData.subcategory_key,
    sub_category: Object.prototype.hasOwnProperty.call(updateData, 'sub_category')
      ? updateData.sub_category
      : oldData.sub_category
  }, nextCategory);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }

  const nextMaterialData = {
    ...oldData,
    ...updateData,
    default_unit: normalizedUnit.unit,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category
  };
  const testMaterialValidation = validateTestMaterialFlag(nextMaterialData);
  if (!testMaterialValidation.ok) {
    return { success: false, msg: testMaterialValidation.msg };
  }

  updateData.default_unit = normalizedUnit.unit;
  updateData.subcategory_key = resolvedSubcategory.subcategory_key;
  updateData.sub_category = resolvedSubcategory.sub_category;
  Object.assign(
    updateData,
    buildGovernedMaterialMasterFields(nextMaterialData, nextCategory, { removeIrrelevant: true })
  );
  updateData.updated_by = openid;
  updateData.updated_at = db.serverDate();

  let committedOldData = oldData;
  await runMaterialTransaction(async (transaction) => {
    const materialRef = transaction.collection('materials').doc(id);
    const currentRes = await materialRef.get();
    const currentData = currentRes.data;
    if (!currentData) {
      throw new Error('物料不存在');
    }

    const identityChanged = hasMaterialIdentityChanged(currentData, {
      ...currentData,
      ...updateData
    });
    const unitChanged = normalizedUnit.unit !== String(currentData.default_unit || '').trim();
    if (identityChanged || unitChanged) {
      const inventoryRes = await transaction.collection('inventory')
        .where({ material_id: id })
        .limit(1)
        .get();
      if (inventoryRes.data && inventoryRes.data.length > 0) {
        if (identityChanged) {
          throw new Error('该物料已产生库存记录，产品代码、类别和测试料属性等身份字段已锁定，不能修改');
        }
        throw new Error('该物料已产生库存记录，默认单位已锁定，不能修改');
      }
    }

    await materialRef.update({ data: updateData });
    committedOldData = currentData;
    await writeMaterialAuditEvent(transaction, openid, {
      material_id: id,
      product_code: updateData.product_code || currentData.product_code,
      action: 'update',
      old_data: committedOldData,
      new_data: updateData
    });
  });

  return { success: true };
}

/**
 * 归档物料（软删除）
 */
async function archiveMaterial(data, openid) {
  const { id } = data;
  const authResult = await assertManageMaterialAdminMutation(openid);
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  if (!id) {
    return { success: false, msg: '缺少物料ID' };
  }

  await runMaterialTransaction(async (transaction) => {
    const oldRes = await transaction.collection('materials').doc(id).get();
    if (!oldRes.data) {
      throw new Error('物料不存在');
    }

    const inventoryRes = await transaction.collection('inventory').where({
      material_id: id,
      status: 'in_stock'
    }).limit(1).get();
    if (inventoryRes.data && inventoryRes.data.length > 0) {
      throw new Error('该物料存在在库记录，不能归档');
    }

    await transaction.collection('materials').doc(id).update({
      data: {
        status: 'archived',
        updated_by: openid,
        updated_at: db.serverDate()
      }
    });
    await writeMaterialAuditEvent(transaction, openid, {
      material_id: id,
      product_code: oldRes.data.product_code,
      action: 'archive',
      old_data: oldRes.data,
      new_data: { status: 'archived' }
    });
  });

  return { success: true };
}

/**
 * 批量创建物料
 */
async function batchCreateMaterials(data, openid) {
  const { items } = data;
  const authResult = await assertManageMaterialAdminMutation(openid, '仅管理员可导入物料主数据');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, msg: '无有效数据' };
  }

  // 限制单次最多导入 100 条
  if (items.length > 100) {
    return { success: false, msg: '单次最多导入 100 条' };
  }

  let created = 0;
  const now = db.serverDate();
  const tracker = createImportResultTracker();
  const subcategoryContexts = {
    chemical: await loadSubcategoryContext('chemical'),
    film: await loadSubcategoryContext('film')
  };
  const productCodePrefixContexts = {
    chemical: await loadProductCodePrefixOptions('chemical'),
    film: await loadProductCodePrefixOptions('film')
  };
  const preparedItems = [];

  for (const item of items) {
    if (item.error) {
      tracker.recordError(item.rowIndex, item.product_code, item.error);
      continue;
    }

    const { product_code, material_name, category, default_unit } = item;
    const normalizedCategory = category === 'film' ? 'film' : 'chemical';
    const normalizedCode = validateStandardProductCode(category, product_code, {
      allowedPrefixes: productCodePrefixContexts[normalizedCategory]
    });
    if (!normalizedCode.ok) {
      tracker.recordError(item.rowIndex, product_code, normalizedCode.msg);
      continue;
    }
    const normalizedUnit = normalizeUnitInput(category, default_unit);
    if (!normalizedUnit.ok) {
      tracker.recordError(item.rowIndex, normalizedCode.product_code, normalizedUnit.msg);
      continue;
    }
    const context = subcategoryContexts[category === 'film' ? 'film' : 'chemical'];
    const resolvedSubcategory = resolveSubcategorySelection({
      category,
      subcategory_key: item.subcategory_key,
      sub_category: item.sub_category
    }, context.records, context.map);
    if (!resolvedSubcategory.subcategory_key) {
      tracker.recordError(item.rowIndex, normalizedCode.product_code, '子类别无效');
      continue;
    }
    const governedValidation = validateBatchCreateMasterFields(item, category);
    if (!governedValidation.ok) {
      tracker.recordError(item.rowIndex, normalizedCode.product_code, governedValidation.msg);
      continue;
    }

    preparedItems.push({
      item,
      rowIndex: item.rowIndex,
      material_name,
      category,
      normalizedCode: normalizedCode.product_code,
      normalizedUnit: normalizedUnit.unit,
      resolvedSubcategory
    });
  }

  const conflictMap = buildBatchCreateConflictMap(preparedItems);

  for (const prepared of preparedItems) {
    const { item, rowIndex, material_name, category, normalizedCode, normalizedUnit, resolvedSubcategory } = prepared;

    try {
      if (conflictMap.has(rowIndex)) {
        tracker.recordError(rowIndex, normalizedCode, conflictMap.get(rowIndex));
        continue;
      }

      // 创建物料
      const newMaterial = {
        product_code: normalizedCode,
        category,
        subcategory_key: resolvedSubcategory.subcategory_key,
        sub_category: resolvedSubcategory.sub_category,
        ...buildGovernedMaterialMasterFields({
          ...item,
          material_name,
          category,
          default_unit: normalizedUnit,
          supplier: item.supplier || '',
          supplier_model: item.supplier_model || '',
          subcategory_key: resolvedSubcategory.subcategory_key,
          sub_category: resolvedSubcategory.sub_category
        }, category),
        status: 'active',
        created_by: openid,
        created_at: now,
        updated_by: openid,
        updated_at: now
      };

      const createOutcome = await createBatchMaterialWithAudit(newMaterial, openid);
      if (createOutcome.status === 'skipped') {
        tracker.recordSkipped(rowIndex, normalizedCode, createOutcome.reason);
        continue;
      }
      created++;
      tracker.recordCreated(rowIndex, normalizedCode);

    } catch (err) {
      console.error('创建物料失败:', item.product_code, err);
      tracker.recordError(rowIndex, item.product_code, err.message || '创建物料失败');
    }
  }

  const importResult = tracker.toResponse();
  const skipped = importResult.skipped;
  const errors = importResult.errors;
  let warning = '';

  try {
    await writeMaterialAuditEvent(db, openid, {
      action: 'batch_create',
      changes: { total: items.length, created, skipped, errors }
    });
  } catch (err) {
    console.error('批量物料导入汇总审计写入失败:', err);
    warning = '物料已按行处理完成，但汇总审计记录写入失败，请联系管理员核查审计日志';
  }

  return {
    success: true,
    created,
    skipped,
    errors,
    results: importResult.results,
    ...(warning ? { warning } : {}),
    msg: `成功导入 ${created} 条`
  };
}

/**
 * 批量删除/归档物料 (智能策略)
 */
async function batchDeleteMaterials(data, openid) {
  const { ids, archive_reason } = data;
  const authResult = await assertManageMaterialAdminMutation(openid);
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { success: false, msg: '请选择要删除的物料' };
  }

  const normalizedIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)));

  try {
    const outcome = await runMaterialTransaction(async (transaction) => {
      const prepared = [];

      for (const id of normalizedIds) {
        const materialRef = transaction.collection('materials').doc(id);
        const materialRes = await materialRef.get();
        if (!materialRes.data) {
          throw new Error('物料不存在');
        }

        const currentInventoryRes = await transaction.collection('inventory')
          .where({ material_id: id, status: 'in_stock' })
          .limit(1)
          .get();
        if (currentInventoryRes.data && currentInventoryRes.data.length > 0) {
          throw new Error(`物料 ${materialRes.data.product_code || id} 存在在库记录，不能归档`);
        }

        const historyRes = await transaction.collection('inventory')
          .where({ material_id: id })
          .limit(1)
          .get();
        prepared.push({
          id,
          materialRef,
          material: materialRes.data,
          hasHistory: !!(historyRes.data && historyRes.data.length > 0)
        });
      }

      let deleted = 0;
      let archived = 0;
      for (const item of prepared) {
        if (item.hasHistory) {
          await item.materialRef.update({
            data: {
              status: 'archived',
              archive_reason: archive_reason || '批量删除归档',
              updated_by: openid,
              updated_at: db.serverDate()
            }
          });
          await writeMaterialAuditEvent(transaction, openid, {
            material_id: item.id,
            product_code: item.material.product_code,
            action: 'batch_archive',
            old_data: item.material,
            new_data: {
              status: 'archived',
              archive_reason: archive_reason || '批量删除归档'
            }
          });
          archived += 1;
        } else {
          await item.materialRef.remove();
          await writeMaterialAuditEvent(transaction, openid, {
            material_id: item.id,
            product_code: item.material.product_code,
            action: 'batch_delete',
            old_data: item.material,
            new_data: { removed: true }
          });
          deleted += 1;
        }
      }

      return { deleted, archived };
    });

    return {
      success: true,
      deleted: outcome.deleted,
      archived: outcome.archived,
      failed: 0,
      errors: [],
      msg: `成功删除 ${outcome.deleted} 条，归档 ${outcome.archived} 条`
    };
  } catch (err) {
    console.error('批量删除/归档物料失败:', err);
    return {
      success: false,
      deleted: 0,
      archived: 0,
      failed: normalizedIds.length,
      errors: [{ msg: err.message || '处理失败' }],
      msg: err.message || '批量删除或归档失败'
    };
  }
}

/**
 * 还原归档物料
 */
async function restoreMaterial(data, openid) {
  const { id } = data;
  const authResult = await assertManageMaterialAdminMutation(openid);
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }
  if (!id) return { success: false, msg: '缺少参数' };

  try {
    await runMaterialTransaction(async (transaction) => {
      const materialRef = transaction.collection('materials').doc(id);
      const material = await materialRef.get();
      if (!material.data) {
        throw new Error('物料不存在');
      }

      const conflict = await transaction.collection('materials').where({
        product_code: material.data.product_code,
        status: _.neq('archived')
      }).limit(1).get();

      if (conflict.data && conflict.data.length > 0) {
        throw new Error('当前活跃库中已存在相同代码的物料，无法还原');
      }

      const restoreData = {
        status: 'active',
        archive_reason: _.remove(),
        updated_by: openid,
        updated_at: db.serverDate()
      };
      await materialRef.update({ data: restoreData });
      await writeMaterialAuditEvent(transaction, openid, {
        material_id: id,
        product_code: material.data.product_code,
        action: 'restore',
        old_data: material.data,
        new_data: { status: 'active' }
      });
    });

    return { success: true, msg: '已还原' };
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message || '还原失败' };
  }
}

/**
 * 检查物料状态 (用于入库页)
 */
async function checkMaterialStatus(data) {
  const { product_code } = data;
  if (!product_code) return { success: false };

  // 构造可能的前缀组合
  const codes = [product_code];
  if (!/^[A-Z]{1,4}-/u.test(product_code)) {
    const prefixRecords = await ensureBuiltinProductCodePrefixes(db);
    const prefixes = Array.from(new Set(
      prefixRecords
        .filter(item => item.status !== 'disabled')
        .map(item => item.prefix)
        .filter(Boolean)
    ));
    prefixes.forEach((prefix) => {
      codes.push(`${prefix}-${product_code}`);
    });
  }

  // 使用 in 查询匹配任意一种情况
  const res = await db.collection('materials').where({
    product_code: db.command.in(codes),
    status: 'archived'
  }).get();

  if (res.data.length > 0) {
    return {
      success: true,
      isArchived: true,
      product_code: res.data[0].product_code,
      reason: res.data[0].archive_reason || '未说明'
    };
  }

  return { success: true, isArchived: false };
}

/**
 * 检查物料历史记录 (用于删除/归档前的确认)
 * 返回 toDelete (无历史记录) 和 toArchive (有历史记录) 两个列表
 */
async function checkMaterialHistory(data) {
  const { ids } = data;
  if (!ids || ids.length === 0) return { success: false, msg: '缺少参数' };

  const toDelete = [];
  const toArchive = [];

  for (const id of ids) {
    try {
      // 获取物料信息
      const materialRes = await db.collection('materials').doc(id).get();
      if (!materialRes.data) continue;

      const material = materialRes.data;

      // 检查是否有库存记录
      const inventoryCount = await db.collection('inventory')
        .where({ product_code: material.product_code })
        .count();

      if (inventoryCount.total > 0) {
        // 有历史记录 -> 归档
        toArchive.push({ _id: id, product_code: material.product_code });
      } else {
        // 无历史记录 -> 可删除
        toDelete.push({ _id: id, product_code: material.product_code });
      }
    } catch (err) {
      console.error('Check history error for id:', id, err);
    }
  }

  return {
    success: true,
    toDelete,
    toArchive
  };
}
