const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('test material identity normalization keeps case but removes noisy spacing and full-width forms', () => {
  const {
    normalizeTestMaterialSupplierModel,
    buildTestMaterialSupplierModelKey,
    buildTestMaterialIdentityKey
  } = require('../cloudfunctions/_shared/test-material-identities');

  assert.equal(normalizeTestMaterialSupplierModel('  A - 100  '), 'A-100');
  assert.equal(normalizeTestMaterialSupplierModel('Ａ－１００'), 'A-100');
  assert.equal(normalizeTestMaterialSupplierModel('abc100'), 'abc100');
  assert.notEqual(
    buildTestMaterialSupplierModelKey('abc100'),
    buildTestMaterialSupplierModelKey('ABC100')
  );
  assert.equal(
    buildTestMaterialIdentityKey({
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: ' A - 100 '
    }),
    'chemical::J-999::A-100'
  );
});

test('test material identity validation depends on material master flag, not product code 999', () => {
  const {
    validateTestMaterialIdentitySelection
  } = require('../cloudfunctions/_shared/test-material-identities');
  const {
    isTestMaterial
  } = require('../cloudfunctions/_shared/test-material');

  const activeIdentities = [
    {
      category: 'chemical',
      product_code: 'J-001',
      supplier_model: 'A-100',
      supplier_model_key: 'A-100',
      status: 'active'
    },
    {
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: 'B-100',
      supplier_model_key: 'B-100',
      status: 'disabled'
    }
  ];

  assert.deepEqual(
    validateTestMaterialIdentitySelection({
      material: { category: 'chemical', product_code: 'J-999', is_test_material: false },
      source: { supplier_model: '' },
      identities: activeIdentities
    }),
    { ok: true, supplier_model: '', supplier_model_key: '' }
  );
  assert.equal(isTestMaterial({ is_test_material: false }, { is_test_material: true }), false);
  assert.equal(isTestMaterial({ is_test_material: true }, { is_test_material: false }), true);

  assert.deepEqual(
    validateTestMaterialIdentitySelection({
      material: { category: 'chemical', product_code: 'J-001', is_test_material: true },
      source: { supplier_model: ' A - 100 ' },
      identities: activeIdentities
    }),
    { ok: true, supplier_model: 'A-100', supplier_model_key: 'A-100' }
  );

  assert.match(
    validateTestMaterialIdentitySelection({
      material: { category: 'chemical', product_code: 'J-999', is_test_material: true },
      source: { supplier_model: 'B-100' },
      identities: activeIdentities
    }).msg,
    /未启用/
  );
});

test('test material identity records reject exact duplicates and flag similar values for admin confirmation', () => {
  const {
    normalizeTestMaterialIdentityRecord,
    findTestMaterialIdentityConflict
  } = require('../cloudfunctions/_shared/test-material-identities');

  const existing = [
    normalizeTestMaterialIdentityRecord({
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: 'A-100',
      status: 'active'
    })
  ];
  const exact = normalizeTestMaterialIdentityRecord({
    category: 'chemical',
    product_code: 'J-999',
    supplier_model: ' A - 100 ',
    status: 'active'
  });
  const caseDifferent = normalizeTestMaterialIdentityRecord({
    category: 'chemical',
    product_code: 'J-999',
    supplier_model: 'a-100',
    status: 'active'
  });

  assert.equal(findTestMaterialIdentityConflict(existing, exact).type, 'exact');
  assert.equal(findTestMaterialIdentityConflict(existing, caseDifferent).type, 'similar');
});

test('test material identity management is registered for admins and shared to write functions', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');
  const manifest = read('scripts/cloudfunctions-manifest.json');
  const syncScript = read('cloudfunctions/sync_shared.sh');
  const preflight = read('scripts/deploy-preflight.js');
  const readme = read('README.md');

  assert.match(appJson, /pages\/admin\/test-material-identity-manage\/index/);
  assert.match(homeWxml, /测试料型号库/);
  assert.match(manifest, /manageTestMaterialIdentity/);
  assert.match(syncScript, /test-material-identities\.js/);
  assert.match(preflight, /test-material-identities\.js/);
  assert.match(readme, /test_material_identities\.identity_key/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/index.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/package-lock.json')), true);
});

test('test material identity enforcement reaches labels, stock-in and inventory imports', () => {
  const labelPreprint = read('cloudfunctions/exportLabelData/preprint-labels.js');
  const addMaterial = read('cloudfunctions/addMaterial/index.js');
  const batchAdd = read('cloudfunctions/batchAddInventory/batch-add.js');
  const importTemplate = read('cloudfunctions/importInventoryTemplate/inventory-import.js');
  const updateInventory = read('cloudfunctions/updateInventory/index.js');
  const materialAddPage = read('miniprogram/pages/material-add/index.wxml');
  const batchEntryPage = read('miniprogram/pages/material-add/batch-entry.wxml');
  const labelExportPage = read('miniprogram/pages/admin/label-export/index.js');

  assert.match(labelPreprint, /validateTestMaterialIdentitySelection/);
  assert.match(addMaterial, /supplier_model_key/);
  assert.match(batchAdd, /supplier_model_key/);
  assert.match(importTemplate, /supplier_model_key/);
  assert.match(updateInventory, /supplier_model_key/);
  assert.match(materialAddPage, /showTestMaterialIdentitySheet/);
  assert.match(batchEntryPage, /测试料原厂型号/);
  assert.match(labelExportPage, /supplier_model_key/);
});
