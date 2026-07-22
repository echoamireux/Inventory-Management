const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const { writeAuditEvent } = require('./audit-events');
const { buildContainsRegExp } = require('./search');
const {
  normalizeCategory,
  normalizeStatus,
  normalizeProductCode,
  normalizeTestMaterialSupplierModel,
  normalizeTestMaterialIdentityRecord,
  findTestMaterialIdentityConflict
} = require('./test-material-identities');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const MAX_BATCH_IDENTITY_IMPORT_ROWS = 100;

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

async function loadMaterialForIdentity(source = {}) {
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

  const res = await db.collection('materials').where(query).limit(1).get();
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

async function loadRelatedIdentities(category, productCode) {
  const res = await db.collection('test_material_identities')
    .where({
      category,
      product_code: productCode
    })
    .limit(100)
    .get();
  return res.data || [];
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

  const searchRegex = buildContainsRegExp(db, event.searchVal || event.keyword);
  if (searchRegex) {
    conditions.push(_.or([
      { product_code: searchRegex },
      { supplier_model: searchRegex },
      { supplier_model_key: searchRegex },
      { material_name: searchRegex }
    ]));
  }

  const where = conditions.length ? _.and(conditions) : {};
  const totalRes = await db.collection('test_material_identities').where(where).count();
  const res = await db.collection('test_material_identities')
    .where(where)
    .orderBy('updated_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    success: true,
    list: (res.data || []).map(normalizeTestMaterialIdentityRecord),
    total: Number(totalRes.total) || 0,
    page,
    pageSize
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
  const candidate = normalizeTestMaterialIdentityRecord({
    category: material.category,
    material_id: material._id,
    product_code: material.product_code,
    material_name: material.material_name || material.name || '',
    supplier_model: event.supplier_model || event.supplierModel,
    status: 'active'
  });
  if (!candidate.supplier_model_key) {
    return { success: false, msg: '请输入原厂型号' };
  }

  const related = await loadRelatedIdentities(candidate.category, candidate.product_code);
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
    material_name: candidate.material_name,
    supplier_model: candidate.supplier_model,
    supplier_model_key: candidate.supplier_model_key,
    identity_key: candidate.identity_key,
    status: 'active',
    created_by: openid,
    updated_by: openid,
    created_at: now,
    updated_at: now
  };

  const res = await db.collection('test_material_identities').add({ data });
  await writeIdentityAudit(db, 'create', operator, openid, { _id: res._id, ...data });
  return {
    success: true,
    msg: '创建成功',
    id: res._id,
    data: { _id: res._id, ...data }
  };
}

async function batchCreateIdentities(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护测试料型号库');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const rows = Array.isArray(event.rows) ? event.rows : [];
  if (!rows.length) {
    return { success: false, msg: '未检测到可导入的型号数据' };
  }
  if (rows.length > MAX_BATCH_IDENTITY_IMPORT_ROWS) {
    return { success: false, msg: `单次最多导入 ${MAX_BATCH_IDENTITY_IMPORT_ROWS} 条测试料型号` };
  }

  const results = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const rowIndex = Math.max(1, Number(row.rowIndex) || (index + 1));
    const rowLabel = `第${rowIndex}行`;
    try {
      const created = await createIdentity({
        ...row,
        confirmSimilar: !!event.confirmSimilar
      }, openid);
      results.push({
        rowIndex,
        status: created.success ? 'created' : 'error',
        msg: created.msg,
        code: created.code || '',
        supplier_model: normalizeTestMaterialSupplierModel(row.supplier_model || row.supplierModel)
      });
    } catch (error) {
      results.push({
        rowIndex,
        status: 'error',
        msg: `${rowLabel}${error.message || '导入失败'}`
      });
    }
  }

  const createdCount = results.filter(item => item.status === 'created').length;
  await writeIdentityAudit(db, 'batch_create', operator, openid, {
    identity_key: 'batch',
    product_code: ''
  }, {
    total: rows.length,
    created: createdCount,
    errors: results.length - createdCount
  });

  return {
    success: true,
    msg: `导入完成，新增 ${createdCount} 条`,
    results,
    created: createdCount,
    errors: results.length - createdCount
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
  const status = normalizeStatus(event.status);
  if (!identityKey && !id) {
    return { success: false, msg: '缺少测试料型号标识' };
  }

  const query = id ? { _id: id } : { identity_key: identityKey };
  const res = await db.collection('test_material_identities').where(query).limit(1).get();
  const record = res.data && res.data[0];
  if (!record || !record._id) {
    return { success: false, msg: '测试料型号不存在' };
  }

  await db.collection('test_material_identities').doc(record._id).update({
    data: {
      status,
      updated_by: openid,
      updated_at: db.serverDate()
    }
  });
  await writeIdentityAudit(db, 'status', operator, openid, {
    ...record,
    status
  }, {
    previous_status: record.status,
    next_status: status
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
    if (action === 'create') {
      return await createIdentity(event, OPENID);
    }
    if (action === 'batchCreate') {
      return await batchCreateIdentities(event, OPENID);
    }
    if (action === 'setStatus') {
      return await setIdentityStatus(event, OPENID);
    }
    return { success: false, msg: `不支持的操作: ${action}` };
  } catch (error) {
    console.error('manageTestMaterialIdentity error', error);
    return { success: false, msg: error.message || '测试料型号库操作失败' };
  }
};
