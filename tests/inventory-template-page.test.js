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
  const pageWxss = read('miniprogram/pages/material-add/template-import/index.wxss');
  const pageJson = read('miniprogram/pages/material-add/template-import/index.json');

  assert.match(pageJson, /"navigationBarTitleText":\s*"模板导入入库"/);

  assert.match(pageJs, /status\s*!==\s*'active'/);
  assert.match(pageJs, /仅已激活用户可访问/);
  assert.match(pageJs, /name:\s*'exportInventoryTemplate'/);
  assert.match(pageJs, /name:\s*'importInventoryTemplate'/);
  assert.match(pageJs, /persistBase64File/);
  assert.match(pageJs, /fileContentBase64/);
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

  assert.match(pageWxml, /import-info-card/);
  assert.match(pageWxml, /import-action-list/);
  assert.match(pageWxml, /import-action-card/);
  assert.match(pageWxml, /使用说明/);
  assert.match(pageWxml, /最新模板（\.xlsx）/);
  assert.match(pageWxml, /单次最多导入/);
  assert.match(pageWxml, /100 行/);
  assert.match(pageWxml, /10 行\/批/);
  assert.match(pageWxml, /继续重试未完成批次/);
  assert.match(pageWxml, /每行一个标签编号，未知产品代码不能入库/);
  assert.match(pageWxml, /测试料原厂型号必填/);
  assert.match(pageWxml, /直接上传 \.xlsx/);
  assert.match(pageWxml, /选择填写完成的 \.xlsx 文件预览并分批入库/);
  assert.doesNotMatch(pageWxml, /<view class="px-20">/);
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
  assert.match(pageWxss, /\.import-info-content[\s\S]*padding-left:\s*0/);
  assert.match(pageWxss, /\.import-action-list[\s\S]*gap:\s*12px/);
  assert.match(pageWxss, /\.import-action-card[\s\S]*display:\s*flex/);
  assert.match(pageWxss, /\.import-action-icon[\s\S]*flex:\s*0 0 40px/);
});

test('material import page only accepts xlsx uploads while preserving local preview validation', () => {
  const pageJs = read('miniprogram/pages/admin/material-import/index.js');
  const pageWxml = read('miniprogram/pages/admin/material-import/index.wxml');

  assert.match(pageJs, /parseImportTemplateFileBuffer/);
  assert.match(pageJs, /resolveImportTemplateErrorMessage/);
  assert.match(pageJs, /persistBase64File/);
  assert.match(pageJs, /fileContentBase64/);
  assert.match(pageJs, /extension:\s*\['xlsx'\]/);
  assert.match(pageJs, /sheetName:\s*'物料导入表'/);
  assert.match(pageJs, /\['是否测试料', '类别', '代码前缀', '产品编号', '物料名称'/);
  assert.match(pageJs, /validateImportRow/);
  assert.match(pageJs, /applyImportDuplicateGuards/);
  assert.match(pageJs, /decorateImportPreviewRows/);
  assert.match(pageJs, /manageMaterial/);
  assert.match(pageJs, /batchCreate/);
  assert.match(pageJs, /MAX_IMPORT_ROWS\s*=\s*100/);
  assert.match(pageWxml, /material-import-empty__desc/);
  assert.match(pageWxml, /请导出并上传 \.xlsx 模板（最多100行）/);
  assert.match(pageJs, /单次最多导入 \$\{MAX_IMPORT_ROWS\} 条物料数据/);
  assert.match(pageJs, /测试料请使用已维护代码，填“是否测试料=是”，且原厂型号必填/);
  assert.match(pageJs, /代码前缀\*：必填。请先选择本行类别，再选择该类别可用前缀/);
  assert.match(pageJs, /\['否', '化材', 'J', '001', '异丙醇'/);
  assert.doesNotMatch(pageJs, /'测试料必填'/);
  assert.match(pageJs, /原厂型号：正式物料选填；测试料必填，用于区分同一测试料产品代码下的不同样品/);
  assert.match(pageJs, /选择“是”时，本行会维护测试料型号，产品代码必须是已维护测试料代码/);
  assert.doesNotMatch(pageJs, /选择“是”后入库、出库和标签打印会启用测试料防呆规则/);
  assert.doesNotMatch(pageJs, /供应商、原厂型号：选填/);
  assert.doesNotMatch(pageJs, /请使用 CSV 格式文件/);
  assert.doesNotMatch(pageJs, /Toast\.fail\('文件解析失败'\)/);
  assert.doesNotMatch(pageJs, /另存为 CSV/);
  assert.doesNotMatch(pageJs, /兼容旧流程/);

  assert.match(pageWxml, /填写完成后/);
  assert.match(pageWxml, /单次最多导入/);
  assert.match(pageWxml, /100 行/);
  assert.match(pageWxml, /测试料请使用已维护代码/);
  assert.match(pageWxml, /原厂型号必填/);
  assert.match(pageWxml, /直接上传系统导出的[\s\S]*\.xlsx/);
  assert.match(pageWxml, /选择编辑好的 \.xlsx 文件导入/);
  assert.match(pageWxml, /确认导入/);
  assert.doesNotMatch(pageWxml, /\.csv/);
});

test('material add pages expose explicit historical min and future max dates so template import and manual entry stay aligned', () => {
  const materialAddJs = read('miniprogram/pages/material-add/index.js');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');
  const batchEntryJs = read('miniprogram/pages/material-add/batch-entry.js');
  const batchEntryWxml = read('miniprogram/pages/material-add/batch-entry.wxml');

  assert.match(materialAddJs, /minDate:\s*new Date\(2000, 0, 1\)\.getTime\(\)/);
  assert.match(materialAddWxml, /min-date="{{ minDate }}"/);
  assert.match(materialAddJs, /maxDate:/);
  assert.match(materialAddWxml, /max-date="{{ maxDate }}"/);
  assert.match(batchEntryJs, /minDate:\s*new Date\(2000, 0, 1\)\.getTime\(\)/);
  assert.match(batchEntryWxml, /min-date="{{ minDate }}"/);
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
