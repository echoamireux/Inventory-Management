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
    normalizeTestMaterialSupplier,
    normalizeTestMaterialSupplierModel,
    buildTestMaterialSupplierModelKey,
    buildSimilarSupplierModelKey,
    buildTestMaterialIdentityKey
  } = require('../cloudfunctions/_shared/test-material-identities');

  assert.equal(normalizeTestMaterialSupplier('  供应商　A  '), '供应商 A');
  assert.equal(normalizeTestMaterialSupplierModel('  A - 100  '), 'A-100');
  assert.equal(normalizeTestMaterialSupplierModel('Ａ－１００'), 'A-100');
  assert.equal(normalizeTestMaterialSupplierModel('abc100'), 'abc100');
  assert.notEqual(
    buildTestMaterialSupplierModelKey('abc100'),
    buildTestMaterialSupplierModelKey('ABC100')
  );
  assert.equal(buildSimilarSupplierModelKey('A C'), buildSimilarSupplierModelKey('AC'));
  assert.equal(buildSimilarSupplierModelKey(' Ａ　Ｃ '), buildSimilarSupplierModelKey('ac'));
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
      supplier: '供应商A',
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
    { ok: true, supplier: '', supplier_model: '', supplier_model_key: '' }
  );
  assert.equal(isTestMaterial({ is_test_material: false }, { is_test_material: true }), false);
  assert.equal(isTestMaterial({ is_test_material: true }, { is_test_material: false }), true);

  assert.deepEqual(
    validateTestMaterialIdentitySelection({
      material: { category: 'chemical', product_code: 'J-001', is_test_material: true },
      source: { supplier_model: ' A - 100 ' },
      identities: activeIdentities
    }),
    { ok: true, supplier: '供应商A', supplier_model: 'A-100', supplier_model_key: 'A-100' }
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
    findTestMaterialIdentityConflict,
    buildTestMaterialIdentityKey
  } = require('../cloudfunctions/_shared/test-material-identities');

  const existing = [
    normalizeTestMaterialIdentityRecord({
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: 'A-100',
      supplier: '供应商A',
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
  const spaceDifferent = normalizeTestMaterialIdentityRecord({
    category: 'chemical',
    product_code: 'J-999',
    supplier_model: 'A 100',
    status: 'active'
  });

  assert.equal(findTestMaterialIdentityConflict(existing, exact).type, 'exact');
  assert.equal(findTestMaterialIdentityConflict(existing, caseDifferent).type, 'similar');
  assert.equal(findTestMaterialIdentityConflict([
    normalizeTestMaterialIdentityRecord({
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: 'A100',
      status: 'active'
    })
  ], spaceDifferent).type, 'similar');
  assert.equal(existing[0].supplier, '供应商A');
  assert.equal(
    buildTestMaterialIdentityKey({
      category: 'chemical',
      product_code: 'J-999',
      supplier_model: 'A-100',
      supplier: '另一个供应商'
    }),
    'chemical::J-999::A-100'
  );
});

test('test material identity management is registered for admins and shared to write functions', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');
  const manifest = read('scripts/cloudfunctions-manifest.json');
  const syncScript = read('cloudfunctions/sync_shared.sh');
  const preflight = read('scripts/deploy-preflight.js');
  const readme = read('README.md');

  assert.match(appJson, /pages\/admin\/test-material-identity-manage\/index/);
  assert.match(appJson, /pages\/admin\/test-material-identity-edit\/index/);
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
  const editPageJs = read('miniprogram/pages/admin/test-material-identity-edit/index.js');
  const editPageWxml = read('miniprogram/pages/admin/test-material-identity-edit/index.wxml');
  const editPageJson = read('miniprogram/pages/admin/test-material-identity-edit/index.json');
  const editPageWxss = read('miniprogram/pages/admin/test-material-identity-edit/index.wxss');
  const importPageJs = read('miniprogram/pages/admin/test-material-identity-import/index.js');
  const importPageWxml = read('miniprogram/pages/admin/test-material-identity-import/index.wxml');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');

  assert.match(appJson, /pages\/admin\/test-material-identity-manage\/index/);
  assert.match(appJson, /pages\/admin\/test-material-identity-edit\/index/);
  assert.match(appJson, /pages\/admin\/test-material-identity-import\/index/);
  assert.match(manifest, /exportTestMaterialIdentityTemplate/);
  assert.match(managePageJs, /action === 'import'[\s\S]*test-material-identity-import/);
  assert.match(managePageJs, /options\.keyword/);
  assert.match(managePageJs, /decodeOptionValue/);
  assert.match(managePageJs, /test-material-identity-edit\/index/);
  assert.doesNotMatch(managePageJs, /createTestMaterialIdentity/);
  assert.doesNotMatch(managePageJs, /formVisible/);
  assert.doesNotMatch(managePageJs, /exportTestMaterialIdentityTemplate/);
  assert.doesNotMatch(managePageJs, /persistBase64File/);
  assert.doesNotMatch(managePageJs, /fileContentBase64/);
  assert.doesNotMatch(managePageWxml, /导出模板|上传导入|批量导入/);
  assert.match(managePageWxml, /bind:click="onCreateIdentity"[\s\S]*新增/);
  assert.match(managePageWxml, /供应商：\{\{ item\.supplier \}\}/);
  assert.match(editPageJs, /loadTestMaterialOptions/);
  assert.match(editPageJs, /status:\s*'active'/);
  assert.match(editPageJs, /item\.is_test_material/);
  assert.match(editPageJs, /createTestMaterialIdentity/);
  assert.match(editPageJs, /normalizeTestMaterialSupplier/);
  assert.match(editPageJson, /"navigationBarTitleText":\s*"新增测试料型号"/);
  assert.doesNotMatch(editPageWxml, /<view class="edit-title">新增测试料型号<\/view>/);
  assert.match(editPageWxml, /真实原厂型号维护在这里/);
  assert.match(editPageWxml, /测试料产品代码/);
  assert.match(editPageWxml, /所属物料：/);
  assert.doesNotMatch(editPageWxml, /selected-material-card/);
  assert.match(editPageWxss, /\.selected-material-summary/);
  assert.match(editPageWxml, /van-picker/);
  assert.match(editPageWxml, /label="供应商"/);
  assert.match(editPageWxml, /class="empty-actions"/);
  assert.match(editPageWxss, /\.empty-actions[\s\S]*justify-content:\s*center/);
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
  assert.match(materialListJs, /test-material-identity-edit\/index/);
  assert.doesNotMatch(materialListJs, /test-material-identity-manage\/index\?action=create/);
  assert.match(materialListJs, /test-material-identity-import\/index/);
  assert.match(materialListWxml, /name="testIdentity"/);
  assert.match(materialListWxml, /测试料型号库/);
  assert.match(materialListWxml, /所属物料：/);
  assert.match(materialListWxml, /供应商：\{\{ item\.supplier \}\}/);
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

  assert.deepEqual(TEMPLATE_HEADERS, ['测试料产品代码*', '原厂型号*', '供应商（选填）']);

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
  assert.equal(dataSheet.getRow(1).getCell(3).value, '供应商（选填）');
  assert.equal(dataSheet.getRow(2).getCell(1).value, '必填，从下拉选择已启用测试料主数据');
  assert.equal(dataSheet.getRow(2).getCell(3).value, '选填；作为入库和预打印默认供应商');
  assert.ok(dataSheet.getColumn(1).width >= 34);
  assert.ok(dataSheet.getColumn(2).width >= 56);
  assert.ok(dataSheet.getColumn(3).width >= 44);
  assert.ok(dataSheet.getRow(2).height >= 40);
  assert.equal(configSheet.getRow(2).getCell(1).value, 'J-999');
  assert.equal(configSheet.getRow(2).getCell(2).value, '测试料化材');

  dataSheet.getRow(3).getCell(1).value = 'J-999';
  dataSheet.getRow(3).getCell(2).value = 'A-100';
  dataSheet.getRow(3).getCell(3).value = '供应商A';
  const buffer = await workbook.xlsx.writeBuffer();
  const {
    getParsedTemplateMeta,
    parseImportTemplateFileBuffer
  } = require('../miniprogram/utils/import-file-parser');
  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '测试料型号库导入模板.xlsx',
    sheetName: DATA_SHEET_NAME,
    expectedHeaderRows: [
      ['测试料产品代码*', '原厂型号*', '供应商（选填）'],
      ['必填，从下拉选择已启用测试料主数据', '必填；保留大小写，系统会整理全角和多余空格', '选填；作为入库和预打印默认供应商']
    ]
  });
  assert.equal(getParsedTemplateMeta(rows).templateKind, 'test_material_identity_import');
  assert.equal(rows.find(row => row.rowIndex === 3).values[0], 'J-999');
  assert.equal(rows.find(row => row.rowIndex === 3).values[1], 'A-100');
  assert.equal(rows.find(row => row.rowIndex === 3).values[2], '供应商A');
});

