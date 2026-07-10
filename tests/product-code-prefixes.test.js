const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BUILTIN_PRODUCT_CODE_PREFIX_SEEDS,
  ensureBuiltinProductCodePrefixes,
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
      ['J', 'chemical', 'active'],
      ['S', 'chemical', 'active'],
      ['Y', 'chemical', 'active'],
      ['M', 'film', 'active']
    ]
  );
  assert.equal(BUILTIN_PRODUCT_CODE_PREFIX_SEEDS.some(item => item.name), false);
});

test('builtin prefix seeds use stable document ids for concurrent initialization', () => {
  assert.equal(
    require('../cloudfunctions/_shared/product-code-prefixes').buildBuiltinProductCodePrefixDocumentId('chemical', 'J'),
    'builtin_prefix_chemical_j'
  );
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/_shared/product-code-prefixes.js'), 'utf8');
  assert.match(source, /collection\.doc\(buildBuiltinProductCodePrefixDocumentId\(seed\.category, seed\.prefix\)\)\.set/);
});

test('product code prefix helpers normalize and filter active category prefixes', () => {
  assert.equal(normalizeProductCodePrefix('s'), 'S');
  assert.equal(normalizeProductCodePrefix('jp'), 'JP');
  assert.equal(normalizeProductCodePrefix('Y'), 'Y');
  assert.equal(/^[A-Z]{1,4}$/.test(normalizeProductCodePrefix('Y-')), false);
  assert.equal(/^[A-Z]{1,4}$/.test(normalizeProductCodePrefix('ABCDE')), false);
  assert.equal(normalizeProductCodePrefix(''), '');

  const records = sortProductCodePrefixRecords([
    { prefix: 'JP', category: 'chemical', sort_order: 30 },
    { prefix: 'S', category: 'chemical', sort_order: 20 },
    { prefix: 'M', category: 'film', sort_order: 10 },
    { prefix: 'J', category: 'chemical', status: 'disabled', sort_order: 10 },
    { prefix: 'ABCDE', category: 'chemical', sort_order: 40 }
  ]);

  assert.deepEqual(records.map(item => item.prefix), ['J', 'M', 'S', 'JP']);
  assert.deepEqual(
    filterProductCodePrefixRecordsByCategory(records, 'chemical', { includeDisabled: false }).map(item => item.prefix),
    ['S', 'JP']
  );
  assert.deepEqual(buildProductCodePrefixActions(records, 'film'), [
    { name: 'M', value: 'M', prefix: 'M', category: 'film' }
  ]);
  assert.equal(normalizeProductCodePrefixRecord({ prefix: 'y', category: 'chemical' }).prefix, 'Y');
});

test('frontend prefix picker presents plain prefix letters without descriptions', () => {
  const { buildProductCodePrefixPickerColumns } = require('../miniprogram/utils/product-code-prefix-service');

  const columns = buildProductCodePrefixPickerColumns([
    { prefix: 'J', category: 'chemical', status: 'active' },
    { prefix: 'JP', category: 'chemical', status: 'active' },
    { prefix: 'M', category: 'film', status: 'active' }
  ], 'chemical');

  assert.deepEqual(columns, [
    { name: 'J', text: 'J', value: 'J', prefix: 'J', category: 'chemical' },
    { name: 'JP', text: 'JP', value: 'JP', prefix: 'JP', category: 'chemical' }
  ]);
});

test('product code prefix collection ensure treats cloud already-exists errors as idempotent', async () => {
  const existingErrors = [
    { errMsg: 'createCollection:fail [ResourceUnavailable.ResourceExist] Table exist' },
    { errMsg: 'DATABASE_COLLECTION_ALREADY_EXIST' },
    { message: 'DATABASE_COLLECTION_ALREADY_EXISTS' }
  ];

  for (const error of existingErrors) {
    const added = [];
    const db = {
      async createCollection() {
        throw error;
      },
      serverDate() {
        return new Date('2026-01-01T00:00:00Z');
      },
      collection() {
        return {
          skip() { return this; },
          limit() { return this; },
          async get() { return { data: added }; },
          async add({ data }) {
            added.push({ _id: `prefix-${added.length}`, ...data });
            return { _id: `prefix-${added.length}` };
          },
          doc(id) {
            return {
              async set({ data }) {
                const index = added.findIndex(item => item._id === id);
                if (index === -1) added.push({ _id: id, ...data });
                else added[index] = { _id: id, ...data };
              },
              async update() {}
            };
          }
        };
      }
    };

    await assert.doesNotReject(() => ensureBuiltinProductCodePrefixes(db));
    assert.deepEqual(added.map(item => item.prefix), ['J', 'S', 'Y', 'M']);
  }
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

test('product code prefix form surfaces invalid prefix feedback inside the popup', () => {
  const pageWxml = read('miniprogram/pages/admin/product-code-prefix-manage/index.wxml');
  const pageJs = read('miniprogram/pages/admin/product-code-prefix-manage/index.js');

  assert.match(pageWxml, /<van-toast\s+id="van-toast"/);
  assert.match(pageWxml, /error-message="\{\{ formPrefixError \}\}"/);
  assert.match(pageJs, /formPrefixError/);
  assert.match(pageJs, /前缀只能填写 1-4 位大写英文字母/);
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
