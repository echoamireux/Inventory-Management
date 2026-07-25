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
      label_material_name: '环氧树脂样品',
      subcategory_key: 'chemical_resin',
      sub_category: '树脂',
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
    {
      ok: true,
      supplier: '供应商A',
      label_material_name: '环氧树脂样品',
      material_name: '环氧树脂样品',
      subcategory_key: 'chemical_resin',
      sub_category: '树脂',
      supplier_model: 'A-100',
      supplier_model_key: 'A-100'
    }
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
  assert.doesNotMatch(appJson, /pages\/admin\/test-material-identity-import\/index/);
  assert.doesNotMatch(manifest, /exportTestMaterialIdentityTemplate/);
  assert.match(syncScript, /test-material-identities\.js/);
  assert.match(preflight, /test-material-identities\.js/);
  assert.match(readme, /test_material_identities\.identity_key/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/index.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/manageTestMaterialIdentity/package-lock.json')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'miniprogram/pages/admin/test-material-identity-import/index.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/exportTestMaterialIdentityTemplate/index.js')), false);
});

test('frontend identity selector helper remote-searches with product code keyword and pagination', async () => {
  const servicePath = path.join(repoRoot, 'miniprogram/utils/test-material-identity-service.js');
  delete require.cache[require.resolve(servicePath)];
  let capturedCall = null;
  global.wx = {
    cloud: {
      callFunction: async (payload) => {
        capturedCall = payload;
        return {
          result: {
            success: true,
            list: Array.from({ length: 20 }, (_, index) => ({
              product_code: 'J-999',
              supplier_model: index === 0 ? 'SC-150' : `SC-${150 + index}`,
              supplier_model_key: index === 0 ? 'SC-150' : `SC-${150 + index}`,
              label_material_name: '固化剂',
              sub_category: '固化剂',
              status: 'active',
              identity_key: `chemical::J-999::SC-${150 + index}`
            })),
            total: 150,
            page: payload.data.page,
            pageSize: payload.data.pageSize
          }
        };
      }
    }
  };

  try {
    const service = require(servicePath);
    const result = await service.searchTestMaterialIdentitySelectorPage({
      product_code: 'J-999',
      searchVal: 'SC-150',
      page: 2,
      pageSize: 20
    });

    assert.equal(capturedCall.name, 'manageTestMaterialIdentity');
    assert.equal(capturedCall.data.action, 'list');
    assert.equal(capturedCall.data.product_code, 'J-999');
    assert.equal(capturedCall.data.searchVal, 'SC-150');
    assert.equal(capturedCall.data.page, 2);
    assert.equal(capturedCall.data.pageSize, 20);
    assert.equal(result.actions[0].supplier_model, 'SC-150');
    assert.equal(result.total, 150);
    assert.equal(result.isEnd, false);
  } finally {
    delete global.wx;
    delete require.cache[require.resolve(servicePath)];
  }
});

