const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBatchEntryTab,
  resolveBatchEntryTitle,
  assertBatchEntryMaterialCategory,
  buildSelectedMaterialSummary,
  buildBatchListItem,
  buildBatchSubmitItems,
  MAX_BATCH_ENTRY_ITEMS,
  assertBatchEntryItemLimit,
  findDuplicateBatchUniqueCode,
  buildBatchEmptyState
} = require('../miniprogram/utils/batch-entry');
const fs = require('node:fs');
const path = require('node:path');

test('batch entry inherits current add-page tab and defaults invalid input to chemical', () => {
  assert.equal(resolveBatchEntryTab('chemical'), 'chemical');
  assert.equal(resolveBatchEntryTab('film'), 'film');
  assert.equal(resolveBatchEntryTab('unknown'), 'chemical');
  assert.equal(resolveBatchEntryTab(''), 'chemical');
  assert.equal(resolveBatchEntryTitle('chemical'), '化材批量入库');
  assert.equal(resolveBatchEntryTitle('film'), '膜材批量入库');
  assert.equal(resolveBatchEntryTitle('unknown'), '化材批量入库');
});

test('batch entry page enforces a 100-row submit limit before cloud submit', () => {
  assert.equal(MAX_BATCH_ENTRY_ITEMS, 100);
  assert.doesNotThrow(() => assertBatchEntryItemLimit(100));
  assert.throws(() => assertBatchEntryItemLimit(101), /单次最多批量入库 100 条/);

  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.js'),
    'utf8'
  );
  assert.match(pageJs, /assertBatchEntryItemLimit\(this\.data\.list\.length\)/);
  assert.match(pageJs, /runChunkedBatchTask/);
  assert.match(pageJs, /name:\s*'batchAddInventory'/);
});

test('batch entry rejects scanned materials from the wrong category', () => {
  assert.deepEqual(assertBatchEntryMaterialCategory('chemical', { category: 'chemical' }), { ok: true });
  assert.deepEqual(assertBatchEntryMaterialCategory('film', { category: 'film' }), { ok: true });
  assert.deepEqual(assertBatchEntryMaterialCategory('chemical', { category: 'film' }), {
    ok: false,
    msg: '当前批量页仅支持化材物料，请从对应页签进入'
  });
  assert.deepEqual(assertBatchEntryMaterialCategory('film', { category: 'chemical' }), {
    ok: false,
    msg: '当前批量页仅支持膜材物料，请从对应页签进入'
  });
});

test('new scanned items inherit batch defaults using zone plus detail format', () => {
  const item = buildBatchListItem({
    _id: 'mat-1',
    material_name: '丙酮',
    product_code: 'J-001',
    category: 'chemical',
    sub_category: '溶剂',
    default_unit: 'kg'
  }, 'L000001', {
    defaultBatchNo: 'B-001',
    defaultExpiry: '2026-06-30',
    defaultLocationZoneKey: 'builtin:chemical:safe-cabinet-01',
    defaultLocationZoneName: '防爆柜01',
    defaultLocationZone: '防爆柜01',
    defaultLocationDetail: 'A-01'
  });

  assert.equal(item.batch_number, 'B-001');
  assert.equal(item.expiry_date, '2026-06-30');
  assert.equal(item.zone_key, 'builtin:chemical:safe-cabinet-01');
  assert.equal(item.location_zone, '防爆柜01');
  assert.equal(item.location_detail, 'A-01');
  assert.equal(item.location, '防爆柜01 | A-01');
  assert.equal(item.unique_code, 'L000001');
});

test('new scanned items can inherit explicit long-term validity defaults', () => {
  const item = buildBatchListItem({
    _id: 'mat-2',
    material_name: 'PET保护膜',
    product_code: 'M-001',
    category: 'film',
    sub_category: '保护膜',
    default_unit: 'm'
  }, 'L000002', {
    defaultBatchNo: 'F-001',
    defaultIsLongTermValid: true,
    defaultLocationZoneKey: 'builtin:film:warehouse1',
    defaultLocationZoneName: '成品仓1',
    defaultLocationZone: '成品仓1'
  });

  assert.equal(item.is_long_term_valid, true);
  assert.equal(item.expiry_date, '');
  assert.equal(item.expiry_date_str, '长期有效');
});

test('batch entry detects duplicate scanned label codes before submit', () => {
  assert.equal(findDuplicateBatchUniqueCode([
    { unique_code: 'L000001' },
    { unique_code: 'L000002' }
  ], 'L000002'), true);
  assert.equal(findDuplicateBatchUniqueCode([
    { unique_code: 'L000001' }
  ], 'L000003'), false);
});

