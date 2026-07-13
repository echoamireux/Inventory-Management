const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const {
  normalizeProductCodePrefix,
  normalizePrefixCategory,
  normalizeStatus,
  ensureBuiltinProductCodePrefixes,
  sortProductCodePrefixRecords,
  filterProductCodePrefixRecordsByCategory
} = require('./product-code-prefixes');
const { writeAuditEvent } = require('./audit-events');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function getPrefixRecords(includeDisabled = false) {
  const records = sortProductCodePrefixRecords(await ensureBuiltinProductCodePrefixes(db));
  return includeDisabled ? records : records.filter(item => item.status === 'active');
}

async function findPrefix(prefix) {
  const records = await getPrefixRecords(true);
  return records.find(item => item.prefix === prefix) || null;
}

async function writePrefixAudit(action, operator, openid, record = {}, detail = {}) {
  await writeAuditEvent(db, db, {
    domain: 'product_prefix',
    action,
    operator: Object.assign({}, operator || {}, { _openid: openid }),
    target: {
      type: 'product_code_prefix',
      id: record._id || record.prefix || '',
      label: record.prefix || ''
    },
    after: record,
    detail
  });
}

async function listPrefixes(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看产品代码前缀');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const records = await getPrefixRecords(!!(event && event.includeDisabled));
  const category = event && event.category ? normalizePrefixCategory(event.category) : '';
  return {
    success: true,
    list: category
      ? filterProductCodePrefixRecordsByCategory(records, category, {
        includeDisabled: !!(event && event.includeDisabled)
      })
      : records
  };
}

async function createPrefix(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护产品代码前缀');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const prefix = normalizeProductCodePrefix(event && event.prefix);
  const category = normalizePrefixCategory(event && event.category);
  if (!/^[A-Z]{1,4}$/u.test(prefix)) {
    return { success: false, msg: '前缀必须为 1-4 位大写英文字母，例如 J、JP、LAB' };
  }
  if (await findPrefix(prefix)) {
    return { success: false, msg: '产品代码前缀已存在' };
  }

  const records = await getPrefixRecords(true);
  const maxOrder = records.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0);
  const res = await db.collection('product_code_prefixes').add({
    data: {
      prefix,
      category,
      status: 'active',
      is_builtin: false,
      sort_order: maxOrder + 10,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });
  await writePrefixAudit('create', operator, openid, { _id: res._id, prefix, category, status: 'active' });

  return {
    success: true,
    msg: '创建成功',
    id: res._id,
    prefix
  };
}

async function assertCategoryHasActiveAfter(prefixRecord, nextStatus) {
  if (nextStatus === 'active') {
    return { ok: true };
  }
  const records = await getPrefixRecords(true);
  const activeSameCategory = records.filter(item => (
    item.category === prefixRecord.category
    && item.prefix !== prefixRecord.prefix
    && item.status === 'active'
  ));
  if (!activeSameCategory.length) {
    return {
      ok: false,
      msg: '至少保留一个启用的产品代码前缀'
    };
  }
  return { ok: true };
}

async function setPrefixStatus(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护产品代码前缀');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const prefix = normalizeProductCodePrefix(event && event.prefix);
  const nextStatus = normalizeStatus(event && event.status);
  const record = await findPrefix(prefix);
  if (!record || !record._id) {
    return { success: false, msg: '产品代码前缀不存在' };
  }
  const guard = await assertCategoryHasActiveAfter(record, nextStatus);
  if (!guard.ok) {
    return { success: false, msg: guard.msg };
  }

  await db.collection('product_code_prefixes').doc(record._id).update({
    data: {
      status: nextStatus,
      updated_at: db.serverDate()
    }
  });
  await writePrefixAudit('status', operator, openid, Object.assign({}, record, { status: nextStatus }), {
    previous_status: record.status,
    next_status: nextStatus
  });

  return {
    success: true,
    msg: nextStatus === 'active' ? '已启用' : '已停用'
  };
}

async function reorderPrefixes(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护产品代码前缀');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const prefixes = Array.isArray(event && event.prefixes)
    ? event.prefixes.map(normalizeProductCodePrefix).filter(Boolean)
    : [];
  if (!prefixes.length) {
    return { success: false, msg: '缺少排序数据' };
  }

  const records = await getPrefixRecords(true);
  const recordMap = new Map(records.map(item => [item.prefix, item]));
  const validPrefixes = prefixes.filter(prefix => recordMap.has(prefix));
  if (!validPrefixes.length) {
    return { success: false, msg: '未找到可排序的产品代码前缀' };
  }

  for (let index = 0; index < validPrefixes.length; index += 1) {
    const record = recordMap.get(validPrefixes[index]);
    await db.collection('product_code_prefixes').doc(record._id).update({
      data: {
        sort_order: (index + 1) * 10,
        updated_at: db.serverDate()
      }
    });
  }
  await writePrefixAudit('reorder', operator, openid, { prefix: validPrefixes.join(',') }, {
    prefixes: validPrefixes
  });

  return { success: true, msg: '排序已更新' };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : 'list';

  try {
    if (action === 'list') {
      return await listPrefixes(event || {}, OPENID);
    }
    if (action === 'create') {
      return await createPrefix(event || {}, OPENID);
    }
    if (action === 'setStatus') {
      return await setPrefixStatus(event || {}, OPENID);
    }
    if (action === 'reorder') {
      return await reorderPrefixes(event || {}, OPENID);
    }

    return { success: false, msg: `不支持的操作: ${action}` };
  } catch (error) {
    console.error('manageProductCodePrefix error', error);
    return { success: false, msg: error.message || '产品代码前缀操作失败' };
  }
};
