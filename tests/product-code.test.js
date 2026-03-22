const test = require('node:test');
const assert = require('node:assert/strict');

const frontendProductCode = require('../miniprogram/utils/product-code');
const backendProductCode = require('../cloudfunctions/_shared/product-code');

for (const [label, impl] of [
  ['frontend', frontendProductCode],
  ['backend', backendProductCode]
]) {
  test(`${label}: raw code input is sanitized to at most three digits`, () => {
    assert.equal(impl.sanitizeProductCodeNumberInput('12a34'), '123');
    assert.equal(impl.sanitizeProductCodeNumberInput('0019'), '001');
    assert.equal(impl.sanitizeProductCodeNumberInput(''), '');
  });

  test(`${label}: flexible product code input is normalized to a standard three-digit code`, () => {
    assert.deepEqual(impl.normalizeProductCodeInput('chemical', '1'), {
      ok: true,
      number: '001',
      product_code: 'J-001'
    });
    assert.deepEqual(impl.normalizeProductCodeInput('chemical', 'J-01'), {
      ok: true,
      number: '001',
      product_code: 'J-001'
    });
    assert.deepEqual(impl.normalizeProductCodeInput('film', 'M-1'), {
      ok: true,
      number: '001',
      product_code: 'M-001'
    });
  });

  test(`${label}: invalid code input is rejected with clear validation errors`, () => {
    assert.deepEqual(impl.normalizeProductCodeInput('chemical', '1234'), {
      ok: false,
      msg: '产品代码必须为 1-3 位数字'
    });
    assert.deepEqual(impl.normalizeProductCodeInput('chemical', 'M-001'), {
      ok: false,
      msg: '化材产品代码必须使用 J- 前缀'
    });
    assert.deepEqual(impl.validateStandardProductCode('film', 'M-01'), {
      ok: false,
      msg: '膜材产品代码必须是 M- 加 3 位数字'
    });
  });
}
