const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const { writeAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');
const {
  buildContainsRegExp,
  normalizeSearchKeyword,
  rankSearchResults
} = require('./search');
const {
  normalizeCategory,
  normalizeProductCode,
  normalizeTestMaterialSupplier,
  normalizeTestMaterialLabelName,
  normalizeTestMaterialSupplierModel,
  normalizeTestMaterialIdentityRecord,
  buildSimilarSupplierModelKey,
  findTestMaterialIdentityConflict
} = require('./test-material-identities');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategorySelection
} = require('./material-subcategories');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const MAX_SEARCH_CANDIDATES = 200;

function parseMutationStatus(status) {
  const normalized = String(status || '').trim();
  return normalized === 'active' || normalized === 'disabled' ? normalized : '';
}

function isCollectionExistsError(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '');
  return /DATABASE_COLLECTION_ALREADY_EXIST|DATABASE_COLLECTION_ALREADY_EXISTS|ResourceExist|Table exist/i.test(message);
}

async function ensureCollection() {
  if (typeof db.createCollection !== 'function') {
    return;
  }
  try {
    await db.createCollection('test_material_identities');
  } catch (error) {
    if (!isCollectionExistsError(error)) {
      throw error;
    }
  }
}

async function loadOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function loadMaterialForIdentity(source = {}, collectionOwner = db) {
  const materialId = String(source.material_id || source.materialId || '').trim();
  const productCode = normalizeProductCode(source.product_code || source.productCode);
  let query = null;
  if (materialId) {
    query = { _id: materialId };
  } else if (productCode) {
    query = { product_code: productCode };
  }
  if (!query) {
    throw new Error('请选择测试料主数据');
  }

  const res = await collectionOwner.collection('materials').where(query).limit(1).get();
  const material = res.data && res.data[0];
  if (!material) {
    throw new Error('测试料主数据不存在');
  }
  if (material.status !== 'active') {
    throw new Error('测试料主数据未启用');
  }
  if (!material.is_test_material) {
    throw new Error('所选物料主数据不是测试料');
  }
  return material;
}

