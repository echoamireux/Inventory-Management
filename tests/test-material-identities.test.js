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
  assert.doesNotMatch(homeWxml, /title="测试料型号库"/);
  assert.match(homeWxml, /title="主数据管理"/);
  assert.match(manifest, /manageTestMaterialIdentity/);
  assert.match(syncScript, /test-material-identities\.js/);
  assert.match(preflight, /test-material-identities\.js/);
  assert.match(readme, /test_material_identities\.identity_key/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/index.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/package-lock.json')), true);
});

test('test material identity template export is registered and opened from inline workbook content', () => {
  const appJson = read('miniprogram/app.json');
  const manifest = read('scripts/cloudfunctions-manifest.json');
  const managePageJs = read('miniprogram/pages/admin/test-material-identity-manage/index.js');
  const managePageWxml = read('miniprogram/pages/admin/test-material-identity-manage/index.wxml');
  const importPageJs = read('miniprogram/pages/admin/test-material-identity-import/index.js');
  const importPageWxml = read('miniprogram/pages/admin/test-material-identity-import/index.wxml');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');

  assert.match(appJson, /pages\/admin\/test-material-identity-manage\/index/);
  assert.match(appJson, /pages\/admin\/test-material-identity-import\/index/);
  assert.match(manifest, /exportTestMaterialIdentityTemplate/);
  assert.match(managePageJs, /action === 'import'[\s\S]*test-material-identity-import/);
  assert.match(managePageJs, /options\.keyword/);
  assert.match(managePageJs, /decodeOptionValue/);
  assert.doesNotMatch(managePageJs, /exportTestMaterialIdentityTemplate/);
  assert.doesNotMatch(managePageJs, /persistBase64File/);
  assert.doesNotMatch(managePageJs, /fileContentBase64/);
  assert.doesNotMatch(managePageWxml, /导出模板|上传导入|批量导入/);
  assert.match(managePageWxml, /bind:click="onCreateIdentity"[\s\S]*新增/);
  assert.match(importPageJs, /exportTestMaterialIdentityTemplate/);
  assert.match(importPageJs, /persistBase64File/);
  assert.match(importPageJs, /fileContentBase64/);
  assert.match(importPageJs, /无法导出模板/);
  assert.match(importPageJs, /parseImportTemplateFileBuffer/);
  assert.match(importPageJs, /sheetName:\s*'测试料型号库'/);
  assert.match(importPageJs, /MAX_IMPORT_ROWS\s*=\s*100/);
  assert.match(importPageWxml, /第一步：导出最新模板/);
  assert.match(importPageWxml, /第二步：上传文件/);
  assert.match(importPageWxml, /请先导出模板并上传 \.xlsx 文件/);
  assert.doesNotMatch(materialListJs, /onManageTestMaterialIdentities/);
  assert.match(materialListJs, /listTestMaterialIdentities/);
  assert.match(materialListJs, /loadIdentityResults/);
  assert.match(materialListJs, /test-material-identity-import\/index/);
  assert.match(materialListWxml, /name="testIdentity"/);
  assert.match(materialListWxml, /测试料型号库/);
  assert.match(materialListWxml, /所属物料：/);
  assert.match(materialListWxml, /bind:click="onImportTestMaterialIdentity"[\s\S]*导入/);
  assert.match(materialListWxml, /bind:click="onCreateTestMaterialIdentity"[\s\S]*新增/);
  assert.doesNotMatch(materialListWxml, /批量导入|新增型号/);
  assert.doesNotMatch(materialListWxml, /bind:click="onManageTestMaterialIdentities"/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/exportTestMaterialIdentityTemplate/index.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/exportTestMaterialIdentityTemplate/package-lock.json')), true);
});

test('test material identity workbook template uses active test material codes as the product code dropdown', async () => {
  const {
    TEMPLATE_HEADERS,
    DATA_SHEET_NAME,
    CONFIG_SHEET_NAME,
    buildTestMaterialIdentityTemplateSpec,
    buildTestMaterialIdentityWorkbook
  } = require('../cloudfunctions/exportTestMaterialIdentityTemplate/identity-template-workbook');

  assert.deepEqual(TEMPLATE_HEADERS, ['测试料产品代码*', '原厂型号*']);

  const spec = buildTestMaterialIdentityTemplateSpec({
    testMaterials: [
      { product_code: 'J-999', material_name: '测试料化材', status: 'active', is_test_material: true },
      { product_code: 'S-999', material_name: '测试料S', status: 'active', is_test_material: true },
      { product_code: 'J-001', material_name: '正式料', status: 'active', is_test_material: false },
      { product_code: 'Y-999', material_name: '已停用测试料', status: 'archived', is_test_material: true }
    ]
  });

  assert.equal(spec.dataSheetName, DATA_SHEET_NAME);
  assert.deepEqual(spec.testMaterialCodes, ['J-999', 'S-999']);
  assert.equal(spec.definedNames.testMaterialCodes.name, '测试料_产品代码');
  assert.match(spec.validationRanges.productCode, /^A3:A\d+$/);

  const workbook = await buildTestMaterialIdentityWorkbook(spec);
  const dataSheet = workbook.getWorksheet(DATA_SHEET_NAME);
  const configSheet = workbook.getWorksheet(CONFIG_SHEET_NAME);
  assert.equal(dataSheet.getRow(1).getCell(1).value, '测试料产品代码*');
  assert.equal(dataSheet.getRow(2).getCell(1).value, '必填，从下拉选择已启用测试料主数据');
  assert.equal(configSheet.getRow(2).getCell(1).value, 'J-999');
  assert.equal(configSheet.getRow(2).getCell(2).value, '测试料化材');

  dataSheet.getRow(3).getCell(1).value = 'J-999';
  dataSheet.getRow(3).getCell(2).value = 'A-100';
  const buffer = await workbook.xlsx.writeBuffer();
  const {
    getParsedTemplateMeta,
    parseImportTemplateFileBuffer
  } = require('../miniprogram/utils/import-file-parser');
  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '测试料型号库导入模板.xlsx',
    sheetName: DATA_SHEET_NAME,
    expectedHeaderRows: [
      ['测试料产品代码*', '原厂型号*'],
      ['必填，从下拉选择已启用测试料主数据', '必填；保留大小写，系统会整理全角和多余空格']
    ]
  });
  assert.equal(getParsedTemplateMeta(rows).templateKind, 'test_material_identity_import');
  assert.equal(rows.find(row => row.rowIndex === 3).values[0], 'J-999');
  assert.equal(rows.find(row => row.rowIndex === 3).values[1], 'A-100');
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
