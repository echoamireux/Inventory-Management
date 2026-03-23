const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareInventoryAllocationOrder,
  getAvailableAllocationStock,
  sortInventoryAllocationCandidates,
  pickPreferredAllocationItem,
  buildInventoryAllocationRecommendation
} = require('../cloudfunctions/_shared/inventory-allocation');

test('allocation helper sorts explicit expiry before long-term and missing-expiry records', () => {
  const sorted = sortInventoryAllocationCandidates([
    {
      _id: 'long-term',
      unique_code: 'L000003',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 5, unit: 'kg' },
      is_long_term_valid: true,
      create_time: '2026-03-20T08:00:00.000Z'
    },
    {
      _id: 'missing-expiry',
      unique_code: 'L000002',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 5, unit: 'kg' },
      create_time: '2026-03-19T08:00:00.000Z'
    },
    {
      _id: 'explicit-expiry',
      unique_code: 'L000001',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 5, unit: 'kg' },
      expiry_date: '2026-04-01T00:00:00.000Z',
      create_time: '2026-03-21T08:00:00.000Z'
    }
  ]);

  assert.deepEqual(
    sorted.map(item => item._id),
    ['explicit-expiry', 'missing-expiry', 'long-term']
  );
});

test('allocation helper sorts by FEFO first and uses create_time plus label code as stable tie breakers', () => {
  const candidates = [
    {
      _id: 'b',
      unique_code: 'L000002',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 3, unit: 'kg' },
      expiry_date: '2026-04-05T00:00:00.000Z',
      create_time: '2026-03-20T08:00:00.000Z'
    },
    {
      _id: 'a',
      unique_code: 'L000001',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 3, unit: 'kg' },
      expiry_date: '2026-04-05T00:00:00.000Z',
      create_time: '2026-03-20T08:00:00.000Z'
    },
    {
      _id: 'earlier-create',
      unique_code: 'L000003',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 3, unit: 'kg' },
      expiry_date: '2026-04-05T00:00:00.000Z',
      create_time: '2026-03-19T08:00:00.000Z'
    },
    {
      _id: 'earliest-expiry',
      unique_code: 'L000004',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 3, unit: 'kg' },
      expiry_date: '2026-04-01T00:00:00.000Z',
      create_time: '2026-03-21T08:00:00.000Z'
    }
  ];

  assert.equal(pickPreferredAllocationItem(candidates)._id, 'earliest-expiry');
  assert.deepEqual(
    sortInventoryAllocationCandidates(candidates).map(item => item._id),
    ['earliest-expiry', 'earlier-create', 'a', 'b']
  );
  assert.ok(compareInventoryAllocationOrder(candidates[0], candidates[1]) > 0);
});

test('allocation helper filters non-in-stock and zero-stock items using category-aware stock fields', () => {
  const sorted = sortInventoryAllocationCandidates([
    {
      _id: 'used',
      unique_code: 'L000010',
      status: 'used',
      category: 'chemical',
      quantity: { val: 10, unit: 'kg' },
      expiry_date: '2026-04-02T00:00:00.000Z'
    },
    {
      _id: 'zero-chemical',
      unique_code: 'L000011',
      status: 'in_stock',
      category: 'chemical',
      quantity: { val: 0, unit: 'kg' },
      expiry_date: '2026-04-02T00:00:00.000Z'
    },
    {
      _id: 'zero-film',
      unique_code: 'L000012',
      status: 'in_stock',
      category: 'film',
      quantity: { val: 10, unit: 'm²' },
      dynamic_attrs: { current_length_m: 0 },
      expiry_date: '2026-04-02T00:00:00.000Z'
    },
    {
      _id: 'usable-film',
      unique_code: 'L000013',
      status: 'in_stock',
      category: 'film',
      quantity: { val: 10, unit: 'm²' },
      dynamic_attrs: { current_length_m: 12.5 },
      expiry_date: '2026-04-03T00:00:00.000Z'
    }
  ]);

  assert.equal(getAvailableAllocationStock(sorted[0]), 12.5);
  assert.deepEqual(sorted.map(item => item._id), ['usable-film']);
});

test('allocation helper builds a stable FEFO recommendation with the first batch and label', () => {
  const recommendation = buildInventoryAllocationRecommendation([
    {
      _id: 'later-batch',
      unique_code: 'L000202',
      batch_number: 'PET2601',
      status: 'in_stock',
      category: 'film',
      quantity: { val: 80, unit: 'm' },
      dynamic_attrs: { current_length_m: 80 },
      expiry_date: '2026-04-05T00:00:00.000Z',
      create_time: '2026-03-20T08:00:00.000Z'
    },
    {
      _id: 'earliest-batch',
      unique_code: 'L000203',
      batch_number: 'PET2512',
      status: 'in_stock',
      category: 'film',
      quantity: { val: 40, unit: 'm' },
      dynamic_attrs: { current_length_m: 40 },
      expiry_date: '2026-04-01T00:00:00.000Z',
      create_time: '2026-03-21T08:00:00.000Z'
    }
  ]);

  assert.deepEqual(recommendation, {
    recommendedCode: 'L000203',
    recommendedBatchNumber: 'PET2512'
  });
});
