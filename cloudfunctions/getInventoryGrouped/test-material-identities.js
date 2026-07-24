const DASH_PATTERN = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/gu;

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).normalize('NFKC').trim();
}

function normalizeCategory(value) {
  return normalizeText(value) === 'film' ? 'film' : 'chemical';
}

function normalizeStatus(value) {
  return normalizeText(value) === 'disabled' ? 'disabled' : 'active';
}

function normalizeProductCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeTestMaterialSupplierModel(value) {
  return normalizeText(value)
    .replace(DASH_PATTERN, '-')
    .replace(/\s+/gu, ' ')
    .replace(/\s*([-/])\s*/gu, '$1')
    .trim();
}

function normalizeTestMaterialSupplier(value) {
  return normalizeText(value).replace(/\s+/gu, ' ');
}

function buildTestMaterialSupplierModelKey(value) {
  return normalizeTestMaterialSupplierModel(value);
}

function buildSimilarSupplierModelKey(value) {
  return buildTestMaterialSupplierModelKey(value)
    .replace(/\s+/gu, '')
    .toLowerCase();
}

function buildTestMaterialIdentityKey(source = {}) {
  const category = normalizeCategory(source.category);
  const productCode = normalizeProductCode(source.product_code);
  const supplierModelKey = buildTestMaterialSupplierModelKey(
    source.supplier_model_key || source.supplier_model
  );
  return category && productCode && supplierModelKey
    ? `${category}::${productCode}::${supplierModelKey}`
    : '';
}

function normalizeTestMaterialIdentityRecord(record = {}) {
  const category = normalizeCategory(record.category);
  const productCode = normalizeProductCode(record.product_code);
  const supplierModel = normalizeTestMaterialSupplierModel(record.supplier_model);
  const supplierModelKey = buildTestMaterialSupplierModelKey(
    record.supplier_model_key || supplierModel
  );
  const identityKey = buildTestMaterialIdentityKey({
    category,
    product_code: productCode,
    supplier_model_key: supplierModelKey
  });

  return {
    ...record,
    category,
    product_code: productCode,
    supplier: normalizeTestMaterialSupplier(record.supplier),
    supplier_model: supplierModel,
    supplier_model_key: supplierModelKey,
    identity_key: identityKey,
    similar_key: buildSimilarSupplierModelKey(supplierModelKey),
    status: normalizeStatus(record.status)
  };
}

function findTestMaterialIdentityConflict(records = [], candidate = {}) {
  const normalizedCandidate = normalizeTestMaterialIdentityRecord(candidate);
  if (!normalizedCandidate.identity_key) {
    return { type: '', record: null };
  }

  const normalizedRecords = (records || []).map(normalizeTestMaterialIdentityRecord);
  const exact = normalizedRecords.find(item => item.identity_key === normalizedCandidate.identity_key);
  if (exact) {
    return { type: 'exact', record: exact };
  }

  const similar = normalizedRecords.find(item => (
    item.category === normalizedCandidate.category
    && item.product_code === normalizedCandidate.product_code
    && item.similar_key === normalizedCandidate.similar_key
  ));
  if (similar) {
    return { type: 'similar', record: similar };
  }

  return { type: '', record: null };
}

function isTestMaterialRecord(material = {}, source = {}) {
  return !!(material && material.is_test_material);
}

function validateTestMaterialIdentitySelection({
  material = {},
  source = {},
  identities = []
} = {}) {
  if (!isTestMaterialRecord(material, source)) {
    return { ok: true, supplier: '', supplier_model: '', supplier_model_key: '' };
  }

  const category = normalizeCategory(source.category || material.category);
  const productCode = normalizeProductCode(source.product_code || material.product_code);
  const supplierModel = normalizeTestMaterialSupplierModel(source.supplier_model);
  const supplierModelKey = buildTestMaterialSupplierModelKey(
    source.supplier_model_key || supplierModel
  );

  if (!supplierModelKey) {
    return {
      ok: false,
      msg: '测试料请先选择已维护的原厂型号'
    };
  }

  const identityKey = buildTestMaterialIdentityKey({
    category,
    product_code: productCode,
    supplier_model_key: supplierModelKey
  });
  const normalizedIdentities = (identities || []).map(normalizeTestMaterialIdentityRecord);
  const matched = normalizedIdentities.find(item => item.identity_key === identityKey);

  if (!matched) {
    return {
      ok: false,
      msg: '测试料原厂型号未维护，请联系管理员先维护测试料型号库'
    };
  }
  if (matched.status !== 'active') {
    return {
      ok: false,
      msg: '测试料原厂型号未启用，请联系管理员启用后再操作'
    };
  }

  return {
    ok: true,
    supplier: matched.supplier,
    supplier_model: matched.supplier_model,
    supplier_model_key: matched.supplier_model_key
  };
}

async function loadTestMaterialIdentityForSelection(collectionOwner, material = {}, source = {}) {
  if (!isTestMaterialRecord(material, source)) {
    return { ok: true, supplier: '', supplier_model: '', supplier_model_key: '' };
  }

  const category = normalizeCategory(source.category || material.category);
  const productCode = normalizeProductCode(source.product_code || material.product_code);
  const supplierModelKey = buildTestMaterialSupplierModelKey(
    source.supplier_model_key || source.supplier_model
  );
  const identityKey = buildTestMaterialIdentityKey({
    category,
    product_code: productCode,
    supplier_model_key: supplierModelKey
  });
  if (!identityKey) {
    return validateTestMaterialIdentitySelection({ material, source, identities: [] });
  }

  const res = await collectionOwner.collection('test_material_identities')
    .where({ identity_key: identityKey })
    .limit(1)
    .get();
  const validation = validateTestMaterialIdentitySelection({
    material,
    source: {
      ...source,
      category,
      product_code: productCode,
      supplier_model_key: supplierModelKey
    },
    identities: res.data || []
  });
  return validation.ok
    ? {
      ...validation,
      identity_key: identityKey
    }
    : validation;
}

module.exports = {
  normalizeText,
  normalizeCategory,
  normalizeStatus,
  normalizeProductCode,
  normalizeTestMaterialSupplierModel,
  normalizeTestMaterialSupplier,
  buildTestMaterialSupplierModelKey,
  buildSimilarSupplierModelKey,
  buildTestMaterialIdentityKey,
  normalizeTestMaterialIdentityRecord,
  findTestMaterialIdentityConflict,
  validateTestMaterialIdentitySelection,
  loadTestMaterialIdentityForSelection
};
