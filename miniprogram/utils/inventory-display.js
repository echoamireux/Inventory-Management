const { getFilmDisplayState, roundNumber } = require('./film');

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
  return '多库位';
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

function buildGroupedInventoryCardState(item = {}) {
  return {
    materialName: String(item.material_name || '').trim(),
    subcategoryLabel: String(item.sub_category || '').trim(),
    batchCountLabel: Number(item.totalCount) > 0 ? `${item.totalCount} 批次` : '',
    locationSummary: summarizeLocationScope(item.locations || [])
  };
}

function buildBatchCardState(item = {}) {
  const expiry = resolveInventoryExpiryDisplay(item);
  return {
    batchLabel: '批号',
    batchValue: String(item.batch_number || '').trim() || '未填写',
    materialName: String(item.material_name || '').trim(),
    subcategoryLabel: String(item.sub_category || '').trim(),
    expiryLabel: String(item.expiry || expiry.label || '').trim() || '未设置过期日',
    locationLabel: String(item.location || '').trim() || '--'
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
  buildBatchCardState,
  buildMaterialMap,
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState,
  getInventorySpecDisplayState
};