test('batch entry empty-state copy changes with whether a material template is selected', () => {
  assert.equal(buildBatchEmptyState(false), '可扫描预生成标签，或先选择产品代码');
  assert.equal(buildBatchEmptyState(true), '暂无条目，请开始连续扫描标签');
});

test('film material summaries surface missing governed specs for first-batch completion instead of hard-failing immediately', () => {
  const summary = buildSelectedMaterialSummary({
    _id: 'mat-film-1',
    product_code: 'M-001',
    material_name: 'PET保护膜',
    category: 'film',
    sub_category: '保护膜',
    default_unit: 'm²',
    specs: {}
  });

  assert.equal(summary.productCode, 'M-001');
  assert.equal(summary.requiresFilmSpecCompletion, true);
  assert.deepEqual(summary.missingFilmSpecFields, ['thickness_um', 'standard_width_mm']);
  assert.equal(summary.specStatusText, '待补厚度与默认幅宽');
  assert.equal(summary.thicknessLocked, false);
});

test('film material summaries keep master thickness locked while still prompting for missing default width', () => {
  const summary = buildSelectedMaterialSummary({
    _id: 'mat-film-1',
    product_code: 'M-003',
    material_name: 'PET离型膜',
    category: 'film',
    sub_category: '离型膜',
    default_unit: 'm²',
    specs: {
      thickness_um: 50
    }
  });

  assert.equal(summary.requiresFilmSpecCompletion, true);
  assert.deepEqual(summary.missingFilmSpecFields, ['standard_width_mm']);
  assert.equal(summary.specStatusText, '厚度已锁定，待补默认幅宽');
  assert.equal(summary.thicknessLocked, true);
  assert.equal(summary.thicknessUm, '50');
});

test('film material summaries mark governed specs as ready once master data is complete', () => {
  const summary = buildSelectedMaterialSummary({
    _id: 'mat-film-2',
    product_code: 'M-002',
    material_name: 'BOPP离型膜',
    category: 'film',
    sub_category: '离型膜',
    default_unit: 'm',
    specs: {
      thickness_um: 38,
      standard_width_mm: 1280
    }
  });

  assert.equal(summary.requiresFilmSpecCompletion, false);
  assert.deepEqual(summary.missingFilmSpecFields, []);
  assert.equal(summary.specStatusText, '主数据完整，本批次可单独调整实际幅宽');
  assert.equal(summary.thicknessLocked, true);
  assert.equal(summary.thicknessUm, '38');
  assert.equal(summary.standardWidthMm, '1280');
});

test('batch submit payload composes zone-only and zone-detail locations consistently', () => {
  const items = buildBatchSubmitItems([
    {
      unique: 'tmp-1',
      unique_code: 'C-001',
      batch_number: '',
      expiry_date: '',
      location: '',
      zone_key: '',
      location_zone: '',
      location_detail: '',
      quantity: { val: 1, unit: 'kg' }
    },
    {
      unique: 'tmp-2',
      unique_code: 'C-002',
      batch_number: 'B-SELF',
      expiry_date: '2026-07-01',
      location: '',
      zone_key: 'builtin:chemical:safe-cabinet-04',
      location_zone: '防爆柜04',
      location_detail: '',
      quantity: { val: 1, unit: 'kg' }
    }
  ], {
    defaultBatchNo: 'B-DEFAULT',
    defaultExpiry: '2026-06-30',
    defaultLocationZoneKey: 'builtin:chemical:safe-cabinet-02',
    defaultLocationZoneName: '防爆柜02',
    defaultLocationZone: '防爆柜02',
    defaultLocationDetail: 'B-03'
  });

  assert.equal(items[0].location, '防爆柜02 | B-03');
  assert.equal(items[0].zone_key, 'builtin:chemical:safe-cabinet-02');
  assert.equal(items[0].location_detail, 'B-03');
  assert.equal(items[0].batch_number, 'B-DEFAULT');
  assert.match(items[0].expiry_date, /^2026-06-30T/);
  assert.equal(items[0].unique, undefined);

  assert.equal(items[1].location, '防爆柜04');
  assert.equal(items[1].zone_key, 'builtin:chemical:safe-cabinet-04');
  assert.equal(items[1].batch_number, 'B-SELF');
  assert.match(items[1].expiry_date, /^2026-07-01T/);
});

test('batch submit payload keeps managed location detail key from defaults', () => {
  const items = buildBatchSubmitItems([
    {
      unique_code: 'L000001',
      material_id: 'mat-1',
      product_code: 'J-000001'
    }
  ], {
    defaultLocationZoneKey: 'builtin:chemical:safe-cabinet-01',
    defaultLocationZoneName: '防爆柜01',
    defaultLocationDetailKey: 'builtin:chemical:safe-cabinet-01:F1',
    defaultLocationDetail: 'F1',
    defaultBatchNo: 'B-01',
    defaultIsLongTermValid: true
  });

  assert.equal(items[0].location_detail_key, 'builtin:chemical:safe-cabinet-01:F1');
  assert.equal(items[0].location_detail, 'F1');
  assert.equal(items[0].location, '防爆柜01 | F1');
});

