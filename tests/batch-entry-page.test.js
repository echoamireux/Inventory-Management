const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBatchEntryTab,
  resolveBatchEntryTitle,
  assertBatchEntryMaterialCategory,
  buildSelectedMaterialSummary,
  buildBatchListItem,
  buildBatchSubmitItems,
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
    defaultLocationZoneKey: 'builtin:chemical:lab1',
    defaultLocationZoneName: '实验室1',
    defaultLocationZone: '实验室1',
    defaultLocationDetail: 'A-01'
  });

  assert.equal(item.batch_number, 'B-001');
  assert.equal(item.expiry_date, '2026-06-30');
  assert.equal(item.zone_key, 'builtin:chemical:lab1');
  assert.equal(item.location_zone, '实验室1');
  assert.equal(item.location_detail, 'A-01');
  assert.equal(item.location, '实验室1 | A-01');
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
  assert.equal(buildBatchEmptyState(false), '请先选择产品代码');
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
      zone_key: 'builtin:chemical:store-room',
      location_zone: '物料间',
      location_detail: '',
      quantity: { val: 1, unit: 'kg' }
    }
  ], {
    defaultBatchNo: 'B-DEFAULT',
    defaultExpiry: '2026-06-30',
    defaultLocationZoneKey: 'builtin:chemical:lab2',
    defaultLocationZoneName: '实验室2',
    defaultLocationZone: '实验室2',
    defaultLocationDetail: 'B-03'
  });

  assert.equal(items[0].location, '实验室2 | B-03');
  assert.equal(items[0].zone_key, 'builtin:chemical:lab2');
  assert.equal(items[0].location_detail, 'B-03');
  assert.equal(items[0].batch_number, 'B-DEFAULT');
  assert.match(items[0].expiry_date, /^2026-06-30T/);
  assert.equal(items[0].unique, undefined);

  assert.equal(items[1].location, '物料间');
  assert.equal(items[1].zone_key, 'builtin:chemical:store-room');
  assert.equal(items[1].batch_number, 'B-SELF');
  assert.match(items[1].expiry_date, /^2026-07-01T/);
});

test('batch submit payload preserves refill metadata for pending refill rows', () => {
  const items = buildBatchSubmitItems([
    {
      unique: 'tmp-3',
      unique_code: 'L000601',
      batch_number: 'AC240601',
      expiry_date: '2026-07-01',
      zone_key: 'builtin:chemical:lab1',
      location_zone: '实验室1',
      location_detail: 'A-01',
      location: '实验室1 | A-01',
      quantity: { val: 2, unit: 'kg' },
      submit_action: 'refill',
      refill_inventory_id: 'inv-refill'
    }
  ], {
    defaultLocationZoneKey: 'builtin:chemical:lab2',
    defaultLocationZoneName: '实验室2',
    defaultLocationZone: '实验室2'
  });

  assert.equal(items[0].submit_action, 'refill');
  assert.equal(items[0].refill_inventory_id, 'inv-refill');
});

test('batch entry page requires a selected material template before scanning labels', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.js'),
    'utf8'
  );
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/batch-entry.wxml'),
    'utf8'
  );

  assert.match(pageJs, /请先选择产品代码/);
  assert.doesNotMatch(pageJs, /generateUniqueCode/);
  assert.match(pageJs, /Dialog\.alert/);
  assert.match(pageWxml, /当前物料/);
  assert.match(pageWxml, /标签编号/);
  assert.match(pageWxml, /规格确认/);
  assert.match(pageWxml, /主数据厚度\(μm\)/);
  assert.match(pageWxml, /主数据默认幅宽/);
  assert.match(pageWxml, /本批次实际幅宽\(mm\)/);
  assert.match(pageWxml, /确认本批次幅宽|保存并开始本批次/);
  assert.match(pageJs, /待补料/);
  assert.match(pageJs, /本次将新增/);
  assert.match(pageWxml, /待补料/);
  assert.doesNotMatch(pageWxml, /van-field[\s\S]*class="product-code-field/);
});
