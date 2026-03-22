const LEGACY_SUBCATEGORY_FUNCTION_HINT = '当前云函数版本过旧，请部署最新版 manageSubcategory';

function normalizeSubcategoryFunctionResult(data, res) {
  const result = res && res.result ? res.result : {};

  if (!result.success) {
    throw new Error(result.msg || '子类别操作失败');
  }

  if (data && data.action === 'list' && !Array.isArray(result.list)) {
    throw new Error(LEGACY_SUBCATEGORY_FUNCTION_HINT);
  }

  return result;
}

function callSubcategoryFunction(data) {
  return wx.cloud.callFunction({
    name: 'manageSubcategory',
    data
  }).then((res) => normalizeSubcategoryFunctionResult(data, res));
}

function listSubcategoryRecords(category, includeDisabled = false) {
  return callSubcategoryFunction({
    action: 'list',
    category,
    includeDisabled
  }).then(result => result.list || []);
}

function createSubcategory(name, category) {
  return callSubcategoryFunction({
    action: 'create',
    name,
    category
  });
}

function renameSubcategory(subcategoryKey, name) {
  return callSubcategoryFunction({
    action: 'rename',
    subcategory_key: subcategoryKey,
    name
  });
}

function setSubcategoryStatus(subcategoryKey, status) {
  return callSubcategoryFunction({
    action: 'setStatus',
    subcategory_key: subcategoryKey,
    status
  });
}

function reorderSubcategories(subcategoryKeys) {
  return callSubcategoryFunction({
    action: 'reorder',
    subcategory_keys: subcategoryKeys
  });
}

module.exports = {
  LEGACY_SUBCATEGORY_FUNCTION_HINT,
  normalizeSubcategoryFunctionResult,
  listSubcategoryRecords,
  createSubcategory,
  renameSubcategory,
  setSubcategoryStatus,
  reorderSubcategories
};
