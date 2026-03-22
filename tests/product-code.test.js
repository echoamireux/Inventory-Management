const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('single stock-in product-code lookup only runs after blur or confirm instead of during typing', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );

  assert.match(pageJs, /onProductCodeBlur/);
  assert.match(pageJs, /onProductCodeConfirm/);
  assert.match(pageJs, /confirmProductCodeLookup/);
  assert.match(pageJs, /normalizeProductCodeInput\(this\.data\.activeTab, rawValue\)/);
  assert.match(pageJs, /await this\.searchSuggestions\(normalizedCode\.product_code\)/);
  assert.doesNotMatch(pageJs, /suggestionTimer:\s*setTimeout\(\s*\(\)\s*=>\s*\{\s*this\.searchSuggestions/);
});

test('frontend: exact product code matching helper returns only the governed code hit', () => {
  const exactMatch = frontendProductCode.findExactProductCodeMatch([
    { product_code: 'J-001', material_name: '丙酮' },
    { product_code: 'J-002', material_name: '乙酸乙酯' }
  ], 'J-001');

  assert.deepEqual(exactMatch, {
    product_code: 'J-001',
    material_name: '丙酮'
  });
  assert.equal(frontendProductCode.findExactProductCodeMatch([], 'J-001'), null);
});

test('single stock-in exact product-code lookup auto-applies an exact material match without an extra tap', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );

  assert.match(pageJs, /findExactProductCodeMatch/);
  assert.match(pageJs, /this\.applyMaterialSuggestion\(exactMatch/);
});

test('batch entry supports blur or confirm driven exact product-code retrieval in addition to suggestions', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.js'),
    'utf8'
  );
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.wxml'),
    'utf8'
  );

  assert.match(pageJs, /onMaterialCodeBlur/);
  assert.match(pageJs, /onMaterialCodeConfirm/);
  assert.match(pageJs, /await this\.fetchMaterialByCode\(normalizedCode\.product_code\)/);
  assert.match(pageWxml, /bindblur="onMaterialCodeBlur"/);
  assert.match(pageWxml, /bindconfirm="onMaterialCodeConfirm"/);
});
