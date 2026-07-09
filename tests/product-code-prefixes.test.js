const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BUILTIN_PRODUCT_CODE_PREFIX_SEEDS,
  normalizeProductCodePrefix,
  normalizeProductCodePrefixRecord,
  sortProductCodePrefixRecords,
  filterProductCodePrefixRecordsByCategory,
  buildProductCodePrefixActions
} = require('../cloudfunctions/_shared/product-code-prefixes');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('builtin product code prefixes cover chemical J/S/Y and film M', () => {
  assert.deepEqual(
    BUILTIN_PRODUCT_CODE_PREFIX_SEEDS.map(item => [item.prefix, item.category, item.status]),
    [
      ['J-', 'chemical', 'active'],
      ['S-', 'chemical', 'active'],
      ['Y-', 'chemical', 'active'],
      ['M-', 'film', 'active']
    ]
  );
});

test('product code prefix helpers normalize and filter active category prefixes', () => {
  assert.equal(normalizeProductCodePrefix('s'), 'S-');
  assert.equal(normalizeProductCodePrefix('Y-'), 'Y-');
  assert.equal(normalizeProductCodePrefix(''), '');

  const records = sortProductCodePrefixRecords([
    { prefix: 'S', category: 'chemical', name: 'S类化材', sort_order: 20 },
    { prefix: 'M-', category: 'film', name: '膜材', sort_order: 10 },
    { prefix: 'J-', category: 'chemical', name: 'J类化材', status: 'disabled', sort_order: 10 }
  ]);

  assert.deepEqual(records.map(item => item.prefix), ['J-', 'M-', 'S-']);
  assert.deepEqual(
    filterProductCodePrefixRecordsByCategory(records, 'chemical', { includeDisabled: false }).map(item => item.prefix),
    ['S-']
  );
  assert.deepEqual(buildProductCodePrefixActions(records, 'film'), [
    { name: 'M- 膜材', value: 'M-', prefix: 'M-', category: 'film' }
  ]);
  assert.equal(normalizeProductCodePrefixRecord({ prefix: 'y', category: 'chemical' }).prefix, 'Y-');
});

test('product code prefix management is registered and reachable for admins', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');
  const service = read('miniprogram/utils/product-code-prefix-service.js');
  const cloudIndex = read('cloudfunctions/manageProductCodePrefix/index.js');

  assert.match(appJson, /pages\/admin\/product-code-prefix-manage\/index/);
  assert.match(homeWxml, /产品代码前缀管理/);
  assert.match(service, /manageProductCodePrefix/);
  assert.match(cloudIndex, /product_code_prefixes/);
  assert.match(cloudIndex, /ensureBuiltinProductCodePrefixes/);
});

test('dynamic product code prefixes feed templates and backend material validation', () => {
  const exportMaterialTemplate = read('cloudfunctions/exportMaterialTemplate/index.js');
  const exportInventoryTemplate = read('cloudfunctions/exportInventoryTemplate/index.js');
  const manageMaterial = read('cloudfunctions/manageMaterial/index.js');
  const approveMaterialRequest = read('cloudfunctions/approveMaterialRequest/index.js');
  const syncScript = read('cloudfunctions/sync_shared.sh');

  assert.match(exportMaterialTemplate, /ensureBuiltinProductCodePrefixes/);
  assert.match(exportInventoryTemplate, /ensureBuiltinProductCodePrefixes/);
  assert.match(manageMaterial, /loadProductCodePrefixOptions/);
  assert.match(manageMaterial, /allowedPrefixes:\s*prefixOptions/);
  assert.match(approveMaterialRequest, /loadProductCodePrefixOptions/);
  assert.match(approveMaterialRequest, /allowedPrefixes:\s*prefixOptions/);
  assert.match(syncScript, /manageMaterial\/product-code-prefixes\.js/);
  assert.match(syncScript, /approveMaterialRequest\/product-code-prefixes\.js/);
  assert.match(syncScript, /exportInventoryTemplate\/product-code-prefixes\.js/);
});
