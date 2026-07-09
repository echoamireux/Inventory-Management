const PRODUCT_CODE_DIGITS = 3;

const CATEGORY_PREFIX = {
  chemical: 'J',
  film: 'M'
};

const DEFAULT_ALLOWED_PREFIXES = [
  { prefix: 'J', category: 'chemical', status: 'active' },
  { prefix: 'S', category: 'chemical', status: 'active' },
  { prefix: 'Y', category: 'chemical', status: 'active' },
  { prefix: 'M', category: 'film', status: 'active' }
];

function normalizeCategory(category) {
  return category === 'film' ? 'film' : 'chemical';
}

function normalizePrefix(prefix) {
  const raw = String(prefix || '').trim().replace(/\s+/g, '').toUpperCase();
  if (!raw) return '';
  return raw;
}

function getProductCodePrefix(category) {
  return CATEGORY_PREFIX[normalizeCategory(category)];
}

function getAllowedPrefixes(category, options = {}) {
  const normalizedCategory = normalizeCategory(category);
  const records = Array.isArray(options.allowedPrefixes)
    ? options.allowedPrefixes
    : DEFAULT_ALLOWED_PREFIXES;
  const prefixes = records
    .map(item => ({
      prefix: normalizePrefix(item && (item.prefix || item.value || item.code_prefix)),
      category: normalizeCategory(item && item.category),
      status: item && item.status ? item.status : 'active'
    }))
    .filter(item => /^[A-Z]$/.test(item.prefix) && item.category === normalizedCategory && item.status !== 'disabled')
    .map(item => item.prefix);
  const unique = Array.from(new Set(prefixes));
  return unique.length > 0 ? unique : [getProductCodePrefix(normalizedCategory)];
}

function resolveProductCodeOptions(prefixOrOptions) {
  if (typeof prefixOrOptions === 'string') {
    return { prefix: prefixOrOptions };
  }
  if (prefixOrOptions && typeof prefixOrOptions === 'object') {
    return prefixOrOptions;
  }
  return {};
}

function formatAllowedPrefixText(prefixes = []) {
  return prefixes.join('、');
}

function formatFullProductCodePrefixText(prefixes = []) {
  return prefixes.map(prefix => `${prefix}-`).join('、');
}

function sanitizeProductCodeNumberInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, PRODUCT_CODE_DIGITS);
}

function getDigitValidationMessage() {
  return `产品代码必须为 1-${PRODUCT_CODE_DIGITS} 位数字`;
}

function getPrefixValidationMessage(category) {
  const allowedPrefixes = getAllowedPrefixes(category);
  return normalizeCategory(category) === 'film'
    ? `膜材产品代码前缀必须为 ${formatAllowedPrefixText(allowedPrefixes)}`
    : `化材产品代码前缀必须为 ${formatAllowedPrefixText(allowedPrefixes)}`;
}

function getStandardValidationMessage(category, options = {}) {
  const allowedPrefixes = getAllowedPrefixes(category, options);
  return normalizeCategory(category) === 'film'
    ? `膜材产品代码必须是 ${formatFullProductCodePrefixText(allowedPrefixes)} 加 ${PRODUCT_CODE_DIGITS} 位数字`
    : `化材产品代码必须是 ${formatFullProductCodePrefixText(allowedPrefixes)} 加 ${PRODUCT_CODE_DIGITS} 位数字`;
}

function normalizeProductCodeInput(category, rawInput, prefixOrOptions) {
  const normalizedCategory = normalizeCategory(category);
  const options = resolveProductCodeOptions(prefixOrOptions);
  const allowedPrefixes = getAllowedPrefixes(normalizedCategory, options);
  const selectedPrefix = normalizePrefix(options.prefix);
  const fallbackPrefix = allowedPrefixes.includes(selectedPrefix)
    ? selectedPrefix
    : allowedPrefixes[0];
  const rawValue = String(rawInput || '').trim().toUpperCase();

  if (!rawValue) {
    return { ok: false, msg: '产品代码必填' };
  }

  let digits = rawValue;
  let prefix = fallbackPrefix;

  if (!/^\d{1,3}$/.test(digits)) {
    return { ok: false, msg: getDigitValidationMessage() };
  }

  const number = digits.padStart(PRODUCT_CODE_DIGITS, '0');
  return {
    ok: true,
    number,
    prefix,
    product_code: `${prefix}-${number}`
  };
}

function validateStandardProductCode(category, productCode, prefixOrOptions) {
  const normalizedCategory = normalizeCategory(category);
  const options = resolveProductCodeOptions(prefixOrOptions);
  const allowedPrefixes = getAllowedPrefixes(normalizedCategory, options);
  const value = String(productCode || '').trim().toUpperCase();
  const matcher = value.match(/^([A-Z])-(\d{3})$/);

  if (!matcher || !allowedPrefixes.includes(normalizePrefix(matcher[1]))) {
    return {
      ok: false,
      msg: getStandardValidationMessage(normalizedCategory, options)
    };
  }

  return {
    ok: true,
    number: matcher[2],
    prefix: normalizePrefix(matcher[1]),
    product_code: `${normalizePrefix(matcher[1])}-${matcher[2]}`
  };
}

function findExactProductCodeMatch(list = [], productCode = '') {
  const normalizedCode = String(productCode || '').trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  return list.find((item) => (
    String(item && item.product_code || '').trim().toUpperCase() === normalizedCode
  )) || null;
}

module.exports = {
  PRODUCT_CODE_DIGITS,
  CATEGORY_PREFIX,
  DEFAULT_ALLOWED_PREFIXES,
  sanitizeProductCodeNumberInput,
  getProductCodePrefix,
  getAllowedPrefixes,
  getDigitValidationMessage,
  getPrefixValidationMessage,
  getStandardValidationMessage,
  normalizeProductCodeInput,
  validateStandardProductCode,
  findExactProductCodeMatch
};
