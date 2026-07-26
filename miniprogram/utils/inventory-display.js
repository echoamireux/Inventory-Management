const { getFilmDisplayState, roundNumber } = require('./film');
const EXPIRY_ALERT_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function uniqueNonEmpty(values = []) {
  return [...new Set(
    (values || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
}

function summarizeLocationScope(locations = []) {
  const normalized = uniqueNonEmpty(locations);
  if (normalized.length === 0) {
    return '';
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  return `${normalized.length}个库位`;
}

function formatDateLabel(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveInventoryExpiryDisplay(item = {}) {
  const expiryLabel = formatDateLabel(item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date));
  const isLongTermValid = !!item.is_long_term_valid;

  if (expiryLabel) {
    return {
      label: expiryLabel,
      hasExpiryDate: true,
      isLongTermValid: false,
      isMissing: false
    };
  }

  if (isLongTermValid) {
    return {
      label: '长期有效',
      hasExpiryDate: false,
      isLongTermValid: true,
      isMissing: false
    };
  }

  return {
    label: '未设置过期日',
    hasExpiryDate: false,
    isLongTermValid: false,
    isMissing: true
  };
}

function checkInventoryExpiring(item = {}) {
  const expirySource = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);
  if (!expirySource) {
    return false;
  }

  const expiryDate = new Date(expirySource);
  if (Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  const diff = expiryDate.getTime() - Date.now();
  const days = Math.ceil(diff / ONE_DAY_MS);
  return days <= EXPIRY_ALERT_DAYS;
}

function resolveInventoryExpiryDays(item = {}) {
  const expirySource = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);
  if (!expirySource) {
    return null;
  }

  const expiryDate = new Date(expirySource);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }

  return Math.ceil((expiryDate.getTime() - Date.now()) / ONE_DAY_MS);
}

/**
 * 过期状态分两档：已过期（diffDays <= 0）与临期（0 < diffDays <= 30）。
 *
 * 此前两者共用「即将过期」一个徽标 —— checkInventoryExpiring 用 days <= 30 判定，
 * 已过期的天数是负数同样命中。于是过期三个月的试剂和还有 20 天到期的长得一模一样，
 * 全系统只有库存详情页会额外写一句「(已过期)」。而 FEFO 恰好优先推荐最早过期的批次，
 * 用户在领料链路上看不出自己拿到的是过期品。
 *
 * 业务规则：实验室确实会使用过期物料，因此**不禁止领用**，只让状态可见。
 */
function getInventoryExpiryAlertState(item = {}) {
  const days = resolveInventoryExpiryDays(item);
  const isExpired = days !== null && days <= 0;
  const isExpiring = days !== null && days <= EXPIRY_ALERT_DAYS;

  return {
    isExpired,
    // 保持字段语义向后兼容：已过期同样算作需要提醒
    isExpiring,
    expiryBadgeText: isExpired ? '已过期' : (isExpiring ? '即将过期' : ''),
    rowTone: isExpired ? 'danger' : (isExpiring ? 'warning' : 'brand')
  };
}

function buildGroupedInventoryCardState(item = {}) {
  const supplierModel = String(item.supplier_model || '').trim();
  return {
    materialName: String(item.material_name || '').trim(),
    subcategoryLabel: String(item.sub_category || '').trim(),
    supplierModelLabel: item.is_test_material && supplierModel ? `型号 ${supplierModel}` : '',
    batchCountLabel: Number(item.totalCount) > 0 ? `${item.totalCount} 批次` : '',
    locationSummary: summarizeLocationScope(item.locations || []),
    matchReasonText: String(item.matchReasonText || '').trim()
  };
}

function buildBatchCardState(item = {}) {
  const labelCount = Number(item.labelCount !== undefined ? item.labelCount : item.itemCount);
  const locationSummary = String(item.locationSummary || '').trim() || summarizeLocationScope(item.locations || []);
  const supplierModel = String(item.supplier_model || '').trim();
  let expiryBadgeText = '';

  if (item.isExpiring) {
    expiryBadgeText = labelCount > 1
      ? '包含临期'
      : (item.category === 'chemical' ? '临期' : '即将过期');
  }

  return {
    batchLabel: '批号',
    batchValue: String(item.batch_number || '').trim() || '未填写',
    materialName: String(item.material_name || '').trim(),
    subcategoryLabel: String(item.sub_category || '').trim(),
    supplierModelLabel: item.is_test_material && supplierModel ? `型号 ${supplierModel}` : '',
    labelCountLabel: labelCount > 0 ? `${labelCount}个标签` : '',
    locationSummary,
    expiryBadgeText
  };
}

function buildMaterialMap(records = []) {
  return new Map(
    (records || [])
      .filter(item => item && item.product_code)
      .map(item => [String(item.product_code).trim(), item])
  );
}

function mergeInventoryMaterialData(item = {}, material = {}) {
  const inventoryItem = item || {};
  const materialRecord = material || {};
  const mergedSpecs = {
    ...(materialRecord.specs || {}),
    ...(inventoryItem.specs || {})
  };

  return {
    ...materialRecord,
    ...inventoryItem,
    material_id: inventoryItem.material_id || materialRecord._id || '',
    product_code: inventoryItem.product_code || materialRecord.product_code || '',
    material_name: inventoryItem.material_name || materialRecord.material_name || materialRecord.name || '',
    category: inventoryItem.category || materialRecord.category || '',
    subcategory_key: inventoryItem.subcategory_key || materialRecord.subcategory_key || '',
    sub_category: inventoryItem.sub_category || materialRecord.sub_category || '',
    supplier: inventoryItem.supplier || materialRecord.supplier || '',
    supplier_model: inventoryItem.supplier_model || materialRecord.supplier_model || '',
    sample_note: inventoryItem.sample_note || '',
    is_test_material: !!(inventoryItem.is_test_material || materialRecord.is_test_material),
    default_unit: materialRecord.default_unit || inventoryItem.default_unit || '',
    package_type: materialRecord.package_type || inventoryItem.package_type || '',
    specs: mergedSpecs
  };
}

function getInventoryQuantityDisplayState(item = {}, material = {}) {
  const merged = mergeInventoryMaterialData(item, material);
  const quantity = merged.quantity || {};

  if (merged.category === 'film') {
    const preferredUnit = material && material.default_unit
      ? material.default_unit
      : merged.default_unit;
    const filmState = getFilmDisplayState(merged, preferredUnit);

    return {
      displayQuantity: filmState.displayQuantity,
      displayUnit: filmState.displayUnit,
      baseLengthM: filmState.baseLengthM,
      availableInputStock: filmState.baseLengthM
    };
  }

  const quantityVal = Number(quantity.val) || 0;
  const quantityUnit = String(quantity.unit || '').trim() || 'kg';

  return {
    // 展示保留 2 位即可，够读
    displayQuantity: roundNumber(quantityVal, 2),
    displayUnit: quantityUnit,
    baseLengthM: 0,
    // 可领用上限必须保留 3 位，与后端存储精度一致。
    // 降到 2 位会把 (0, 0.005) 的尾数抹成 0，而领料弹窗按
    // `withdrawNum > stockNum` 拦截，于是任何正数输入都被拒绝；
    // 与此同时唯一能把状态置为 used 的路径是出库时 newStock === 0，
    // 盘点与纠错都要求数量大于 0、删除入口已停用 ——
    // 该标签既领不空也清不掉，会永远留在库存列表与 FEFO 候选集里。
    availableInputStock: roundNumber(quantityVal, 3)
  };
}

function formatOptionalSpecValue(value, unit) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return '--';
  }
  return `${value} ${unit}`;
}

