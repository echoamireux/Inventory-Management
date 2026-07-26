const {
  buildFilmInventoryState,
  normalizeFilmUnit
} = require('./film-quantity');
const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('./label-code');
const {
  isTestMaterial,
  buildTestMaterialStockInValidation,
  resolveInventorySourceText
} = require('./test-material');
const {
  validateTestMaterialIdentitySelection
} = require('./test-material-identities');
const {
  parseChemicalQuantity,
  parsePositiveIntegerMeters,
  buildInventoryIdentityKey
} = require('./inventory-quantity');

const MAX_BATCH_INVENTORY_ITEMS = 10;

function assertBatchInventoryItemLimit(count) {
  const total = Number(count) || 0;
  if (total > MAX_BATCH_INVENTORY_ITEMS) {
    throw new Error(`单个入库批次最多 ${MAX_BATCH_INVENTORY_ITEMS} 条`);
  }
}

function assertUniqueCodes(items) {
  const seen = new Set();

  for (let i = 0; i < items.length; i += 1) {
    const uniqueCode = normalizeLabelCodeInput((items[i] && items[i].unique_code) || '');
    const rowLabel = `第${i + 1}条`;

    if (!uniqueCode) {
      throw new Error(`${rowLabel}缺少标签编号`);
    }
    if (!isValidLabelCode(uniqueCode)) {
      throw new Error(`${rowLabel}标签编号格式不正确，应为 L + 6位数字`);
    }
    if (seen.has(uniqueCode)) {
      throw new Error(`批量数据内存在重复标签编号: ${uniqueCode}`);
    }

    seen.add(uniqueCode);
  }
}