async function loadConflictCandidateIdentities(candidate = {}, collectionOwner = db) {
  const normalized = normalizeTestMaterialIdentityRecord(candidate);
  const rows = [];

  if (normalized.identity_key) {
    const exactRes = await collectionOwner.collection('test_material_identities')
      .where({ identity_key: normalized.identity_key })
      .limit(1)
      .get();
    rows.push(...(exactRes.data || []));
  }

  const similarKey = normalized.similar_key || buildSimilarSupplierModelKey(normalized.supplier_model_key);
  if (normalized.category && normalized.product_code && similarKey) {
    const similarRes = await collectionOwner.collection('test_material_identities')
      .where({
        category: normalized.category,
        product_code: normalized.product_code,
        similar_key: similarKey
      })
      .limit(20)
      .get();
    rows.push(...(similarRes.data || []));
  }

  const seen = new Set();
  return rows.filter((item) => {
    const key = item && (item._id || item.identity_key);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadSubcategoryContext(category = '', collectionOwner = db) {
  const allRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(collectionOwner === db ? db : collectionOwner));
  const records = category
    ? filterSubcategoryRecordsByCategory(allRecords, category, { includeDisabled: true })
    : allRecords;
  return {
    records,
    map: buildSubcategoryMap(records)
  };
}

async function resolveIdentitySubcategory(source = {}, category = '') {
  const context = await loadSubcategoryContext(category);
  const resolved = resolveSubcategorySelection({
    category,
    subcategory_key: source.subcategory_key || source.subcategoryKey,
    sub_category: source.sub_category || source.subCategory
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

async function writeIdentityAudit(collectionOwner, action, operator, openid, record = {}, detail = {}) {
  await writeAuditEvent(collectionOwner, db, {
    domain: 'test_material_identity',
    action,
    operator: Object.assign({}, operator || {}, { _openid: openid }),
    target: {
      type: 'test_material_identity',
      id: record.identity_key || record._id || '',
      label: [record.product_code, record.supplier_model].filter(Boolean).join(' ')
    },
    after: record,
    detail
  });
}

async function listIdentities(event, openid) {
  const operator = await loadOperator(openid);
  const activeResult = assertActiveUserAccess(operator, '仅已激活用户可查看测试料型号库');
  if (!activeResult.ok) {
    return { success: false, msg: activeResult.msg };
  }

  await ensureCollection();
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(event.pageSize) || 20));
  const includeDisabled = !!event.includeDisabled;
  const conditions = [];
  if (!includeDisabled) {
    conditions.push({ status: 'active' });
  }
  if (event.category) {
    conditions.push({ category: normalizeCategory(event.category) });
  }
  if (event.product_code || event.productCode) {
    conditions.push({ product_code: normalizeProductCode(event.product_code || event.productCode) });
  }
  if (event.material_id || event.materialId) {
    conditions.push({ material_id: String(event.material_id || event.materialId || '').trim() });
  }

  const normalizedKeyword = normalizeSearchKeyword(event.searchVal || event.keyword);
  const searchRegex = buildContainsRegExp(db, normalizedKeyword);
  if (searchRegex) {
    conditions.push(_.or([
      { product_code: searchRegex },
      { supplier_model: searchRegex },
      { supplier_model_key: searchRegex },
      { supplier: searchRegex },
      { label_material_name: searchRegex },
      { material_name: searchRegex },
      { subcategory_key: searchRegex },
      { sub_category: searchRegex }
    ]));
  }

  const where = conditions.length ? _.and(conditions) : {};
  const totalRes = await db.collection('test_material_identities').where(where).count();
  let list = [];
  let searchTruncated = false;
  if (normalizedKeyword) {
    const candidateRes = await db.collection('test_material_identities')
      .where(where)
      .orderBy('updated_at', 'desc')
      .limit(MAX_SEARCH_CANDIDATES + 1)
      .get();
    const candidates = (candidateRes.data || []).map(normalizeTestMaterialIdentityRecord);
    searchTruncated = candidates.length > MAX_SEARCH_CANDIDATES;
    list = rankSearchResults(candidates.slice(0, MAX_SEARCH_CANDIDATES), normalizedKeyword, {
      codeFields: ['product_code'],
      modelFields: ['supplier_model', 'supplier_model_key'],
      nameFields: ['label_material_name', 'material_name'],
      auxiliaryFields: ['supplier', 'category', 'material_id', 'subcategory_key', 'sub_category'],
      stableFields: ['product_code', 'supplier_model', '_id']
    }).slice((page - 1) * pageSize, page * pageSize);
  } else {
    const res = await db.collection('test_material_identities')
      .where(where)
      .orderBy('updated_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    list = (res.data || []).map(normalizeTestMaterialIdentityRecord);
  }

  return {
    success: true,
    list,
    total: Number(totalRes.total) || 0,
    page,
    pageSize,
    ...(normalizedKeyword ? {
      searchTruncated,
      searchMessage: searchTruncated ? '结果较多，请继续输入关键词' : ''
    } : {})
  };
}

async function getIdentity(event, openid) {
  const operator = await loadOperator(openid);
  const activeResult = assertActiveUserAccess(operator, '仅已激活用户可查看测试料型号库');
  if (!activeResult.ok) {
    return { success: false, msg: activeResult.msg };
  }

  await ensureCollection();
  const id = String(event.id || event._id || '').trim();
  const identityKey = String(event.identity_key || event.identityKey || '').trim();
  if (!id && !identityKey) {
    return { success: false, msg: '缺少测试料型号标识' };
  }
  const query = id ? { _id: id } : { identity_key: identityKey };
  const res = await db.collection('test_material_identities').where(query).limit(1).get();
  const record = res.data && res.data[0];
  if (!record) {
    return { success: false, msg: '测试料型号不存在' };
  }
  return {
    success: true,
    data: normalizeTestMaterialIdentityRecord(record)
  };
}

async function createIdentity(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护测试料型号库');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  await ensureCollection();
  const material = await loadMaterialForIdentity(event);
  const labelMaterialName = normalizeTestMaterialLabelName(event.label_material_name || event.material_name || event.materialName);
  if (!labelMaterialName) {
    return { success: false, msg: '请输入物料名称' };
  }
  const resolvedSubcategory = await resolveIdentitySubcategory(event, material.category);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }
  const candidate = normalizeTestMaterialIdentityRecord({
    category: material.category,
    material_id: material._id,
    product_code: material.product_code,
    label_material_name: labelMaterialName,
    material_name: labelMaterialName,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category,
    supplier: event.supplier,
    supplier_model: event.supplier_model || event.supplierModel,
    status: 'active'
  });
  if (!candidate.supplier_model_key) {
    return { success: false, msg: '请输入原厂型号' };
  }

  const related = await loadConflictCandidateIdentities(candidate);
  const conflict = findTestMaterialIdentityConflict(related, candidate);
  if (conflict.type === 'exact') {
    return { success: false, msg: '该测试料原厂型号已存在' };
  }
  if (conflict.type === 'similar' && !event.confirmSimilar) {
    return {
      success: false,
      code: 'SIMILAR_TEST_MATERIAL_IDENTITY',
      msg: `已存在相似型号 ${conflict.record.supplier_model}，请确认是否仍要新增`,
      similar: conflict.record
    };
  }

  const now = db.serverDate();
  const data = {
    category: candidate.category,
    material_id: material._id,
    product_code: candidate.product_code,
    label_material_name: candidate.label_material_name,
    material_name: candidate.label_material_name,
    subcategory_key: candidate.subcategory_key,
    sub_category: candidate.sub_category,
    supplier: candidate.supplier,
    supplier_model: candidate.supplier_model,
    supplier_model_key: candidate.supplier_model_key,
    identity_key: candidate.identity_key,
    similar_key: candidate.similar_key,
    status: 'active',
    created_by: openid,
    updated_by: openid,
    created_at: now,
    updated_at: now
  };

  const res = await db.runTransaction(async transaction => {
    const currentMaterial = await loadMaterialForIdentity(event, transaction);
    if (currentMaterial._id !== material._id || currentMaterial.product_code !== material.product_code) {
      throw new Error('测试料主数据已变化，请刷新后重试');
    }
    const duplicateRes = await transaction.collection('test_material_identities')
      .where({ identity_key: candidate.identity_key })
      .limit(1)
      .get();
    if (duplicateRes.data && duplicateRes.data.length) {
      throw new Error('该测试料原厂型号已存在');
    }
    const created = await transaction.collection('test_material_identities').add({ data });
    await writeIdentityAudit(transaction, 'create', operator, openid, { _id: created._id, ...data });
    return created;
  });
  return {
    success: true,
    msg: '创建成功',
    id: res._id,
    data: { _id: res._id, ...data }
  };
}

async function updateIdentity(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护测试料型号库');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  await ensureCollection();
  const id = String(event.id || event._id || '').trim();
  const identityKey = String(event.identity_key || event.identityKey || '').trim();
  if (!id && !identityKey) {
    return { success: false, msg: '缺少测试料型号标识' };
  }

  const query = id ? { _id: id } : { identity_key: identityKey };
  const oldRes = await db.collection('test_material_identities').where(query).limit(1).get();
  const oldRecord = oldRes.data && oldRes.data[0];
  if (!oldRecord || !oldRecord._id) {
    return { success: false, msg: '测试料型号不存在' };
  }

  const productCode = normalizeProductCode(event.product_code || event.productCode || oldRecord.product_code);
  const material = await loadMaterialForIdentity({
    material_id: event.material_id || event.materialId || oldRecord.material_id,
    product_code: productCode
  });
  const labelMaterialName = normalizeTestMaterialLabelName(
    event.label_material_name || event.material_name || event.materialName || oldRecord.label_material_name || oldRecord.material_name
  );
  if (!labelMaterialName) {
    return { success: false, msg: '请输入物料名称' };
  }
  const resolvedSubcategory = await resolveIdentitySubcategory({
    subcategory_key: event.subcategory_key || event.subcategoryKey || oldRecord.subcategory_key,
    sub_category: event.sub_category || event.subCategory || oldRecord.sub_category
  }, material.category);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }

  const candidate = normalizeTestMaterialIdentityRecord({
    ...oldRecord,
    category: material.category,
    material_id: material._id,
    product_code: material.product_code,
    label_material_name: labelMaterialName,
    material_name: labelMaterialName,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category,
    supplier: Object.prototype.hasOwnProperty.call(event, 'supplier') ? event.supplier : oldRecord.supplier,
    supplier_model: event.supplier_model || event.supplierModel || oldRecord.supplier_model,
    // 不得回落到 oldRecord.supplier_model_key：normalizeTestMaterialIdentityRecord
    // 会优先采用传入的 key（record.supplier_model_key || supplierModel），沿用旧 key
    // 会让改名后的记录仍挂在旧的 supplier_model_key / identity_key 上 —— 显示值与
    // 唯一键脱节，可以建出两条实质同型号的记录，绕过唯一性约束。
    // 前端只提交 supplier_model，此处留空即由新型号重新派生 key。
    supplier_model_key: event.supplier_model_key || event.supplierModelKey || '',
    status: oldRecord.status || 'active'
  });
  if (!candidate.supplier_model_key) {
    return { success: false, msg: '请输入原厂型号' };
  }

  const related = await loadConflictCandidateIdentities(candidate);
  const conflict = findTestMaterialIdentityConflict(
    related.filter(item => item._id !== oldRecord._id),
    candidate
  );
  if (conflict.type === 'exact') {
    return { success: false, msg: '该测试料原厂型号已存在' };
  }
  if (conflict.type === 'similar' && !event.confirmSimilar) {
    return {
      success: false,
      code: 'SIMILAR_TEST_MATERIAL_IDENTITY',
      msg: `已存在相似型号 ${conflict.record.supplier_model}，请确认是否仍要保存`,
      similar: conflict.record
    };
  }

  const updateData = {
    category: candidate.category,
    material_id: material._id,
    product_code: candidate.product_code,
    label_material_name: candidate.label_material_name,
    material_name: candidate.label_material_name,
    subcategory_key: candidate.subcategory_key,
    sub_category: candidate.sub_category,
    supplier: candidate.supplier,
    supplier_model: candidate.supplier_model,
    supplier_model_key: candidate.supplier_model_key,
    identity_key: candidate.identity_key,
    similar_key: candidate.similar_key,
    updated_by: openid,
    updated_at: db.serverDate()
  };

  await db.runTransaction(async transaction => {
    const currentRes = await transaction.collection('test_material_identities')
      .where({ _id: oldRecord._id })
      .limit(1)
      .get();
    const current = currentRes.data && currentRes.data[0];
    if (!current || !current._id) {
      throw new Error('测试料型号不存在');
    }
    if (candidate.identity_key !== current.identity_key) {
      const duplicateRes = await transaction.collection('test_material_identities')
        .where({ identity_key: candidate.identity_key })
        .limit(1)
        .get();
      const duplicate = duplicateRes.data && duplicateRes.data[0];
      if (duplicate && duplicate._id !== current._id) {
        throw new Error('该测试料原厂型号已存在');
      }
    }
    await transaction.collection('test_material_identities').doc(current._id).update({
      data: updateData
    });
    await writeIdentityAudit(transaction, 'update', operator, openid, {
      _id: current._id,
      ...current,
      ...updateData
    }, {
      before: current,
      after: updateData
    });
  });

  return {
    success: true,
    msg: '保存成功',
    id: oldRecord._id,
    data: {
      _id: oldRecord._id,
      ...oldRecord,
      ...updateData
    }
  };
}

async function setIdentityStatus(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护测试料型号库');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const identityKey = String(event.identity_key || event.identityKey || '').trim();
  const id = String(event.id || event._id || '').trim();
  const status = parseMutationStatus(event.status);
  if (!status) {
    return { success: false, msg: '状态仅支持 active 或 disabled' };
  }
  if (!identityKey && !id) {
    return { success: false, msg: '缺少测试料型号标识' };
  }

  const query = id ? { _id: id } : { identity_key: identityKey };
  await db.runTransaction(async transaction => {
    const res = await transaction.collection('test_material_identities').where(query).limit(1).get();
    const record = res.data && res.data[0];
    if (!record || !record._id) {
      throw new Error('测试料型号不存在');
    }

    await transaction.collection('test_material_identities').doc(record._id).update({
      data: {
        status,
        updated_by: openid,
        updated_at: db.serverDate()
      }
    });
    await writeIdentityAudit(transaction, 'status', operator, openid, {
      ...record,
      status
    }, {
      previous_status: record.status,
      next_status: status
    });
  });

  return {
    success: true,
    msg: status === 'active' ? '已启用' : '已停用'
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';
  try {
    if (action === 'list') {
      return await listIdentities(event, OPENID);
    }
    if (action === 'get') {
      return await getIdentity(event, OPENID);
    }
    if (action === 'create') {
      return await createIdentity(event, OPENID);
    }
    if (action === 'update') {
      return await updateIdentity(event, OPENID);
    }
    if (action === 'setStatus') {
      return await setIdentityStatus(event, OPENID);
    }
    return { success: false, msg: `不支持的操作: ${action}` };
  } catch (error) {
    return handleCloudError(error, {
      scope: 'manageTestMaterialIdentity',
      fallbackMessage: '测试料型号库操作失败，请稍后重试'
    });
  }
};
