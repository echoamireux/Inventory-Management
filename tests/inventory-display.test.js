const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildGroupedInventoryCardState,
  buildBatchCardState,
  resolveInventoryExpiryDisplay,
  getInventoryQuantityDisplayState,
  getInventorySpecDisplayState
} = require('../miniprogram/utils/inventory-display');

test('grouped inventory card shows subcategory and single-location summary without extra labels', () => {
  const state = buildGroupedInventoryCardState({
    material_name: '化材-1',
    sub_category: '主胶',
    totalCount: 2,
    locations: ['实验室2 | A-01']
  });

  assert.deepEqual(state, {
    materialName: '化材-1',
    subcategoryLabel: '主胶',
    batchCountLabel: '2 批次',
    locationSummary: '实验室2 | A-01'
  });
});

test('grouped inventory card compresses multi-location inventory into a short summary', () => {
  const state = buildGroupedInventoryCardState({
    material_name: '保护膜-1',
    sub_category: '保护膜',
    totalCount: 3,
    locations: ['研发仓1', '研发仓2', '研发仓1']
  });

  assert.equal(state.locationSummary, '多库位');
});

test('batch card exposes explicit batch semantics and keeps subcategory available for display', () => {
  const state = buildBatchCardState({
    batch_number: '20260523',
    material_name: '化材-1',
    sub_category: '主胶',
    expiry: '2026-05-21',
    location: '实验室2 | A-01'
  });

  assert.deepEqual(state, {
    batchLabel: '批号',
    batchValue: '20260523',
    materialName: '化材-1',
    subcategoryLabel: '主胶',
    expiryLabel: '2026-05-21',
    locationLabel: '实验室2 | A-01'
  });
});

test('inventory expiry display distinguishes explicit long-term validity from missing expiry data', () => {
  assert.deepEqual(
    resolveInventoryExpiryDisplay({
      is_long_term_valid: true
    }),
    {
      label: '长期有效',
      hasExpiryDate: false,
      isLongTermValid: true,
      isMissing: false
    }
  );

  assert.deepEqual(
    resolveInventoryExpiryDisplay({}),
    {
      label: '未设置过期日',
      hasExpiryDate: false,
      isLongTermValid: false,
      isMissing: true
    }
  );
});

test('film inventory display follows the latest master default unit while keeping base length truth', () => {
  const state = getInventoryQuantityDisplayState({
    category: 'film',
    quantity: { val: 50, unit: 'm²' },
    dynamic_attrs: {
      current_length_m: 100,
      initial_length_m: 100,
      width_mm: 500
    }
  }, {
    default_unit: 'm'
  });

  assert.equal(state.displayQuantity, 100);
  assert.equal(state.displayUnit, 'm');
  assert.equal(state.baseLengthM, 100);
});

test('chemical inventory display keeps inventory snapshot unit even if master default unit changes later', () => {
  const state = getInventoryQuantityDisplayState({
    category: 'chemical',
    quantity: { val: 12, unit: 'kg' }
  }, {
    default_unit: 'g'
  });

  assert.equal(state.displayQuantity, 12);
  assert.equal(state.displayUnit, 'kg');
});

test('inventory spec display falls back from material specs when film batch snapshot lacks thickness and width', () => {
  const state = getInventorySpecDisplayState({
    category: 'film',
    dynamic_attrs: {
      current_length_m: 200,
      initial_length_m: 300
    }
  }, {
    specs: {
      thickness_um: 25,
      standard_width_mm: 1200
    }
  });

  assert.equal(state.thicknessLabel, '25 μm');
  assert.equal(state.widthLabel, '1200 mm');
  assert.equal(state.initialLengthLabel, '300 m');
  assert.equal(state.packageTypeLabel, '--');
});

test('inventory spec display prefers the latest master thickness over stale batch thickness snapshots', () => {
  const state = getInventorySpecDisplayState({
    category: 'film',
    dynamic_attrs: {
      thickness_um: 20,
      width_mm: 1230,
      initial_length_m: 300
    }
  }, {
    specs: {
      thickness_um: 25,
      standard_width_mm: 1230
    }
  });

  assert.equal(state.thicknessLabel, '25 μm');
  assert.equal(state.widthLabel, '1230 mm');
});

test('film inventory display keeps batch width as the area conversion truth even when master default width changes later', () => {
  const state = getInventoryQuantityDisplayState({
    category: 'film',
    quantity: { val: 246, unit: 'm²' },
    dynamic_attrs: {
      current_length_m: 200,
      initial_length_m: 200,
      width_mm: 1230
    }
  }, {
    default_unit: 'm²',
    specs: {
      standard_width_mm: 1250
    }
  });

  assert.equal(state.displayQuantity, 246);
  assert.equal(state.displayUnit, 'm²');
  assert.equal(state.baseLengthM, 200);
});

test('retired manual stock-in-out page no longer remains in the active mini-program source tree', () => {
  assert.equal(
    fs.existsSync(path.join(__dirname, '../miniprogram/pages/stock-in-out/index.wxml')),
    false
  );
});

test('grouped inventory card renders material name as plain text instead of subtitle pill styling', () => {
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/material-list-item/index.wxml'),
    'utf8'
  );

  assert.match(file, /class="material-name"/);
  assert.match(file, /type="subcategory"/);
  assert.doesNotMatch(file, /type="category"/);
  assert.doesNotMatch(file, /class="material-subtitle-tag">\{\{ display\.materialName \}\}</);
});

test('batch card component supports popup-style totalQuantity data when no quantity object is present', () => {
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/batch-list-item/index.wxml'),
    'utf8'
  );

  assert.match(file, /item\.totalQuantity/);
  assert.match(file, /item\.unit/);
  assert.match(file, /type="subcategory"/);
  assert.doesNotMatch(file, /type="category"/);
  assert.match(file, /class="batch-meta-row"/);
  assert.match(file, /class="batch-meta-group"/);
  assert.match(file, /type="meta" text="有效期"/);
  assert.match(file, /type="meta" text="库位"/);
});

test('batch selection popup keeps context minimal and does not repeat the material name', () => {
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/index/index.wxml'),
    'utf8'
  );

  assert.match(file, /selectedAggItem\.product_code/);
  assert.doesNotMatch(file, /selectedAggItem\.material_name/);
  assert.doesNotMatch(file, /selectedAggItem\.sub_category/);
});

test('home page does not override shared batch card styles locally', () => {
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/index/index.wxss'),
    'utf8'
  );

  assert.doesNotMatch(file, /\.batch-card\s*\{/);
});