function parseOptionalDate(value, rowLabel) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${rowLabel}过期日期格式非法`);
  }

  return parsed;
}

function assertExplicitExpiryState(rawItem, rowLabel) {
  const isLongTermValid = !!(rawItem && rawItem.is_long_term_valid);
  const expiryDate = parseOptionalDate(rawItem && rawItem.expiry_date, rowLabel);

  if (expiryDate && isLongTermValid) {
    throw new Error(`${rowLabel}过期日期和长期有效不能同时设置`);
  }

  if (!expiryDate && !isLongTermValid) {
    throw new Error(`${rowLabel}必须填写过期日期或明确设为长期有效`);
  }

  return {
    expiryDate,
    isLongTermValid
  };
}

function buildBatchInventoryPayload(rawItem, material, rowIndex, options = {}) {
  const rowLabel = `第${rowIndex + 1}条`;
  const quantity = rawItem && rawItem.quantity ? rawItem.quantity : {};
  const specs = material && material.specs ? material.specs : {};
  const materialName = (material && (material.material_name || material.name)) || '';
  const rawQuantityVal = Number(quantity.val);
  const requestedQuantityUnit = String(quantity.unit || '').trim();
  const masterQuantityUnit = String((material && material.default_unit) || '').trim();
  const quantityUnit = material && material.category === 'chemical'
    ? (masterQuantityUnit || requestedQuantityUnit)
    : (requestedQuantityUnit || masterQuantityUnit);
  const uniqueCode = normalizeLabelCodeInput((rawItem && rawItem.unique_code) || '');
  const batchNumber = String((rawItem && rawItem.batch_number) || '').trim();
  const location = String((rawItem && rawItem.location) || '').trim();
  const sampleNote = String((rawItem && rawItem.sample_note) || '').trim();
  const isTest = isTestMaterial(material, rawItem);
  const requestedSupplier = isTest
    ? String((rawItem && rawItem.supplier) || '').trim()
    : resolveInventorySourceText({ material, item: rawItem, field: 'supplier' });

  if (!material || !material._id) {
    throw new Error(`${rowLabel}对应的物料主数据不存在`);
  }
  if (material.status && material.status !== 'active') {
    throw new Error(`${rowLabel}对应的物料主数据未启用，不能入库`);
  }
  if (!materialName || !material.product_code || !material.category) {
    throw new Error(`${rowLabel}对应的物料主数据不完整`);
  }
  if (!Number.isFinite(rawQuantityVal) || rawQuantityVal <= 0) {
    throw new Error(`${rowLabel}入库数量必须为有效正数`);
  }
  if (!quantityUnit) {
    throw new Error(`${rowLabel}缺少数量单位`);
  }
  if (!uniqueCode) {
    throw new Error(`${rowLabel}缺少标签编号`);
  }
  if (!isValidLabelCode(uniqueCode)) {
    throw new Error(`${rowLabel}标签编号格式不正确，应为 L + 6位数字`);
  }
  if (!batchNumber) {
    throw new Error(`${rowLabel}缺少生产批号`);
  }
  const testMaterialValidation = buildTestMaterialStockInValidation({
    ...rawItem,
    batch_number: batchNumber
  }, material);
  if (!testMaterialValidation.ok) {
    throw new Error(`${rowLabel}${testMaterialValidation.msg}`);
  }
  const identityValidation = validateTestMaterialIdentitySelection({
    material,
    source: rawItem,
    identities: options.testMaterialIdentities || []
  });
  if (!identityValidation.ok) {
    throw new Error(`${rowLabel}${identityValidation.msg}`);
  }
  const supplierModel = isTest
    ? identityValidation.supplier_model
    : resolveInventorySourceText({ material, item: rawItem, field: 'supplier_model' });
  const supplierModelKey = isTest ? identityValidation.supplier_model_key : '';
  const supplier = isTest
    ? (requestedSupplier || identityValidation.supplier || '')
    : requestedSupplier;
  const effectiveMaterialName = isTest && identityValidation.label_material_name
    ? identityValidation.label_material_name
    : materialName;
  const effectiveSubcategoryKey = isTest && identityValidation.subcategory_key
    ? identityValidation.subcategory_key
    : (material.subcategory_key || '');
  const effectiveSubCategory = isTest && identityValidation.sub_category
    ? identityValidation.sub_category
    : (material.sub_category || '');
  if (!location) {
    throw new Error(`${rowLabel}缺少存储区域`);
  }

  const inventoryData = {
    material_id: material._id,
    material_name: effectiveMaterialName,
    category: material.category,
    subcategory_key: effectiveSubcategoryKey,
    sub_category: effectiveSubCategory,
    product_code: material.product_code,
    unique_code: uniqueCode,
    supplier,
    supplier_model: supplierModel,
    supplier_model_key: supplierModelKey,
    sample_note: sampleNote,
    is_test_material: isTest,
    identity_key: buildInventoryIdentityKey({
      product_code: material.product_code,
      is_test_material: isTest,
      supplier_model: supplierModel,
      supplier_model_key: supplierModelKey
    }),
    batch_number: batchNumber,
    location,
    status: 'in_stock',
    quantity: {
      val: material.category === 'chemical'
        ? parseChemicalQuantity(rawQuantityVal, `${rowLabel}入库数量`)
        : rawQuantityVal,
      unit: quantityUnit
    }
  };

  const { expiryDate, isLongTermValid } = assertExplicitExpiryState(rawItem, rowLabel);
  if (expiryDate) {
    inventoryData.expiry_date = expiryDate;
  }
  if (isLongTermValid) {
    inventoryData.is_long_term_valid = true;
  }

  let masterSpecBackfill;

  if (material.category === 'film') {
    const thicknessUm = Number(
      rawItem && rawItem.thickness_um !== undefined
        ? rawItem.thickness_um
        : (specs.thickness_um !== undefined ? specs.thickness_um : 0)
    ) || 0;
    const currentMasterWidth = Number(
      specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm
    ) || 0;
    const batchWidthMm = Number(
      rawItem && rawItem.batch_width_mm !== undefined
        ? rawItem.batch_width_mm
        : (
          rawItem && rawItem.width_mm !== undefined
            ? rawItem.width_mm
            : currentMasterWidth
        )
    ) || 0;
    const rawInitialLength = Number(
      rawItem && rawItem.length_m !== undefined
        ? rawItem.length_m
        : (rawItem && rawItem.initial_length_m !== undefined ? rawItem.initial_length_m : 0)
    ) || 0;
    const baseLengthM = parsePositiveIntegerMeters(
      rawInitialLength > 0 ? rawInitialLength : rawQuantityVal,
      `${rowLabel}膜材入库长度`
    );

    if (!(thicknessUm > 0)) {
      throw new Error(`${rowLabel}膜材缺少厚度，请先补齐物料主数据或改用单条入库`);
    }
    if (!(batchWidthMm > 0)) {
      throw new Error(`${rowLabel}膜材缺少本批次实际幅宽，请先完成规格确认`);
    }
    const initialLengthM = baseLengthM;
    const filmState = buildFilmInventoryState(baseLengthM, quantityUnit, batchWidthMm, initialLengthM);

    const canBackfillMasterSpecs = !isTest;
    const needsThicknessBackfill = canBackfillMasterSpecs && !(Number(specs.thickness_um) > 0) && thicknessUm > 0;
    const needsWidthBackfill = canBackfillMasterSpecs && !currentMasterWidth && batchWidthMm > 0;

    if (needsThicknessBackfill || needsWidthBackfill) {
      masterSpecBackfill = {};
      if (needsThicknessBackfill) {
        masterSpecBackfill.thickness_um = thicknessUm;
      }
      if (needsWidthBackfill) {
        masterSpecBackfill.standard_width_mm = batchWidthMm;
      }
    }

    inventoryData.quantity.val = filmState.quantityVal;
    inventoryData.quantity.unit = filmState.quantityUnit;
    inventoryData.dynamic_attrs = {
      current_length_m: filmState.currentLengthM,
      initial_length_m: filmState.initialLengthM,
      width_mm: batchWidthMm,
      thickness_um: thicknessUm,
      current_roll_diameter_mm: 0
    };
  } else {
    inventoryData.dynamic_attrs = {
      weight_kg: inventoryData.quantity.val
    };
  }

  return {
    rawItem,
    inventoryData,
    masterSpecBackfill,
    logData: {
      type: 'inbound',
      material_id: material._id,
      material_name: materialName,
      category: material.category,
      product_code: material.product_code,
      unique_code: uniqueCode,
      quantity_change: material.category === 'film'
        ? inventoryData.dynamic_attrs.current_length_m
        : inventoryData.quantity.val,
      spec_change_unit: material.category === 'film' ? 'm' : inventoryData.quantity.unit,
      unit: material.category === 'film' ? 'm' : inventoryData.quantity.unit,
      description: '批量入库'
    }
  };
}

module.exports = {
  MAX_BATCH_INVENTORY_ITEMS,
  assertBatchInventoryItemLimit,
  assertUniqueCodes,
  buildBatchInventoryPayload
};
