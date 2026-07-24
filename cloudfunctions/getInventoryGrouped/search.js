const SEARCH_MATCH_SCORES = Object.freeze({
  PRODUCT_CODE_EXACT: 1000,
  TEST_MODEL_EXACT: 950,
  CODE_OR_MODEL_PREFIX: 800,
  MATERIAL_NAME_EXACT: 650,
  CODE_OR_MODEL_CONTAINS: 500,
  AUXILIARY_CONTAINS: 300
});

const SEARCH_MATCH_REASONS = Object.freeze({
  PRODUCT_CODE_EXACT: '产品代码完全匹配',
  TEST_MODEL_EXACT: '测试料型号完全匹配',
  CODE_OR_MODEL_PREFIX: '产品代码/型号前缀匹配',
  MATERIAL_NAME_EXACT: '物料名称完全匹配',
  CODE_OR_MODEL_CONTAINS: '产品代码/型号包含匹配',
  AUXILIARY_CONTAINS: '辅助字段包含匹配'
});

function toHalfWidth(value) {
  return String(value || '')
    .replace(/\u3000/g, ' ')
    .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeSearchText(value) {
  return toHalfWidth(value)
    .replace(/[‐‑‒–—―﹘﹣－]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeSearchKeyword(value) {
  return normalizeSearchText(value);
}

function isEmptySearchKeyword(value) {
  return normalizeSearchKeyword(value) === '';
}

function escapeRegExp(value) {
  return normalizeSearchKeyword(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildContainsRegExp(dbLike, keyword) {
  if (!dbLike || typeof dbLike.RegExp !== 'function') {
    return null;
  }

  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) {
    return null;
  }

  return dbLike.RegExp({
    regexp: escapeRegExp(normalizedKeyword),
    options: 'i'
  });
}

function getNestedFieldValue(record, fieldPath) {
  return String(fieldPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), record);
}

function getSearchFieldValues(record, fields = []) {
  return fields
    .map(fieldPath => ({
      fieldPath,
      value: normalizeSearchText(getNestedFieldValue(record, fieldPath))
    }))
    .filter(item => item.value);
}

function scoreSearchRecord(record = {}, keyword, options = {}) {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) {
    return { match_score: 0, match_reason: '', match_field: '' };
  }

  const codeFields = options.codeFields || ['product_code'];
  const modelFields = options.modelFields || ['supplier_model', 'supplier_model_key'];
  const nameFields = options.nameFields || ['material_name', 'name'];
  const auxiliaryFields = options.auxiliaryFields || [
    'supplier',
    'subcategory_key',
    'sub_category',
    'package_type',
    'specs',
    'batch_number',
    'location',
    'location_text',
    'unique_code'
  ];

  const codes = getSearchFieldValues(record, codeFields);
  const models = getSearchFieldValues(record, modelFields);
  const names = getSearchFieldValues(record, nameFields);
  const auxiliary = getSearchFieldValues(record, auxiliaryFields);

  const exactCode = codes.find(item => item.value === normalizedKeyword);
  if (exactCode) {
    return { match_score: SEARCH_MATCH_SCORES.PRODUCT_CODE_EXACT, match_reason: SEARCH_MATCH_REASONS.PRODUCT_CODE_EXACT, match_field: exactCode.fieldPath };
  }
  const exactModel = models.find(item => item.value === normalizedKeyword);
  if (exactModel) {
    return { match_score: SEARCH_MATCH_SCORES.TEST_MODEL_EXACT, match_reason: SEARCH_MATCH_REASONS.TEST_MODEL_EXACT, match_field: exactModel.fieldPath };
  }
  const prefixCodeOrModel = codes.concat(models).find(item => item.value.startsWith(normalizedKeyword));
  if (prefixCodeOrModel) {
    return { match_score: SEARCH_MATCH_SCORES.CODE_OR_MODEL_PREFIX, match_reason: SEARCH_MATCH_REASONS.CODE_OR_MODEL_PREFIX, match_field: prefixCodeOrModel.fieldPath };
  }
  const exactName = names.find(item => item.value === normalizedKeyword);
  if (exactName) {
    return { match_score: SEARCH_MATCH_SCORES.MATERIAL_NAME_EXACT, match_reason: SEARCH_MATCH_REASONS.MATERIAL_NAME_EXACT, match_field: exactName.fieldPath };
  }
  const containsCodeOrModel = codes.concat(models).find(item => item.value.includes(normalizedKeyword));
  if (containsCodeOrModel) {
    return { match_score: SEARCH_MATCH_SCORES.CODE_OR_MODEL_CONTAINS, match_reason: SEARCH_MATCH_REASONS.CODE_OR_MODEL_CONTAINS, match_field: containsCodeOrModel.fieldPath };
  }
  const containsName = names.find(item => item.value.includes(normalizedKeyword));
  if (containsName) {
    return { match_score: SEARCH_MATCH_SCORES.AUXILIARY_CONTAINS, match_reason: '物料名称包含匹配', match_field: containsName.fieldPath };
  }
  const containsAuxiliary = auxiliary.find(item => item.value.includes(normalizedKeyword));
  if (containsAuxiliary) {
    return { match_score: SEARCH_MATCH_SCORES.AUXILIARY_CONTAINS, match_reason: SEARCH_MATCH_REASONS.AUXILIARY_CONTAINS, match_field: containsAuxiliary.fieldPath };
  }
  return { match_score: 0, match_reason: '', match_field: '' };
}

function compareSearchResults(a = {}, b = {}, stableFields = ['product_code', 'supplier_model', '_id']) {
  const scoreCompare = Number(b.match_score || 0) - Number(a.match_score || 0);
  if (scoreCompare !== 0) return scoreCompare;
  for (const field of stableFields) {
    const left = normalizeSearchText(getNestedFieldValue(a, field));
    const right = normalizeSearchText(getNestedFieldValue(b, field));
    const compare = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    if (compare !== 0) return compare;
  }
  return 0;
}

function rankSearchResults(records = [], keyword, options = {}) {
  return records
    .map(record => ({ ...record, ...scoreSearchRecord(record, keyword, options) }))
    .sort((a, b) => compareSearchResults(a, b, options.stableFields));
}

function matchesSearchFields(record, fields = [], keyword) {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) {
    return true;
  }

  return fields.some((fieldPath) => {
    const rawValue = getNestedFieldValue(record, fieldPath);
    return normalizeSearchText(rawValue).includes(normalizedKeyword);
  });
}

module.exports = {
  SEARCH_MATCH_SCORES,
  SEARCH_MATCH_REASONS,
  normalizeSearchText,
  normalizeSearchKeyword,
  isEmptySearchKeyword,
  escapeRegExp,
  buildContainsRegExp,
  matchesSearchFields,
  getNestedFieldValue,
  scoreSearchRecord,
  compareSearchResults,
  rankSearchResults
};
