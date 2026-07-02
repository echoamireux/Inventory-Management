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

test('home scan checks preprinted labels before falling back to manual stock-in', () => {
  const pageJs = read('miniprogram/pages/index/index.js');
  const handleScanMatch = pageJs.match(/async handleScanResult\(code\) \{[\s\S]*?\n  \},\n\n  onAmountInput/);

  assert.ok(handleScanMatch, 'home scan handler should be present');
  assert.match(handleScanMatch[0], /name:\s*'exportLabelData'/);
  assert.match(handleScanMatch[0], /action:\s*'getPreprintLabel'/);
  assert.match(handleScanMatch[0], /预生成标签/);
  assert.match(handleScanMatch[0], /未识别预生成标签，请手动填写物料信息/);
});

test('single stock-in page applies preprinted label snapshots when opened with a scanned id', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');
  const onLoadMatch = pageJs.match(/onLoad\(options\) \{[\s\S]*?\n  \},\n\n  onShow/);

  assert.ok(onLoadMatch, 'onLoad block should be present');
  assert.match(pageJs, /async initializeScannedLabelCode/);
  assert.match(onLoadMatch[0], /routeLabelCode\s*=\s*normalizedLabelCode/);
  assert.match(onLoadMatch[0], /initializeScannedLabelCode\(routeLabelCode/);
  assert.match(pageJs, /await this\.loadPreprintLabel\(normalizedLabelCode\)/);
  assert.match(pageJs, /await this\.applyPreprintLabel\(preprintLabel\)/);
  assert.match(pageJs, /未识别预生成标签，请手动填写物料信息/);
});

test('single stock-in page applies preprinted label snapshots after manual label entry', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');
  const blurMatch = pageJs.match(/async onLabelCodeBlur\(\) \{[\s\S]*?\n  \},\n\n  async checkDuplicateLabelCode/);

  assert.ok(blurMatch, 'onLabelCodeBlur block should be present');
  assert.match(blurMatch[0], /await this\.checkDuplicateLabelCode\(normalizedLabelCode/);
  assert.match(blurMatch[0], /await this\.loadPreprintLabel\(normalizedLabelCode\)/);
  assert.match(blurMatch[0], /await this\.applyPreprintLabel\(preprintLabel\)/);
  assert.match(blurMatch[0], /未识别预生成标签，请手动填写物料信息/);
  assert.match(blurMatch[0], /预生成标签不可用/);
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

test('batch stock-in page can use the first preprinted label to select the material', () => {
  const pageJs = read('miniprogram/pages/material-add/batch-entry.js');
  const pageWxml = read('miniprogram/pages/material-add/batch-entry.wxml');
  const onScanBlock = pageJs.match(/async onScan\(\) \{[\s\S]*?wx\.scanCode/);
  const handleScanMatch = pageJs.match(/async handleScanResult\(code\) \{[\s\S]*?\n  \},\n\n  addItemToList/);

  assert.ok(onScanBlock, 'onScan block should be present');
  assert.ok(handleScanMatch, 'handleScanResult block should be present');
  assert.doesNotMatch(onScanBlock[0], /请先选择产品代码/);
  assert.doesNotMatch(pageWxml, /disabled="\{\{ !selectedMaterial/);
  assert.match(pageJs, /applyPreprintMaterialSelection/);
  assert.match(handleScanMatch[0], /await this\.loadPreprintLabel\(uniqueCode\)/);
  assert.match(handleScanMatch[0], /非预生成标签请先选择产品代码/);
});

test('batch stock-in page rejects mixed preprinted test-material identities in one batch', () => {
  const pageJs = read('miniprogram/pages/material-add/batch-entry.js');

  assert.match(pageJs, /validateBatchIdentityConsistency/);
  assert.match(pageJs, /不同测试料原厂型号请另开一批/);
  assert.match(pageJs, /不同膜材规格请另开一批/);
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

test('stock-in cloud functions reject source fields that conflict with preprinted label snapshots', () => {
  const addMaterialCf = read('cloudfunctions/addMaterial/index.js');
  const batchAddCf = read('cloudfunctions/batchAddInventory/index.js');

  assert.match(addMaterialCf, /预生成标签原厂型号与当前入库信息不一致/);
  assert.match(batchAddCf, /预生成标签原厂型号与当前入库信息不一致/);
});