test('test material identity manual edit stays registered while independent import path is removed', () => {
  const appJson = read('miniprogram/app.json');
  const manifest = read('scripts/cloudfunctions-manifest.json');
  const managePageJs = read('miniprogram/pages/admin/test-material-identity-manage/index.js');
  const managePageWxml = read('miniprogram/pages/admin/test-material-identity-manage/index.wxml');
  const editPageJs = read('miniprogram/pages/admin/test-material-identity-edit/index.js');
  const editPageWxml = read('miniprogram/pages/admin/test-material-identity-edit/index.wxml');
  const editPageJson = read('miniprogram/pages/admin/test-material-identity-edit/index.json');
  const editPageWxss = read('miniprogram/pages/admin/test-material-identity-edit/index.wxss');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const identityService = read('miniprogram/utils/test-material-identity-service.js');
  const parser = read('miniprogram/utils/import-file-parser.js');
  const manageFunction = read('cloudfunctions/manageTestMaterialIdentity/index.js');

  assert.match(appJson, /pages\/admin\/test-material-identity-manage\/index/);
  assert.match(appJson, /pages\/admin\/test-material-identity-edit\/index/);
  assert.doesNotMatch(appJson, /pages\/admin\/test-material-identity-import\/index/);
  assert.doesNotMatch(manifest, /exportTestMaterialIdentityTemplate/);
  assert.doesNotMatch(managePageJs, /action === 'import'[\s\S]*test-material-identity-import/);
  assert.match(managePageJs, /options\.keyword/);
  assert.match(managePageJs, /decodeOptionValue/);
  assert.match(managePageJs, /test-material-identity-edit\/index/);
  assert.match(managePageJs, /pageSize:\s*20/);
  assert.match(managePageJs, /onReachBottom/);
  assert.match(managePageJs, /loadIdentities\(\{\s*refresh:\s*true\s*\}\)/);
  assert.match(managePageJs, /if\s*\(\s*this\.data\.loading\s*&&\s*!refresh\s*\)/);
  assert.match(managePageJs, /if\s*\(\s*this\.data\.searchRequestId\s*===\s*requestId\s*\)\s*\{\s*Toast\.fail/);
  assert.match(managePageWxml, /identity-list__footer/);
  assert.doesNotMatch(managePageJs, /createTestMaterialIdentity/);
  assert.doesNotMatch(managePageJs, /formVisible/);
  assert.doesNotMatch(managePageJs, /exportTestMaterialIdentityTemplate/);
  assert.doesNotMatch(managePageJs, /persistBase64File/);
  assert.doesNotMatch(managePageJs, /fileContentBase64/);
  assert.doesNotMatch(managePageWxml, /导出模板|上传导入|批量导入/);
  assert.match(managePageWxml, /bind:click="onCreateIdentity"[\s\S]*新增/);
  assert.match(managePageWxml, /identity-model/);
  assert.match(managePageWxml, /item\.supplier_model \|\| '-'/);
  assert.match(managePageWxml, /item\.label_material_name \|\| item\.material_name/);
  assert.match(managePageWxml, /测试料代码：\{\{ item\.product_code \}\}/);
  assert.doesNotMatch(managePageWxml, /供应商：\{\{ item\.supplier \}\}/);
  assert.match(editPageJs, /loadTestMaterialOptions/);
  assert.match(editPageJs, /status:\s*'active'/);
  assert.match(editPageJs, /item\.is_test_material/);
  assert.match(editPageJs, /createTestMaterialIdentity/);
  assert.match(editPageJs, /normalizeTestMaterialSupplier/);
  assert.match(editPageJson, /"navigationBarTitleText":\s*"新增测试料型号"/);
  assert.doesNotMatch(editPageWxml, /<view class="edit-title">新增测试料型号<\/view>/);
  assert.match(editPageWxml, /真实物料名称、子类别和原厂型号/);
  assert.match(editPageWxml, /测试料产品代码/);
  assert.match(editPageWxml, /所属代码壳：/);
  assert.match(editPageWxml, /label="物料名称"/);
  assert.match(editPageWxml, /title="子类别"/);
  assert.match(editPageWxml, /管理子类别/);
  assert.doesNotMatch(editPageWxml, /selected-material-card/);
  assert.match(editPageWxss, /\.selected-material-summary/);
  assert.match(editPageWxml, /van-picker/);
  assert.match(editPageWxml, /label="供应商"/);
  assert.match(editPageWxml, /class="empty-actions"/);
  assert.match(editPageWxss, /\.empty-actions[\s\S]*justify-content:\s*center/);
  assert.doesNotMatch(materialListJs, /onManageTestMaterialIdentities/);
  assert.doesNotMatch(materialListJs, /onImportTestMaterialIdentity/);
  assert.match(materialListJs, /listTestMaterialIdentities/);
  assert.match(materialListJs, /loadIdentityResults/);
  assert.match(materialListJs, /test-material-identity-edit\/index/);
  assert.doesNotMatch(materialListJs, /test-material-identity-manage\/index\?action=create/);
  assert.doesNotMatch(materialListJs, /test-material-identity-import\/index/);
  assert.match(materialListWxml, /name="testIdentity"/);
  assert.match(materialListWxml, /测试料/);
  assert.match(materialListWxml, /identity-model-title/);
  assert.match(materialListWxml, /item\.supplier_model \|\| '-'/);
  assert.match(materialListWxml, /子类别：/);
  assert.match(materialListWxml, /测试料代码：/);
  assert.doesNotMatch(materialListWxml, /identity-card__tags[\s\S]*size="medium"/);
  assert.doesNotMatch(materialListWxml, /供应商：\{\{ item\.supplier \}\}/);
  assert.doesNotMatch(materialListWxml, /bind:click="onImportTestMaterialIdentity"[\s\S]*导入/);
  assert.match(materialListWxml, /bind:click="onCreateTestMaterialIdentity"[\s\S]*新增/);
  assert.doesNotMatch(materialListWxml, /批量导入|新增型号/);
  assert.doesNotMatch(materialListWxml, /bind:click="onManageTestMaterialIdentities"/);
  assert.doesNotMatch(identityService, /batchCreateTestMaterialIdentities/);
  assert.doesNotMatch(manageFunction, /batchCreateIdentities/);
  assert.doesNotMatch(manageFunction, /action === 'batchCreate'/);
  assert.doesNotMatch(parser, /test_material_identity_import/);
  assert.doesNotMatch(parser, /测试料型号库/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/exportTestMaterialIdentityTemplate/index.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'miniprogram/pages/admin/test-material-identity-import/index.js')), false);
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
  assert.match(addMaterial, /label_material_name/);
  assert.match(addMaterial, /requestedSupplier \|\| identityValidation\.supplier/);
  assert.match(batchAdd, /supplier_model_key/);
  assert.match(batchAdd, /label_material_name/);
  assert.match(batchAdd, /requestedSupplier \|\| identityValidation\.supplier/);
  assert.match(importTemplate, /supplier_model_key/);
  assert.match(importTemplate, /label_material_name/);
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
