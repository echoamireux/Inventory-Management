const PRODUCT_CODE_DIGITS = 3;

const CATEGORY_PREFIX = {
  chemical: 'J-',
  film: 'M-'
};

function normalizeCategory(category) {
  return category === 'film' ? 'film' : 'chemical';
}

function getProductCodePrefix(category) {
  return CATEGORY_PREFIX[normalizeCategory(category)];
}

function sanitizeProductCodeNumberInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, PRODUCT_CODE_DIGITS);
}

function getDigitValidationMessage() {
  return `产品代码必须为 1-${PRODUCT_CODE_DIGITS} 位数字`;
}

function getPrefixValidationMessage(category) {
  return normalizeCategory(category) === 'film'
    ? '膜材产品代码必须使用 M- 前缀'
    : '化材产品代码必须使用 J- 前缀';
}

function getStandardValidationMessage(category) {
  return normalizeCategory(category) === 'film'
    ? `膜材产品代码必须是 M- 加 ${PRODUCT_CODE_DIGITS} 位数字`
    : `化材产品代码必须是 J- 加 ${PRODUCT_CODE_DIGITS} 位数字`;
}

function normalizeProductCodeInput(category, rawInput) {
  const normalizedCategory = normalizeCategory(category);
  const prefix = getProductCodePrefix(normalizedCategory);
  const rawValue = String(rawInput || '').trim().toUpperCase();

  if (!rawValue) {
    return { ok: false, msg: '产品代码必填' };
  }

  let digits = rawValue;
  if (rawValue.startsWith('J-') || rawValue.startsWith('M-')) {
    if (!rawValue.startsWith(prefix)) {
      return { ok: false, msg: getPrefixValidationMessage(normalizedCategory) };
    }
    digits = rawValue.slice(2);
  }

  if (!/^\d{1,3}$/.test(digits)) {
    return { ok: false, msg: getDigitValidationMessage() };
  }

  const number = digits.padStart(PRODUCT_CODE_DIGITS, '0');
  return {
    ok: true,
    number,
    product_code: `${prefix}${number}`
  };
}

function validateStandardProductCode(category, productCode) {
  const normalizedCategory = normalizeCategory(category);
  const prefix = getProductCodePrefix(normalizedCategory);
  const value = String(productCode || '').trim().toUpperCase();
  const matcher = new RegExp(`^${prefix}\\d{${PRODUCT_CODE_DIGITS}}$`);

  if (!matcher.test(value)) {
    return {
      ok: false,
      msg: getStandardValidationMessage(normalizedCategory)
    };
  }

  return {
    ok: true,
    number: value.slice(2),
    product_code: value
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
  sanitizeProductCodeNumberInput,
  getProductCodePrefix,
  getDigitValidationMessage,
  getPrefixValidationMessage,
  getStandardValidationMessage,
  normalizeProductCodeInput,
  validateStandardProductCode,
  findExactProductCodeMatch
};