test('batch submit payload preserves refill metadata for pending refill rows', () => {
  const items = buildBatchSubmitItems([
    {
      unique: 'tmp-3',
      unique_code: 'L000601',
      batch_number: 'AC240601',
      expiry_date: '2026-07-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_zone: '防爆柜01',
      location_detail: 'A-01',
      location: '防爆柜01 | A-01',
      quantity: { val: 2, unit: 'kg' },
      submit_action: 'refill',
      refill_inventory_id: 'inv-refill'
    }
  ], {
    defaultLocationZoneKey: 'builtin:chemical:safe-cabinet-02',
    defaultLocationZoneName: '防爆柜02',
    defaultLocationZone: '防爆柜02'
  });

  assert.equal(items[0].submit_action, 'refill');
  assert.equal(items[0].refill_inventory_id, 'inv-refill');
});

test('batch submit payload preserves preprint label metadata for generated labels', () => {
  const items = buildBatchSubmitItems([
    {
      material_id: 'mat-1',
      material_name: '测试料-化材',
      product_code: 'J-999',
      category: 'chemical',
      unique_code: 'L000888',
      preprint_label_id: 'preprint-1',
      supplier_model: 'TEST-X',
      sample_note: '小样',
      quantity: { val: 1, unit: 'kg' },
      batch_number: 'B001',
      zone_key: 'zone-1',
      location_zone: '防爆柜01'
    }
  ], {
    defaultBatchNo: 'B001',
    defaultIsLongTermValid: true,
    defaultLocationZoneKey: 'zone-1',
    defaultLocationZone: '防爆柜01'
  });

  assert.equal(items[0].preprint_label_id, 'preprint-1');
  assert.equal(items[0].supplier_model, 'TEST-X');
  assert.equal(items[0].sample_note, '小样');
});

test('batch entry page allows preprinted labels to select the material before scanning labels', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.js'),
    'utf8'
  );
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.wxml'),
    'utf8'
  );

  assert.match(pageJs, /非预生成标签请先选择产品代码/);
  assert.match(pageJs, /applyPreprintMaterialSelection/);
  assert.doesNotMatch(pageJs, /generateUniqueCode/);
  assert.match(pageJs, /Dialog\.alert/);
  assert.match(pageWxml, /当前物料/);
  assert.match(pageWxml, /标签编号/);
  assert.doesNotMatch(pageWxml, /disabled="\{\{ !selectedMaterial/);
  assert.match(pageWxml, /规格确认/);
  assert.match(pageWxml, /主数据厚度\(μm\)/);
  assert.match(pageWxml, /主数据默认幅宽/);
  assert.match(pageWxml, /本批次实际幅宽\(mm\)/);
  assert.match(pageWxml, /确认本批次幅宽|保存并开始本批次/);
  assert.match(pageWxml, /选择测试料原厂型号/);
  assert.match(pageWxml, /placeholder="当前测试料：原厂型号\/物料名等"/);
  assert.match(pageWxml, /custom-class="search-compact"/);
  assert.match(pageWxml, /filteredTestMaterialIdentityActions/);
  assert.match(pageJs, /searchTestMaterialIdentitySelectorPage/);
  assert.match(pageJs, /TEST_MATERIAL_IDENTITY_SELECTOR_PAGE_SIZE/);
  assert.match(pageJs, /onTestMaterialIdentityReachBottom/);
  assert.match(pageWxml, /bindscrolltolower="onTestMaterialIdentityReachBottom"/);
  assert.match(pageJs, /const isCurrentMaterial = \(\) =>/);
  assert.match(pageJs, /currentMaterial\.product_code === material\.product_code/);
  assert.doesNotMatch(pageJs, /pageSize:\s*100/);
  assert.match(pageJs, /待补料/);
  assert.match(pageJs, /本次将新增/);
  assert.match(pageWxml, /待补料/);
  assert.doesNotMatch(pageWxml, /van-field[\s\S]*class="product-code-field/);
});

test('batch entry confirms first film specs locally and never writes master data before submit', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.js'),
    'utf8'
  );
  const manageMaterial = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/manageMaterial/index.js'),
    'utf8'
  );

  assert.doesNotMatch(pageJs, /completeFilmSpecsFromInbound/);
  assert.doesNotMatch(pageJs, /保存规格中/);
  assert.doesNotMatch(manageMaterial, /completeFilmSpecsFromInbound/);
  assert.match(pageJs, /已确认本批次规格/);
});
