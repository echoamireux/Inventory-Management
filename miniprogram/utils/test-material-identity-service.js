function normalizeTestMaterialSupplierModel(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/\s*([-/])\s*/gu, '$1');
}

function normalizeTestMaterialSupplier(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
}

async function callTestMaterialIdentity(action, payload = {}) {
  const res = await wx.cloud.callFunction({
    name: 'manageTestMaterialIdentity',
    data: {
      action,
      ...payload
    }
  });
  const result = res.result || {};
  if (!result.success) {
    const error = new Error(result.msg || '测试料型号库操作失败');
    error.code = result.code || '';
    error.similar = result.similar || null;
    throw error;
  }
  return result;
}

async function listTestMaterialIdentities(options = {}) {
  const result = await callTestMaterialIdentity('list', {
    page: options.page || 1,
    pageSize: options.pageSize || 50,
    includeDisabled: !!options.includeDisabled,
    category: options.category || '',
    product_code: options.product_code || options.productCode || '',
    material_id: options.material_id || options.materialId || '',
    searchVal: options.searchVal || options.keyword || ''
  });
  return {
    list: result.list || [],
    total: Number(result.total) || 0,
    page: Number(result.page) || 1,
    pageSize: Number(result.pageSize) || 50,
    searchTruncated: !!result.searchTruncated,
    searchMessage: result.searchMessage || ''
  };
}

async function createTestMaterialIdentity(payload = {}) {
  return callTestMaterialIdentity('create', payload);
}

async function batchCreateTestMaterialIdentities(rows = [], options = {}) {
  return callTestMaterialIdentity('batchCreate', {
    rows,
    confirmSimilar: !!options.confirmSimilar
  });
}

async function setTestMaterialIdentityStatus(record, status) {
  return callTestMaterialIdentity('setStatus', {
    id: record && record._id,
    identity_key: record && record.identity_key,
    status
  });
}

function buildTestMaterialIdentityActions(records = []) {
  return (records || [])
    .filter(item => item.status !== 'disabled')
    .map((item) => {
      const supplier = normalizeTestMaterialSupplier(item.supplier);
      return {
        name: supplier ? `${item.supplier_model}｜${supplier}` : item.supplier_model,
        value: item.supplier_model,
        supplier_model: item.supplier_model,
        supplier_model_key: item.supplier_model_key,
        supplier,
        identity_key: item.identity_key,
        material_id: item.material_id,
        product_code: item.product_code
      };
    });
}

module.exports = {
  normalizeTestMaterialSupplierModel,
  normalizeTestMaterialSupplier,
  listTestMaterialIdentities,
  createTestMaterialIdentity,
  batchCreateTestMaterialIdentities,
  setTestMaterialIdentityStatus,
  buildTestMaterialIdentityActions
};
