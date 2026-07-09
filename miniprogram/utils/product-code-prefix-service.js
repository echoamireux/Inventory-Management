async function callProductCodePrefix(action, payload = {}) {
  const res = await wx.cloud.callFunction({
    name: 'manageProductCodePrefix',
    data: {
      action,
      ...payload
    }
  });
  const result = res.result || {};
  if (!result.success) {
    throw new Error(result.msg || '产品代码前缀操作失败');
  }
  return result;
}

async function listProductCodePrefixes(includeDisabled = false, category = '') {
  const result = await callProductCodePrefix('list', {
    includeDisabled,
    category
  });
  return result.list || [];
}

async function createProductCodePrefix(prefix, category) {
  return callProductCodePrefix('create', { prefix, category });
}

async function setProductCodePrefixStatus(prefix, status) {
  return callProductCodePrefix('setStatus', { prefix, status });
}

async function reorderProductCodePrefixes(prefixes) {
  return callProductCodePrefix('reorder', { prefixes });
}

function buildProductCodePrefixPickerColumns(records = [], category = '') {
  return (records || [])
    .filter(item => !category || item.category === category)
    .filter(item => item.status !== 'disabled')
    .filter(item => /^[A-Z]$/.test(String(item.prefix || '')))
    .map(item => ({
      text: item.prefix,
      value: item.prefix,
      prefix: item.prefix,
      category: item.category
    }));
}

module.exports = {
  listProductCodePrefixes,
  createProductCodePrefix,
  setProductCodePrefixStatus,
  reorderProductCodePrefixes,
  buildProductCodePrefixPickerColumns
};
