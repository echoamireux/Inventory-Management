const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadMaterialMapByProductCodes
} = require('../cloudfunctions/_shared/material-map');

test('material map loader chunks product codes and paginates each chunk', async () => {
  const productCodes = Array.from({ length: 205 }, (_, index) => `P-${index + 1}`);
  const materials = productCodes.map((productCode, index) => ({
    product_code: productCode,
    status: index % 2 === 0 ? 'active' : 'archived',
    default_unit: index % 3 === 0 ? 'm²' : 'kg'
  }));

  const calls = [];
  const materialMap = await loadMaterialMapByProductCodes(productCodes, async ({ productCodes: batch, skip, limit }) => {
    calls.push({ batchSize: batch.length, skip, limit });
    return materials.filter((item) => batch.includes(item.product_code)).slice(skip, skip + limit);
  }, {
    batchSize: 100,
    pageSize: 40
  });

  assert.equal(materialMap.size, 205);
  assert.equal(materialMap.get('P-2').status, 'archived');
  assert.equal(materialMap.get('P-4').default_unit, 'm²');
  assert.ok(calls.length > 3);
  assert.ok(calls.every((call) => call.batchSize <= 100));
  assert.ok(calls.every((call) => call.limit === 40));
});
