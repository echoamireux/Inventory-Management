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
}
