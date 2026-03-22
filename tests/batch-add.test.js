const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertUniqueCodes,
  buildBatchInventoryPayload
} = require('../cloudfunctions/_shared/batch-add');

test('batch add rejects duplicate unique codes before hitting database', () => {
  assert.throws(() => {
    assertUniqueCodes([
      { unique_code: 'L000001' },
      { unique_code: 'L000001' }
    ]);
  }, /重复标签编号/);
});

test('batch add builds chemical inventory payload with strict required fields', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000002',
    batch_number: 'B-202603',
    location: 'A区 | 1层-01',
    expiry_date: '2026-12-31',
    quantity: {
      val: 12,
      unit: 'kg'
    }
  }, {
    _id: 'mat-1',
    material_name: '丙酮',
    product_code: 'J-001',
    category: 'chemical',
    sub_category: '溶剂'
  }, 0);

  assert.equal(payload.inventoryData.material_name, '丙酮');
  assert.equal(payload.inventoryData.location, 'A区 | 1层-01');
  assert.equal(payload.logData.spec_change_unit, 'kg');
  assert.equal(payload.logData.description, '批量入库');
});

test('batch add supports explicit long-term validity instead of silently accepting empty expiry dates', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000003',
    batch_number: 'B-202604',
    location: 'A区 | 2层-03',
    is_long_term_valid: true,
    quantity: {
      val: 8,
      unit: 'kg'
    }
  }, {
    _id: 'mat-4',
    material_name: '异丙醇',
    product_code: 'J-003',
    category: 'chemical'
  }, 0);

  assert.equal('expiry_date' in payload.inventoryData, false);
  assert.equal(payload.inventoryData.is_long_term_valid, true);
});

test('batch add rejects rows that omit both expiry date and long-term validity', () => {
  assert.throws(() => {
    buildBatchInventoryPayload({
      unique_code: 'L000004',
      batch_number: 'B-202605',
      location: 'A区 | 2层-05',
      quantity: {
        val: 8,
        unit: 'kg'
      }
    }, {
      _id: 'mat-6',
      material_name: '乙酸乙酯',
      product_code: 'J-005',
      category: 'chemical'
    }, 0);
  }, /必须填写过期日期或明确设为长期有效/);
});

test('batch add converts film square meter input back to base meters', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000005',
    batch_number: 'F-202603',
    location: '膜材区 | B-02',
    expiry_date: '2026-12-31',
    quantity: {
      val: 50,
      unit: 'm²'
    }
  }, {
    _id: 'mat-2',
    material_name: 'PET膜',
    product_code: 'M-001',
    category: 'film',
    sub_category: 'PET',
    default_unit: 'm²',
    specs: {
      thickness_um: 25,
      standard_width_mm: 500
    }
  }, 0);

  assert.equal(payload.inventoryData.dynamic_attrs.current_length_m, 100);
  assert.equal(payload.inventoryData.quantity.val, 50);
  assert.equal(payload.inventoryData.quantity.unit, 'm²');
  assert.equal(payload.logData.quantity_change, 100);
  assert.equal(payload.logData.spec_change_unit, 'm');
});

test('batch add allows first film batches to backfill missing governed master specs once and reuse them for the new batch truth', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000010',
    batch_number: 'F-202604',
    location: '膜材区 | B-05',
    expiry_date: '2026-12-31',
    thickness_um: 50,
    batch_width_mm: 1230,
    quantity: {
      val: 123,
      unit: 'm²'
    }
  }, {
    _id: 'mat-7',
    material_name: 'PET保护膜',
    product_code: 'M-010',
    category: 'film',
    sub_category: '保护膜',
    default_unit: 'm²',
    specs: {}
  }, 0);

  assert.equal(payload.inventoryData.dynamic_attrs.thickness_um, 50);
  assert.equal(payload.inventoryData.dynamic_attrs.width_mm, 1230);
  assert.deepEqual(payload.masterSpecBackfill, {
    thickness_um: 50,
    standard_width_mm: 1230
  });
});

test('batch add lets a film batch use a different actual width without overwriting the governed default width', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000011',
    batch_number: 'F-202605',
    location: '膜材区 | B-08',
    expiry_date: '2026-12-31',
    batch_width_mm: 1250,
    quantity: {
      val: 125,
      unit: 'm²'
    }
  }, {
    _id: 'mat-8',
    material_name: 'PET光学膜',
    product_code: 'M-011',
    category: 'film',
    sub_category: '光学膜',
    default_unit: 'm²',
    specs: {
      thickness_um: 38,
      standard_width_mm: 1230
    }
  }, 0);

  assert.equal(payload.inventoryData.dynamic_attrs.thickness_um, 38);
  assert.equal(payload.inventoryData.dynamic_attrs.width_mm, 1250);
  assert.equal(payload.inventoryData.dynamic_attrs.current_length_m, 100);
  assert.equal(payload.logData.quantity_change, 100);
  assert.equal(payload.masterSpecBackfill, undefined);
});

test('batch add fails explicitly when required fields are missing', () => {
  assert.throws(() => {
    buildBatchInventoryPayload({
      unique_code: 'L000006',
      batch_number: 'B-202603',
      quantity: {
        val: 10,
        unit: 'kg'
      }
    }, {
      _id: 'mat-3',
      material_name: '乙醇',
      product_code: 'J-002',
      category: 'chemical'
    }, 1);
  }, /缺少存储区域/);
});

test('batch add still rejects invalid expiry date values', () => {
  assert.throws(() => {
    buildBatchInventoryPayload({
      unique_code: 'L000007',
      batch_number: 'B-202605',
      location: 'A区 | 2层-04',
      expiry_date: 'not-a-date',
      quantity: {
        val: 10,
        unit: 'kg'
      }
    }, {
      _id: 'mat-5',
      material_name: '甲醇',
      product_code: 'J-004',
      category: 'chemical'
    }, 0);
  }, /过期日期格式非法/);
});
