const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_BATCH_INVENTORY_ITEMS,
  assertBatchInventoryItemLimit,
  assertUniqueCodes,
  buildBatchInventoryPayload
} = require('../cloudfunctions/_shared/batch-add');

test('batch add enforces a 100-row submit limit before database work', () => {
  assert.equal(MAX_BATCH_INVENTORY_ITEMS, 100);
  assert.doesNotThrow(() => assertBatchInventoryItemLimit(100));
  assert.throws(() => assertBatchInventoryItemLimit(101), /单次最多批量入库 100 条/);

  const cloudIndex = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../cloudfunctions/batchAddInventory/index.js'),
    'utf8'
  );
  assert.match(cloudIndex, /assertBatchInventoryItemLimit\(items\.length\)/);
});

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

test('batch add requires inventory-level model for test materials and keeps optional notes', () => {
  assert.throws(() => {
    buildBatchInventoryPayload({
      unique_code: 'L000012',
      batch_number: 'TEST-001',
      location: '防爆柜01 | A01',
      expiry_date: '2026-12-31',
      supplier: '供应商A',
      quantity: {
        val: 1,
        unit: 'kg'
      }
    }, {
      _id: 'mat-test',
      material_name: '测试料-化材',
      product_code: 'J-999',
      category: 'chemical',
      default_unit: 'kg',
      is_test_material: true
    }, 0);
  }, /测试料入库必须填写原厂型号和生产批号/);

  const payload = buildBatchInventoryPayload({
    unique_code: 'L000013',
    batch_number: 'TEST-002',
    location: '防爆柜01 | A02',
    expiry_date: '2026-12-31',
    supplier_model: 'SAMPLE-X',
    quantity: {
      val: 1,
      unit: 'kg'
    }
  }, {
    _id: 'mat-test',
    material_name: '测试料-化材',
    product_code: 'J-999',
    category: 'chemical',
    default_unit: 'kg',
    supplier: '主数据供应商',
    supplier_model: 'MASTER',
    is_test_material: true
  }, 0);

  assert.equal(payload.inventoryData.is_test_material, true);
  assert.equal(payload.inventoryData.sample_note, '');
  assert.equal(payload.inventoryData.supplier, '主数据供应商');
  assert.equal(payload.inventoryData.supplier_model, 'SAMPLE-X');
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

test('batch add keeps film base stock in explicit integer meters even when display unit is square meters', () => {
  const payload = buildBatchInventoryPayload({
    unique_code: 'L000005',
    batch_number: 'F-202603',
    location: '膜材区 | B-02',
    expiry_date: '2026-12-31',
    length_m: 100,
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
    length_m: 100,
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

test('batch add rejects expiry dates earlier than today', () => {
  assert.throws(() => {
    buildBatchInventoryPayload({
      unique_code: 'L000008',
      batch_number: 'B-202606',
      location: 'A区 | 2层-06',
      expiry_date: '2026-03-25',
      quantity: {
        val: 10,
        unit: 'kg'
      }
    }, {
      _id: 'mat-9',
      material_name: '甲苯',
      product_code: 'J-006',
      category: 'chemical'
    }, 0);
  }, /过期日期不能早于当天/);
});
