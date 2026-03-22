function normalizeSearchKeyword(value) {
  return String(value || '').trim();
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

function matchesSearchFields(record, fields = [], keyword) {
  const normalizedKeyword = normalizeSearchKeyword(keyword).toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }

  return fields.some((fieldPath) => {
    const rawValue = getNestedFieldValue(record, fieldPath);
    return String(rawValue == null ? '' : rawValue).toLowerCase().includes(normalizedKeyword);
  });
}

module.exports = {
  normalizeSearchKeyword,
  isEmptySearchKeyword,
  escapeRegExp,
  buildContainsRegExp,
  matchesSearchFields,
  getNestedFieldValue
};
