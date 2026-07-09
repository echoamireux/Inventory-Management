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
  const name = String((event && event.name) || '').trim();
  if (!/^[A-Z]-$/u.test(prefix)) {
    return { success: false, msg: '前缀必须为单个大写字母加横杠，例如 S-' };
  }
  if (!name) {
    return { success: false, msg: '请输入前缀名称' };
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
      name,
      status: 'active',
      is_builtin: false,
      sort_order: maxOrder + 10,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: '创建成功',
    id: res._id,
    prefix
  };
}

async function updatePrefix(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护产品代码前缀');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const prefix = normalizeProductCodePrefix(event && event.prefix);
  const name = String((event && event.name) || '').trim();
  if (!prefix) {
    return { success: false, msg: '缺少产品代码前缀' };
  }
  if (!name) {
    return { success: false, msg: '请输入前缀名称' };
  }

  const record = await findPrefix(prefix);
  if (!record || !record._id) {
    return { success: false, msg: '产品代码前缀不存在' };
  }

  await db.collection('product_code_prefixes').doc(record._id).update({
    data: {
      name,
      updated_at: db.serverDate()
    }
  });

  return { success: true, msg: '保存成功' };
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
    if (action === 'update') {
      return await updatePrefix(event || {}, OPENID);
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
