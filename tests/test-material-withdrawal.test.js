const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldBlockTestMaterialProductOnlyWithdrawal
} = require('../cloudfunctions/updateInventory/test-material-withdrawal');

test('test material withdrawal blocks product-code-only auto allocation', () => {
  const candidates = [
    {
      _id: 'inv-test-1',
      product_code: 'J-999',
      unique_code: 'L000901',
      is_test_material: true
    }
  ];

  assert.deepEqual(
    shouldBlockTestMaterialProductOnlyWithdrawal({
      product_code: 'J-999',
      candidates,
      material: { is_test_material: true }
    }),
    {
      blocked: true,
      msg: '测试料请扫码标签或选择明确批次后出库，不能仅按产品代码自动扣减'
    }
  );
});

test('test material withdrawal allows scan or explicit batch selections and formal materials', () => {
  const candidates = [
    {
      _id: 'inv-test-1',
      product_code: 'J-999',
      unique_code: 'L000901',
      is_test_material: true
    }
  ];

  assert.equal(
    shouldBlockTestMaterialProductOnlyWithdrawal({
      product_code: 'J-999',
      unique_code: 'L000901',
      candidates
    }).blocked,
    false
  );
  assert.equal(
    shouldBlockTestMaterialProductOnlyWithdrawal({
      product_code: 'J-999',
      batch_no: 'TEST-001',
      candidates
    }).blocked,
    false
  );
  assert.equal(
    shouldBlockTestMaterialProductOnlyWithdrawal({
      product_code: 'J-001',
      candidates: [{ product_code: 'J-001', is_test_material: false }],
      material: { is_test_material: false }
    }).blocked,
    false
  );
});
