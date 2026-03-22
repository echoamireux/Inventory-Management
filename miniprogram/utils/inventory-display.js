const { getFilmDisplayState, roundNumber } = require('./film');
const EXPIRY_ALERT_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

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

  const diff = expiryDate.getTime() - (Date.now() + CST_OFFSET_MS);
  const days = Math.ceil(diff / ONE_DAY_MS);
  return days <= EXPIRY_ALERT_DAYS;
}

function getInventoryExpiryAlertState(item = {}) {
  const isExpiring = checkInventoryExpiring(item);

  return {
    isExpiring,
    expiryBadgeText: isExpiring ? '即将过期' : '',
    rowTone: isExpiring ? 'warning' : 'brand'
  };
}

function buildGroupedInventoryCardState(item = {}) {
  return {
    materialName: String(item.material_name || '').trim(),
    subcategoryLabel: String(item.sub_category || '').trim(),
    batchCountLabel: Number(item.totalCount) > 0 ? `${item.totalCount} 批次` : '',
    locationSummary: summarizeLocationScope(item.locations || []),
    matchReasonText: String(item.matchReasonText || '').trim()
  };
}

function buildBatchCardState(item = {}) {
  const labelCount = Number(item.labelCount !== undefined ? item.labelCount : item.itemCount);
  const locationSummary = String(item.locationSummary || '').trim() || summarizeLocationScope(item.locations || []);
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
    displayQuantity: roundNumber(quantityVal, 2),
    displayUnit: quantityUnit,
    baseLengthM: 0,
    availableInputStock: roundNumber(quantityVal, 2)
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
