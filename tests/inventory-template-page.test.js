const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('app routes and material add page expose a page-level inventory template import entry', () => {
  const appJson = read('miniprogram/app.json');
  const materialAddJs = read('miniprogram/pages/material-add/index.js');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');
  const materialAddWxss = read('miniprogram/pages/material-add/index.wxss');

  assert.match(appJson, /"pages\/material-add\/template-import\/index"/);
  assert.match(materialAddJs, /goToTemplateImport/);
  assert.match(materialAddJs, /\/pages\/material-add\/template-import\/index/);

  assert.match(materialAddWxml, /模板导入入库/);
  assert.match(materialAddWxml, /化材 \/ 膜材通用/);
  assert.match(materialAddWxml, /bind:tap="goToTemplateImport"/);
  assert.match(materialAddWxml, /template-entry-card/);
  assert.match(materialAddWxss, /\.template-entry-card/);
  assert.match(materialAddWxss, /\.template-entry-card__badge/);
});

test('inventory template import page only accepts xlsx uploads and keeps preview-submit workflow', () => {
  const pageJs = read('miniprogram/pages/material-add/template-import/index.js');
  const pageWxml = read('miniprogram/pages/material-add/template-import/index.wxml');
  const pageJson = read('miniprogram/pages/material-add/template-import/index.json');

  assert.match(pageJson, /"navigationBarTitleText":\s*"模板导入入库"/);

  assert.match(pageJs, /status\s*!==\s*'active'/);
  assert.match(pageJs, /仅已激活用户可访问/);
  assert.match(pageJs, /name:\s*'exportInventoryTemplate'/);
  assert.match(pageJs, /name:\s*'importInventoryTemplate'/);
  assert.match(pageJs, /action:\s*'preview'/);
  assert.match(pageJs, /action:\s*'submit'/);
  assert.match(pageJs, /extension:\s*\['xlsx'\]/);
  assert.match(pageJs, /normalizeInventoryTemplatePreviewResult/);
  assert.match(pageJs, /normalizeInventoryTemplateSubmitResult/);
  assert.match(pageJs, /parseImportTemplateFileBuffer/);
  assert.match(pageJs, /resolveImportTemplateErrorMessage/);
  assert.match(pageJs, /sheetName:\s*'库存入库表'/);
  assert.match(pageJs, /validCount/);
  assert.match(pageJs, /warningCount/);
  assert.match(pageJs, /errorCount/);
  assert.match(pageJs, /refillCount/);
  assert.match(pageJs, /submit_action === 'refill'/);
  assert.doesNotMatch(pageJs, /未找到有效数据/);
  assert.doesNotMatch(pageJs, /另存为 CSV/);
  assert.doesNotMatch(pageJs, /兼容旧流程/);

  assert.match(pageWxml, /最新模板（\.xlsx）/);
  assert.match(pageWxml, /按模板填写后/);
  assert.match(pageWxml, /直接上传 \.xlsx/);
  assert.match(pageWxml, /选择填写完成的 \.xlsx 文件预览并导入/);
  assert.match(pageWxml, /标签编号/);
  assert.match(pageWxml, /物料名称/);
  assert.match(pageWxml, /子类别/);
  assert.match(pageWxml, /批号/);
  assert.match(pageWxml, /库位/);
  assert.match(pageWxml, /数量摘要/);
  assert.match(pageWxml, /待补料/);
  assert.match(pageWxml, /确认入库/);
  assert.doesNotMatch(pageWxml, /<scroll-view[^>]*class="preview-list"/);
  assert.doesNotMatch(pageWxml, /\.csv/);
});

test('material import page only accepts xlsx uploads while preserving local preview validation', () => {
  const pageJs = read('miniprogram/pages/admin/material-import/index.js');
  const pageWxml = read('miniprogram/pages/admin/material-import/index.wxml');

  assert.match(pageJs, /parseImportTemplateFileBuffer/);
  assert.match(pageJs, /resolveImportTemplateErrorMessage/);
  assert.match(pageJs, /extension:\s*\['xlsx'\]/);
  assert.match(pageJs, /sheetName:\s*'物料导入表'/);
  assert.match(pageJs, /validateImportRow/);
  assert.match(pageJs, /applyImportDuplicateGuards/);
  assert.match(pageJs, /decorateImportPreviewRows/);
  assert.match(pageJs, /manageMaterial/);
  assert.match(pageJs, /batchCreate/);
  assert.doesNotMatch(pageJs, /请使用 CSV 格式文件/);
  assert.doesNotMatch(pageJs, /Toast\.fail\('文件解析失败'\)/);
  assert.doesNotMatch(pageJs, /另存为 CSV/);
  assert.doesNotMatch(pageJs, /兼容旧流程/);

  assert.match(pageWxml, /填写完成后/);
  assert.match(pageWxml, /直接上传 \.xlsx/);
  assert.match(pageWxml, /选择编辑好的 \.xlsx 文件导入/);
  assert.match(pageWxml, /确认导入/);
  assert.doesNotMatch(pageWxml, /\.csv/);
});

test('material add pages expose an explicit future max date so template import and manual entry stay aligned', () => {
  const materialAddJs = read('miniprogram/pages/material-add/index.js');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');
  const batchEntryJs = read('miniprogram/pages/material-add/batch-entry.js');
  const batchEntryWxml = read('miniprogram/pages/material-add/batch-entry.wxml');

  assert.match(materialAddJs, /maxDate:/);
  assert.match(materialAddWxml, /max-date="{{ maxDate }}"/);
  assert.match(batchEntryJs, /maxDate:/);
  assert.match(batchEntryWxml, /max-date="{{ maxDate }}"/);
});

test('inventory template cloud functions separate export and import responsibilities for active users', () => {
  const exportFile = read('cloudfunctions/exportInventoryTemplate/index.js');
  const importFile = read('cloudfunctions/importInventoryTemplate/index.js');
  const importHelperFile = read('cloudfunctions/importInventoryTemplate/inventory-import.js');

  assert.match(exportFile, /assertActiveUserAccess/);
  assert.match(exportFile, /仅已激活用户可导出最新库存入库模板/);
  assert.match(exportFile, /buildInventoryTemplateWorkbook/);

  assert.match(importFile, /assertActiveUserAccess/);
  assert.match(importFile, /仅已激活用户可执行模板导入入库/);
  assert.match(importFile, /action/);
  assert.match(importFile, /preview/);
  assert.match(importFile, /submit/);
  assert.match(importFile, /runTransaction/);
  assert.match(importHelperFile, /未检测到数据行，请从第 4 行开始填写后直接上传 \.xlsx 文件/);
});
