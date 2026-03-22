const cloud = require('wx-server-sdk');
const { assertAdminAccess } = require('./auth');
const {
  normalizeParentCategory,
  normalizeSubcategoryName,
  normalizeStatus,
  isReservedSubcategoryName,
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  findSubcategoryRecordByName
} = require('./material-subcategories');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function buildCustomSubcategoryKey(category) {
  return `custom:${normalizeParentCategory(category)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function getOperator(openid) {
  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return userRes.data && userRes.data[0];
}

async function listSubcategories(event) {
  const allRecords = await ensureBuiltinSubcategories(db);
  const normalized = sortSubcategoryRecords(allRecords);
  const filtered = event && event.category
    ? filterSubcategoryRecordsByCategory(normalized, event.category, {
      includeDisabled: !!event.includeDisabled,
      includeDeprecated: false
    })
    : normalized.filter(item => {
      if (isReservedSubcategoryName(item.name)) {
        return false;
      }
      return event && event.includeDisabled ? true : item.status === 'active';
    });

  return {
    success: true,
    list: filtered
  };
}

async function createSubcategory(name, category, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可新建子类别');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedCategory = normalizeParentCategory(category);
  const normalizedName = normalizeSubcategoryName(name);
  if (!normalizedName) {
    return { success: false, msg: '请输入子类别名称' };
  }
  if (isReservedSubcategoryName(normalizedName)) {
    return { success: false, msg: '“其他”不再作为正式子类别，请创建明确的正式子类别名称' };
  }

  const existingRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const existing = findSubcategoryRecordByName(existingRecords, normalizedName, normalizedCategory);
  if (existing) {
    if (existing.status === 'disabled' && existing._id) {
      await db.collection('material_subcategories').doc(existing._id).update({
        data: {
          status: 'active',
          updated_at: db.serverDate()
        }
      });
    }

    return {
      success: true,
      msg: '子类别已存在',
      subcategory_key: existing.subcategory_key,
      id: existing._id
    };
  }

  const activeRecords = existingRecords.filter(item => item.parent_category === normalizedCategory);
  const maxSortOrder = activeRecords.reduce(
    (max, item) => Math.max(max, Number(item.sort_order) || 0),
    normalizedCategory === 'film' ? 100 : 0
  );
  const subcategoryKey = buildCustomSubcategoryKey(normalizedCategory);

  const res = await db.collection('material_subcategories').add({
    data: {
      subcategory_key: subcategoryKey,
      name: normalizedName,
      parent_category: normalizedCategory,
      is_builtin: false,
      status: 'active',
      sort_order: maxSortOrder + 10,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: '创建成功',
    subcategory_key: subcategoryKey,
    id: res._id
  };
}

async function renameSubcategory(subcategoryKey, name, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可重命名子类别');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedName = normalizeSubcategoryName(name);
  if (!normalizedName) {
    return { success: false, msg: '请输入子类别名称' };
  }
  if (isReservedSubcategoryName(normalizedName)) {
    return { success: false, msg: '“其他”不再作为正式子类别，请改为明确的正式子类别名称' };
  }

  const existingRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const current = existingRecords.find(item => item.subcategory_key === subcategoryKey);
  if (!current || !current._id) {
    return { success: false, msg: '子类别不存在' };
  }

  const duplicate = findSubcategoryRecordByName(
    existingRecords,
    normalizedName,
    current.parent_category,
    subcategoryKey
  );
  if (duplicate) {
    return { success: false, msg: '已存在同名子类别' };
  }

  await db.collection('material_subcategories').doc(current._id).update({
    data: {
      name: normalizedName,
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: '重命名成功'
  };
}

async function setSubcategoryStatus(subcategoryKey, status, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可启用或停用子类别');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalized = normalizeStatus(status);
  const existingRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const current = existingRecords.find(item => item.subcategory_key === subcategoryKey);
  if (!current || !current._id) {
    return { success: false, msg: '子类别不存在' };
  }

  await db.collection('material_subcategories').doc(current._id).update({
    data: {
      status: normalized,
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: normalized === 'active' ? '已启用' : '已停用'
  };
}

async function reorderSubcategories(subcategoryKeys, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可调整子类别顺序');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  if (!Array.isArray(subcategoryKeys) || subcategoryKeys.length === 0) {
    return { success: false, msg: '缺少排序数据' };
  }

  const existingRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const recordMap = new Map(existingRecords.map(item => [item.subcategory_key, item]));
  const validKeys = subcategoryKeys.filter(key => recordMap.has(String(key || '').trim()));
  if (validKeys.length === 0) {
    return { success: false, msg: '未找到可排序的子类别' };
  }

  for (let index = 0; index < validKeys.length; index += 1) {
    const record = recordMap.get(validKeys[index]);
    await db.collection('material_subcategories').doc(record._id).update({
      data: {
        sort_order: (index + 1) * 10,
        updated_at: db.serverDate()
      }
    });
  }

  return {
    success: true,
    msg: '排序已更新'
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : 'list';

  try {
    if (action === 'list') {
      return await listSubcategories(event || {});
    }
    if (action === 'create') {
      return await createSubcategory(event && event.name, event && event.category, OPENID);
    }
    if (action === 'rename') {
      return await renameSubcategory(
        String((event && event.subcategory_key) || '').trim(),
        event && event.name,
        OPENID
      );
    }
    if (action === 'setStatus') {
      return await setSubcategoryStatus(
        String((event && event.subcategory_key) || '').trim(),
        event && event.status,
        OPENID
      );
    }
    if (action === 'reorder') {
      return await reorderSubcategories(event && event.subcategory_keys, OPENID);
    }

    return {
      success: false,
      msg: `不支持的操作: ${action}`
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
