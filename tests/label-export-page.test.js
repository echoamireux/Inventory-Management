const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('app routes and home shortcuts expose label printing to all active users', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');

  assert.match(appJson, /"pages\/admin\/label-export\/index"/);
  assert.match(
    homeWxml,
    /<van-cell title="标签打印" icon="description" is-link url="\/pages\/admin\/label-export\/index"\s*\/>/
  );
});

test('label print page exposes preprint and reprint tabs with template controls', () => {
  const pageJs = read('miniprogram/pages/admin/label-export/index.js');
  const pageWxml = read('miniprogram/pages/admin/label-export/index.wxml');
  const pageJson = read('miniprogram/pages/admin/label-export/index.json');
  const pageWxss = read('miniprogram/pages/admin/label-export/index.wxss');

  assert.match(pageJson, /"enablePullDownRefresh":\s*true/);

  assert.match(pageJs, /mode:\s*'preprint'/);
  assert.match(pageJs, /onModeChange/);
  assert.match(pageJs, /onCreatePreprintJob/);
  assert.match(pageJs, /onExportPreprintJob/);
  assert.match(pageJs, /onVoidPreprintLabels/);
  assert.match(pageJs, /templateType:/);
  assert.match(pageJs, /selectedIds:/);
  assert.match(pageJs, /requestId:/);
  assert.match(pageJs, /thickness_um:/);
  assert.match(pageJs, /width_mm:/);
  assert.match(pageJs, /onTemplateChange/);
  assert.match(pageJs, /toggleSelectItem/);
  assert.match(pageJs, /onExportSelected/);
  assert.match(pageJs, /name:\s*'exportLabelData'/);
  assert.match(pageJs, /status\s*!==\s*'active'/);
  assert.match(pageJs, /仅已激活用户可访问/);

  assert.match(pageWxml, /placeholder="标签编号\/产品代码\/物料名称\/批号"/);
  assert.match(pageWxml, /预生成打印标签/);
  assert.match(pageWxml, /补打已入库标签/);
  assert.match(pageWxml, /膜材信息标签/);
  assert.match(pageWxml, /化材标签/);
  assert.doesNotMatch(pageWxml, /化材标准瓶信息标签/);
  assert.doesNotMatch(pageWxml, /化材小瓶信息标签/);
  assert.doesNotMatch(pageWxml, /name="chemical_std"/);
  assert.doesNotMatch(pageWxml, /name="chemical_mini"/);
  assert.match(pageWxml, /本模板将打印字段/);
  assert.match(pageWxml, /标签编号、二维码内容、产品代码、物料名称、子类别、原厂型号、厚度、幅宽/);
  assert.match(pageWxml, /标签编号、二维码内容、产品代码、原厂型号/);
  assert.match(pageWxml, /生产批号\/批次、库位、数量和过期日期在扫码入库或批量入库时填写/);
  assert.match(pageWxml, /可选补充信息/);
  assert.match(pageWxml, /正在查询物料/);
  assert.match(pageWxml, /未找到匹配物料，请确认产品代码\/物料名称\/原厂型号，或先维护物料主数据/);
  assert.match(pageWxml, /查询物料失败，请稍后重试/);
  assert.match(pageWxml, /二维码内容/);
  assert.match(pageWxml, /生成并导出标签 Excel/);
  assert.match(pageWxml, /重新导出本批 Excel/);
  assert.match(pageWxml, /本次生成数量/);
  assert.match(pageWxml, /厚度\(μm\)/);
  assert.match(pageWxml, /本批次实际幅宽\(mm\)/);
  assert.match(pageWxml, /preprintForm\.selectedMaterial\.is_test_material[\s\S]*field-required/);
  assert.match(pageWxml, /readonly="\{\{ !preprintForm\.selectedMaterial\.is_test_material && preprintForm\.filmThicknessLocked \}\}"/);
  assert.match(pageWxml, /readonly="\{\{ !preprintForm\.selectedMaterial\.is_test_material && preprintForm\.filmWidthLocked \}\}"/);
  assert.match(pageWxml, /最近打印批次/);
  assert.match(pageWxml, /恢复查看/);
  assert.match(pageWxml, /作废未入库标签/);
  assert.match(pageJs, /ensurePreprintChangeIntent/);
  assert.match(pageJs, /createAndExportPreprintJob/);
  assert.match(pageJs, /createPreprintJobBeforeExport/);
  assert.doesNotMatch(pageJs, /allowTempFallback:\s*false/);
  assert.match(pageJs, /loadRecentPreprintJobs/);
  assert.match(pageJs, /voidAndRecreate/);
  assert.match(pageJs, /keepAndCreate/);
  assert.match(pageJs, /作废原批.*重新生成/);
  assert.match(pageJs, /保留原批.*再新增/);
  assert.match(pageJs, /总数改为/);
  assert.match(pageJs, /action:\s*'createPreprintJob'/);
  assert.match(pageJs, /await this\.exportPreprintJobById/);
  assert.match(pageWxml, /<view class="field-label">[\s\S]*原厂型号[\s\S]*<text[^>]*preprintForm\.selectedMaterial\.is_test_material[^>]*class="field-required"[^>]*>\*<\/text>/);
  assert.match(pageWxml, /<view class="field-label">[\s\S]*厚度\(μm\)[\s\S]*<text[^>]*templateType === 'film'[^>]*class="field-required"[^>]*>\*<\/text>/);
  assert.match(pageWxml, /<view class="field-label">[\s\S]*本批次实际幅宽\(mm\)[\s\S]*<text[^>]*templateType === 'film'[^>]*class="field-required"[^>]*>\*<\/text>/);
  assert.doesNotMatch(pageWxml, /input-align="right"/);
  assert.match(pageWxml, /selectedIds\.length/);
  assert.match(pageWxml, /bindtap="toggleSelectItem"/);
  assert.match(pageWxml, /bindtap="onExportSelected"/);
  assert.match(pageWxml, /请先勾选需要打印的标签/);
  assert.match(pageWxml, /请按标签编号对应基础二维码标签粘贴/);
  assert.match(pageWxss, /\.inline-refresh-state[\s\S]*justify-content:\s*center/);
  assert.match(pageWxss, /\.inline-refresh-state[\s\S]*align-items:\s*center/);
  assert.match(pageWxss, /\.template-fields-preview/);
  assert.match(pageWxss, /\.material-search-state/);
  assert.match(pageWxss, /\.field-required[\s\S]*color:\s*#ee0a24/);
});

test('label export cloud function separates list and export actions and only allows active users', () => {
  const file = read('cloudfunctions/exportLabelData/index.js');

  assert.match(file, /action/);
  assert.match(file, /case 'list'|if \(action === 'list'\)/);
  assert.match(file, /case 'export'|if \(action === 'export'\)/);
  assert.match(file, /createPreprintJob/);
  assert.match(file, /createAndExportPreprintJob/);
  assert.match(file, /buildPreprintRequestSignature/);
  assert.match(file, /request_signature/);
  assert.match(file, /preprintMode/);
  assert.match(file, /PREPRINT_ORIGINAL_ALREADY_CHANGED/);
  assert.match(file, /原批次状态已变化/);
  assert.match(file, /exportPreprintJob/);
  assert.match(file, /listRecentPreprintJobs/);
  assert.match(file, /voidPreprintLabels/);
  assert.match(file, /assertActiveUserAccess/);
  assert.match(file, /仅已激活用户可导出信息标签/);
  assert.match(file, /runTransaction/);
  assert.match(file, /system_counters/);
  assert.match(file, /templateType/);
  assert.match(file, /selectedIds/);
  assert.match(file, /searchVal/);
  assert.match(file, /qr_content/);
});
