const test = require('node:test');
const assert = require('node:assert/strict');

const frontendSearch = require('../miniprogram/utils/search');
const backendSearch = require('../cloudfunctions/_shared/search');

for (const [label, impl] of [
  ['frontend', frontendSearch],
  ['backend', backendSearch]
]) {
  test(`${label}: search helpers trim whitespace and detect empty keywords`, () => {
    assert.equal(impl.normalizeSearchKeyword('  J-001  '), 'J-001');
    assert.equal(impl.normalizeSearchKeyword('   '), '');
    assert.equal(impl.isEmptySearchKeyword('   '), true);
    assert.equal(impl.isEmptySearchKeyword(' A '), false);
  });

  test(`${label}: search helpers escape RegExp metacharacters before querying`, () => {
    assert.equal(
      impl.escapeRegExp('化材(通用)+[A].\\'),
      '化材\\(通用\\)\\+\\[A\\]\\.\\\\'
    );
  });

  test(`${label}: search helpers build case-insensitive contains configs without wildcard padding`, () => {
    const regExpConfig = impl.buildContainsRegExp({
      RegExp(config) {
        return config;
      }
    }, ' A+B ');

    assert.deepEqual(regExpConfig, {
      regexp: 'A\\+B',
      options: 'i'
    });
  });

  test(`${label}: search helpers normalize width, case, dashes, and code spacing consistently`, () => {
    assert.equal(impl.normalizeSearchKeyword('  ｊ － ９９９  '), 'J-999');
    assert.equal(impl.normalizeSearchKeyword('ＡＢＣ　 ２００'), 'ABC 200');
    assert.equal(impl.normalizeSearchKeyword('MODEL –  A'), 'MODEL-A');
  });

  test(`${label}: search scoring prefers exact, prefix, contains, then auxiliary matches`, () => {
    const records = [
      { _id: 'contains', product_code: 'X-199', material_name: 'Other' },
      { _id: 'prefix-2', product_code: 'J-901', material_name: 'Prefix 2' },
      { _id: 'aux', product_code: 'A-001', supplier: 'J-9 supplier' },
      { _id: 'prefix-1', product_code: 'J-900', material_name: 'Prefix 1' },
      { _id: 'exact-model', product_code: 'T-001', supplier_model: 'J-9' }
    ];

    const ranked = impl.rankSearchResults(records, 'j－9', {
      codeFields: ['product_code'],
      modelFields: ['supplier_model'],
      nameFields: ['material_name'],
      auxiliaryFields: ['supplier'],
      stableFields: ['product_code', 'supplier_model', '_id']
    });

    assert.equal(ranked[0]._id, 'exact-model');
    assert.equal(ranked[0].match_score, 950);
    assert.equal(ranked[0].match_reason, '测试料型号完全匹配');
    assert.deepEqual(ranked.slice(1, 3).map(item => item.product_code), ['J-900', 'J-901']);
    assert.equal(ranked[3]._id, 'aux');
  });

  test(`${label}: matchesSearchFields treats regexp characters as text and uses normalized record fields`, () => {
    const record = {
      product_code: 'J-900',
      supplier_model: 'A+B(1)',
      location_text: '一号库 － A'
    };

    assert.equal(impl.matchesSearchFields(record, ['product_code'], 'ｊ－9'), true);
    assert.equal(impl.matchesSearchFields(record, ['supplier_model'], 'A+B(1)'), true);
    assert.equal(impl.matchesSearchFields(record, ['location_text'], '一号库-A'), true);
    assert.equal(impl.matchesSearchFields(record, ['product_code'], 'Z-9'), false);
  });
}
