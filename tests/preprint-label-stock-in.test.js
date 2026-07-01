const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('single stock-in page checks preprinted labels after scanning', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');

  assert.match(pageJs, /loadPreprintLabel/);
  assert.match(pageJs, /action:\s*'getPreprintLabel'/);
  assert.match(pageJs, /applyPreprintLabel/);
  assert.match(pageJs, /form\.supplier_model/);
  assert.match(pageJs, /form\.sample_note/);
  assert.match(pageJs, /form\.thickness_um/);
  assert.match(pageJs, /form\.width_mm/);
  assert.match(pageJs, /与预生成标签规格不一致/);
});

test('batch stock-in page validates scanned preprinted labels against the selected material', () => {
  const pageJs = read('miniprogram/pages/material-add/batch-entry.js');
  const utilJs = read('miniprogram/utils/batch-entry.js');

  assert.match(pageJs, /loadPreprintLabel/);
  assert.match(pageJs, /action:\s*'getPreprintLabel'/);
  assert.match(pageJs, /预生成标签不属于当前物料/);
  assert.match(pageJs, /与预生成标签规格不一致/);
  assert.match(utilJs, /supplier_model/);
  assert.match(utilJs, /sample_note/);
});

test('batch film stock-in can scan preprinted labels before manual spec confirmation', () => {
  const pageJs = read('miniprogram/pages/material-add/batch-entry.js');

  const onScanBlock = pageJs.match(/onScan\(\) \{[\s\S]*?wx\.scanCode/);
  assert.ok(onScanBlock, 'onScan block should be present');
  assert.doesNotMatch(onScanBlock[0], /请先确认本批次规格后再连续扫码/);
  assert.match(pageJs, /preprintValidation\.overrides\.batch_width_mm \|\| this\.data\.currentBatchWidthMm/);
});

test('stock-in cloud functions enforce preprinted film spec consistency', () => {
  const addMaterialCf = read('cloudfunctions/addMaterial/index.js');
  const importTemplateCf = read('cloudfunctions/importInventoryTemplate/index.js');

  assert.match(addMaterialCf, /与预生成标签规格不一致/);
  assert.match(importTemplateCf, /与预生成标签规格不一致/);
});