function getInventorySpecDisplayState(item = {}, material = {}) {
  const merged = mergeInventoryMaterialData(item, material);
  const dynamicAttrs = merged.dynamic_attrs || {};
  const specs = merged.specs || {};
  const quantity = merged.quantity || {};

  const thickness = specs.thickness_um !== undefined
    ? specs.thickness_um
    : dynamicAttrs.thickness_um;
  const width = dynamicAttrs.width_mm !== undefined
    ? dynamicAttrs.width_mm
    : (specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm);
  const initialLength = dynamicAttrs.initial_length_m !== undefined
    ? dynamicAttrs.initial_length_m
    : (merged.length_m !== undefined ? merged.length_m : '');

  return {
    thicknessLabel: formatOptionalSpecValue(thickness, 'μm'),
    widthLabel: formatOptionalSpecValue(width, 'mm'),
    initialLengthLabel: formatOptionalSpecValue(initialLength, 'm'),
    packageTypeLabel: String(merged.package_type || '').trim() || '--',
    quantityLabel: `${Number(quantity.val) || 0} ${String(quantity.unit || '').trim() || 'kg'}`
  };
}

module.exports = {
  summarizeLocationScope,
  resolveInventoryExpiryDisplay,
  buildGroupedInventoryCardState,
  getInventoryExpiryAlertState,
  buildBatchCardState,
  buildMaterialMap,
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState,
  getInventorySpecDisplayState
};
