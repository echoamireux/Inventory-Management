function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeTestMaterialFlag(value) {
  if (value === true) {
    return { ok: true, value: true };
  }
  if (value === false || value === undefined || value === null) {
    return { ok: true, value: false };
  }

  const raw = normalizeText(value);
  if (!raw) {
    return { ok: true, value: false };
  }
  if (['是', 'true', 'TRUE', '1', 'Y', 'y', 'yes', 'YES'].includes(raw)) {
    return { ok: true, value: true };
  }
  if (['否', 'false', 'FALSE', '0', 'N', 'n', 'no', 'NO'].includes(raw)) {
    return { ok: true, value: false };
  }

  return {
    ok: false,
    value: false,
    msg: '是否测试料仅支持填写“是”或“否”'
  };
}

function isTestMaterial(material = {}, inventoryItem = {}) {
  return !!(material && material.is_test_material);
}

function buildTestMaterialStockInValidation(source = {}, material = {}) {
  if (!isTestMaterial(material, source)) {
    return { ok: true };
  }

  const required = [
    normalizeText(source.supplier_model),
    normalizeText(source.batch_number)
  ];

  if (required.every(Boolean)) {
    return { ok: true };
  }

  return {
    ok: false,
    msg: '测试料入库必须填写原厂型号和生产批号'
  };
}

function resolveInventorySourceText({ material = {}, item = {}, field }) {
  const itemValue = normalizeText(item && item[field]);
  if (isTestMaterial(material, item)) {
    if (field === 'supplier_model') {
      return itemValue;
    }
    if (itemValue) {
      return itemValue;
    }
  }
  return normalizeText((material && material[field]) || itemValue);
}

module.exports = {
  normalizeTestMaterialFlag,
  isTestMaterial,
  buildTestMaterialStockInValidation,
  resolveInventorySourceText
};