test('test material identity enforcement reaches labels, stock-in and inventory imports', () => {
  const labelPreprint = read('cloudfunctions/exportLabelData/preprint-labels.js');
  const addMaterial = read('cloudfunctions/addMaterial/index.js');
  const batchAdd = read('cloudfunctions/batchAddInventory/batch-add.js');
  const importTemplate = read('cloudfunctions/importInventoryTemplate/inventory-import.js');
  const updateInventory = read('cloudfunctions/updateInventory/index.js');
  const manageIdentity = read('cloudfunctions/manageTestMaterialIdentity/index.js');
  const identityService = read('miniprogram/utils/test-material-identity-service.js');
  const materialAddPage = read('miniprogram/pages/material-add/index.wxml');
  const materialAddJs = read('miniprogram/pages/material-add/index.js');
  const batchEntryPage = read('miniprogram/pages/material-add/batch-entry.wxml');
  const batchEntryJs = read('miniprogram/pages/material-add/batch-entry.js');
  const labelExportPage = read('miniprogram/pages/admin/label-export/index.js');

  assert.match(labelPreprint, /validateTestMaterialIdentitySelection/);
  assert.match(addMaterial, /supplier_model_key/);
  assert.match(addMaterial, /requestedSupplier \|\| identityValidation\.supplier/);
  assert.match(batchAdd, /supplier_model_key/);
  assert.match(batchAdd, /requestedSupplier \|\| identityValidation\.supplier/);
  assert.match(importTemplate, /supplier_model_key/);
  assert.match(importTemplate, /row\.supplier = identityValidation\.supplier/);
  assert.match(updateInventory, /supplier_model_key/);
  assert.match(manageIdentity, /\{ supplier: searchRegex \}/);
  assert.match(manageIdentity, /supplier:\s*candidate\.supplier/);
  assert.match(identityService, /const supplier = normalizeTestMaterialSupplier\(item\.supplier\)/);
  assert.match(identityService, /supplier,/);
  assert.match(materialAddPage, /showTestMaterialIdentitySheet/);
  assert.match(materialAddJs, /'form\.supplier': item\.supplier/);
  assert.match(batchEntryPage, /测试料原厂型号/);
  assert.match(batchEntryJs, /supplier:\s*overrides\.supplier \|\| identity\.supplier/);
  assert.match(labelExportPage, /supplier_model_key/);
  assert.match(labelExportPage, /'preprintForm\.supplier': item\.supplier/);
});
