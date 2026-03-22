const db = wx.cloud.database();
const _ = db.command;

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
  const codes = [...new Set((productCodes || []).filter(Boolean))];
  if (codes.length === 0) {
    return new Map();
  }

  const materialRes = await db.collection('materials')
    .where({ product_code: _.in(codes) })
    .field({
      _id: true,
      product_code: true,
      material_name: true,
      status: true,
      default_unit: true,
      package_type: true,
      supplier: true,
      supplier_model: true,
      specs: true,
      subcategory_key: true,
      sub_category: true
    })
    .get();

  return buildMaterialMap(materialRes.data || []);
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
  const where = buildBatchLabelWhere({
    batchNumber: normalizedBatchNumber,
    productCode: String(productCode || '').trim(),
    materialName: String(materialName || '').trim(),
    category: String(category || '').trim()
  });

  const totalRes = await db.collection('inventory')
    .where(where)
    .count();

  const res = await db.collection('inventory')
    .where(where)
    .field({
      _id: true,
      unique_code: true,
      product_code: true,
      material_name: true,
      category: true,
      subcategory_key: true,
      sub_category: true,
      quantity: true,
      dynamic_attrs: true,
      expiry_date: true,
      is_long_term_valid: true,
      location: true,
      location_text: true,
      location_detail: true,
      zone_key: true
    })
    .orderBy('expiry_date', 'asc')
    .orderBy('create_time', 'asc')
    .skip((nextPage - 1) * nextPageSize)
    .limit(nextPageSize)
    .get();

  const rawList = res.data || [];
  const effectiveCategory = String(category || rawList[0]?.category || 'chemical').trim() || 'chemical';

  let zoneMap = new Map();
  try {
    const zoneRecords = await listZoneRecords(effectiveCategory, true);
    zoneMap = buildZoneMap(zoneRecords);
  } catch (zoneError) {
    console.warn('加载库区映射失败', zoneError);
  }

  const materialMap = await loadMaterialMapByProductCodes(
    rawList.map(item => item.product_code).filter(Boolean)
  );

  const list = rawList.map((item) => {
    const materialRecord = materialMap.get(item.product_code) || {};
    const mergedItem = mergeInventoryMaterialData(item, materialRecord);
    const quantityState = getInventoryQuantityDisplayState(mergedItem, materialRecord);
    const expiryState = getInventoryExpiryAlertState(mergedItem);

    return {
      ...mergedItem,
      isExpiring: expiryState.isExpiring,
      expiryBadgeText: expiryState.expiryBadgeText,
      rowTone: expiryState.rowTone,
      location: resolveInventoryLocation(mergedItem, zoneMap) || '--',
      _qtyStr: `${quantityState.displayQuantity} ${quantityState.displayUnit}`
    };
  });

  return {
    list,
    total: Number(totalRes.total) || list.length
  };
}

module.exports = {
  buildBatchLabelWhere,
  loadBatchLabelPage
};
