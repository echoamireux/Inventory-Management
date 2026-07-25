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
  assert.match(pageJs, /const DEFAULT_TEMPLATE_TYPE = 'chemical'/);
  assert.match(pageJs, /templateType:\s*DEFAULT_TEMPLATE_TYPE/);
  assert.match(pageJs, /\|\|\s*DEFAULT_TEMPLATE_TYPE/);
  assert.doesNotMatch(pageJs, /templateType:\s*'film'/);
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
  assert.match(pageJson, /"van-popup":\s*"@vant\/weapp\/popup\/index"/);
  assert.match(pageJson, /"van-action-sheet":\s*"@vant\/weapp\/action-sheet\/index"/);

  assert.match(pageWxml, /placeholder="在库标签：标签\/产品代码\/物料名\/原厂型号等"/);
  assert.match(pageWxml, /选择产品代码/);
  assert.match(pageWxml, /preprintCodePrefix/);
  assert.match(pageWxml, /placeholder="请输入1-3位数字编号"/);
  assert.match(pageWxml, /maxlength="3"/);
  assert.match(pageWxml, /bindinput="onPreprintProductCodeInput"/);
  assert.match(pageWxml, /actions="\{\{ preprintCodePrefixOptions \}\}"/);
  assert.match(pageWxml, /预生成打印标签/);
  assert.match(pageWxml, /补打已入库标签/);
  assert.match(pageWxml, /膜材信息标签/);
  assert.match(pageWxml, /化材标签/);
  assert.ok(
    pageWxml.indexOf('化材标签') < pageWxml.indexOf('膜材信息标签'),
    '化材标签应排在膜材信息标签左侧'
  );
  assert.doesNotMatch(pageWxml, /化材标准瓶信息标签/);
  assert.doesNotMatch(pageWxml, /化材小瓶信息标签/);
  assert.doesNotMatch(pageWxml, /name="chemical_std"/);
  assert.doesNotMatch(pageWxml, /name="chemical_mini"/);
  assert.match(pageWxml, /本模板将打印字段/);
  assert.match(pageWxml, /标签编号、二维码内容、产品代码、物料名称、子类别、原厂型号、厚度、幅宽/);
  assert.match(pageWxml, /标签编号、二维码内容、产品代码、物料名称、原厂型号/);
  assert.match(pageWxml, /生产批号\/批次、库位、数量和过期日期在扫码入库或批量入库时填写/);
  assert.match(pageWxml, /本次内部备注/);
  assert.match(pageWxml, /本次打印备注/);
  assert.match(pageWxml, /正在查询物料/);
  assert.match(pageWxml, /未找到 \{\{ preprintCodePrefix \}\}-\{\{ preprintForm\.productCodeNumber \}\} 对应的在用物料，请先维护物料主数据/);
  assert.match(pageWxml, /查询物料失败，请稍后重试/);
  assert.match(pageWxml, /请先输入产品代码/);
  assert.match(
    pageWxml,
    /<block wx:if="\{\{ preprintForm\.selectedMaterial \}\}">[\s\S]*<view class="form-section-title">打印设置<\/view>/
  );
  assert.match(pageJs, /sanitizeProductCodeNumberInput/);
  assert.match(pageJs, /normalizeProductCodeInput/);
  assert.match(pageJs, /findExactProductCodeMatch/);
  assert.match(pageJs, /listProductCodePrefixes/);
  assert.match(pageJs, /lookupPreprintMaterialByCode/);
  assert.doesNotMatch(pageWxml, /data-field="supplier_model"/);
  assert.doesNotMatch(pageWxml, /data-field="supplier"/);
  assert.doesNotMatch(pageWxml, /正式料原厂型号只从物料主数据带出/);
  assert.doesNotMatch(pageWxml, /主数据未维护/);
  assert.match(pageWxml, /选择测试料原厂型号/);
  assert.match(pageWxml, /filteredTestMaterialIdentityActions/);
  assert.match(pageWxml, /placeholder="当前测试料：原厂型号\/物料名等"/);
  assert.match(pageWxml, /item\.supplier_model[\s\S]*原厂型号/);
  assert.match(pageJs, /searchTestMaterialIdentitySelectorPage/);
  assert.match(pageJs, /TEST_MATERIAL_IDENTITY_SELECTOR_PAGE_SIZE/);
  assert.match(pageJs, /onTestMaterialIdentityReachBottom/);
  assert.match(pageWxml, /bindscrolltolower="onTestMaterialIdentityReachBottom"/);
  assert.match(pageJs, /const isCurrentMaterial = \(\) =>/);
  assert.match(pageJs, /currentMaterial\.product_code === material\.product_code/);
  assert.doesNotMatch(pageJs, /pageSize:\s*100/);
  assert.match(pageJs, /supplier:\s*isTestMaterial\s*\?/);
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
  assert.doesNotMatch(pageJs, /createPreprintJobBeforeExport/);
  assert.doesNotMatch(pageJs, /allowTempFallback:\s*false/);
  assert.match(pageJs, /loadRecentPreprintJobs/);
  assert.match(pageJs, /voidAndRecreate/);
  assert.match(pageJs, /keepAndCreate/);
  assert.match(pageJs, /作废原批.*重新生成/);
  assert.match(pageJs, /保留原批.*再新增/);
  assert.match(pageJs, /总数改为/);
  assert.match(pageJs, /action:\s*'createAndExportPreprintJob'/);
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
  assert.match(pageWxss, /\.preprint-selection-empty/);
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
  assert.match(file, /retryable|isRetryable|TRANSACTION/i);
  assert.match(file, /attempt\s*<=\s*3|attempt\s*<\s*3/);
  assert.match(file, /templateType/);
  assert.match(file, /selectedIds/);
  assert.match(file, /searchVal/);
  assert.match(file, /\{\s*supplier_model:\s*searchRegex\s*\}/);
  assert.match(file, /\{\s*supplier_model_key:\s*searchRegex\s*\}/);
  assert.match(file, /supplier_model:\s*String\(item\.supplier_model\s*\|\|\s*material\.supplier_model/);
  assert.match(`${file}\n${read('cloudfunctions/exportLabelData/preprint-labels.js')}`, /qr_content/);
  assert.match(file, /updatePreprintJobExportState/);
  assert.match(file, /async function exportPreprintJob[\s\S]*updatePreprintJobExportState\([^)]*'exported'/);
});

test('preprint page uses backend create-and-export action so exported batches are tracked', () => {
  const pageJs = read('miniprogram/pages/admin/label-export/index.js');

  assert.match(pageJs, /action:\s*'createAndExportPreprintJob'/);
  assert.doesNotMatch(pageJs, /action:\s*'createPreprintJob'/);
});
