const { resolveInventoryLocation, buildZoneMap } = require('./location-zone');
const { listZoneRecords } = require('./zone-service');
const {
  buildMaterialMap,
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState,
  getInventoryExpiryAlertState
} = require('./inventory-display');

function buildBatchLabelWhere({ batchNumber = '', productCode = '', materialName = '', category = '' } = {}) {
  const where = {
    status: 'in_stock',
    batch_number: batchNumber
  };

  if (productCode && productCode !== '无产品代码') {
    where.product_code = productCode;
  } else if (materialName) {
    where.material_name = materialName;
  }

  if (category) {
    where.category = category;
  }

  return where;
}

async function loadMaterialMapByProductCodes(productCodes = []) {
  const records = Array.isArray(productCodes) ? productCodes : [];
  if (records.length === 0) {
    return new Map();
  }
  return buildMaterialMap(records);
}

async function loadBatchLabelPage({
  batchNumber = '',
  productCode = '',
  materialName = '',
  category = '',
  page = 1,
  pageSize = 20
} = {}) {
  const normalizedBatchNumber = String(batchNumber || '').trim();
  if (!normalizedBatchNumber) {
    return {
      list: [],
      total: 0
    };
  }

  const nextPage = Math.max(1, Number(page) || 1);
  const nextPageSize = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const res = await wx.cloud.callFunction({
    name: 'getInventoryRecord',
    data: {
      action: 'batchLabels',
      batchNumber: normalizedBatchNumber,
      productCode: String(productCode || '').trim(),
      materialName: String(materialName || '').trim(),
      category: String(category || '').trim(),
      page: nextPage,
      pageSize: nextPageSize
    }
  });
  const result = res.result || {};
  if (!result.success) {
    throw new Error(result.msg || '加载标签列表失败');
  }

  const rawList = result.list || [];
  const effectiveCategory = String(category || rawList[0]?.category || 'chemical').trim() || 'chemical';

  let zoneMap = new Map();
  try {
    const zoneRecords = await listZoneRecords(effectiveCategory, true);
    zoneMap = buildZoneMap(zoneRecords);
  } catch (zoneError) {
    console.warn('加载库区映射失败', zoneError);
  }

  const materialMap = await loadMaterialMapByProductCodes(result.materials || []);

  const list = rawList.map((item) => {
    const materialRecord = materialMap.get(item.product_code) || {};
    const mergedItem = mergeInventoryMaterialData(item, materialRecord);
    const quantityState = getInventoryQuantityDisplayState(mergedItem, materialRecord);
    const expirySource = mergedItem.expiry_date;
    const isLongTermValid = mergedItem.is_long_term_valid;
    const expiryState = getInventoryExpiryAlertState({
      ...mergedItem,
      expiry_date: expirySource,
      is_long_term_valid: isLongTermValid
    });

    return {
      ...mergedItem,
      expiry_date: expirySource,
      is_long_term_valid: isLongTermValid,
      isExpiring: expiryState.isExpiring,
      expiryBadgeText: expiryState.expiryBadgeText,
      rowTone: expiryState.rowTone,
      location: resolveInventoryLocation(mergedItem, zoneMap) || '--',
      _qtyStr: `${quantityState.displayQuantity} ${quantityState.displayUnit}`
    };
  });

  return {
    list,
    total: Number(result.total) || list.length
  };
}

module.exports = {
  buildBatchLabelWhere,
  loadBatchLabelPage
};
