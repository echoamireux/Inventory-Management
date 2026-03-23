const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('admin material edit page exposes governed master spec fields for chemical and film materials', () => {
  const wxml = read('miniprogram/pages/admin/material-edit.wxml');
  const js = read('miniprogram/pages/admin/material-edit.js');

  assert.match(wxml, /title="包装形式"/);
  assert.match(wxml, /label="厚度\(μm\)"/);
  assert.match(wxml, /label="厚度\(μm\)"[\s\S]*?label-width="[^"]+"/);
  assert.match(wxml, /label="默认幅宽\(mm\)"/);
  assert.match(wxml, /label="默认幅宽\(mm\)"[\s\S]*?placeholder="请输入默认幅宽"/);
  assert.match(wxml, /label="默认幅宽\(mm\)"[\s\S]*?label-width="[^"]+"/);
  assert.match(wxml, /title="默认单位"/);
  assert.doesNotMatch(wxml, /保质期/);
  assert.doesNotMatch(js, /shelf_life_days/);
  assert.match(js, /showPackageTypePicker/);
  assert.match(js, /packageTypeOptions/);
});

test('admin material edit page supports prefilling category and product code for manager-led direct creation', () => {
  const js = read('miniprogram/pages/admin/material-edit.js');

  assert.match(js, /options\.category/);
  assert.match(js, /options\.product_code/);
  assert.match(js, /initializeCreatePrefill/);
  assert.match(js, /checkDuplicate\(normalizedCode\.product_code\)/);
});

test('manageMaterial cloud function persists package_type and film specs as governed master-data fields', () => {
  const file = read('cloudfunctions/manageMaterial/index.js');

  assert.match(file, /package_type/);
  assert.match(file, /thickness_um/);
  assert.match(file, /standard_width_mm/);
  assert.match(file, /batch_width_mm/);
  assert.match(file, /material_standard_width_mm/);
  assert.match(file, /fields\.specs/);
  assert.match(file, /buildGovernedMaterialMasterFields/);
  assert.match(file, /assertAdminMutationAccess/);
  assert.match(file, /assertActiveUserAccess/);
  assert.doesNotMatch(file, /shelf_life_days/);
});

test('inventory batch, label, and detail layers all keep film display units aligned with master data truth', () => {
  const detailList = read('miniprogram/pages/inventory/detail-list.js');
  const labelsList = read('miniprogram/pages/inventory/labels/index.js');
  const labelQueryUtil = read('miniprogram/utils/inventory-label-query.js');
  const detailPage = read('miniprogram/pages/inventory-detail/index.js');
  const homeIndex = read('miniprogram/pages/index/index.js');
  const withdrawDialog = read('miniprogram/components/withdraw-dialog/index.js');
  const batchCf = read('cloudfunctions/getInventoryBatches/index.js');

  assert.match(detailList, /getInventoryBatches/);
  assert.match(labelsList, /loadBatchLabelPage/);
  assert.match(labelQueryUtil, /getInventoryQuantityDisplayState/);
  assert.match(detailPage, /getInventoryQuantityDisplayState/);
  assert.match(homeIndex, /getInventoryQuantityDisplayState/);
  assert.match(withdrawDialog, /getInventoryQuantityDisplayState/);
  assert.match(batchCf, /summarizeFilmDisplayQuantities/);
  assert.match(batchCf, /default_unit/);
});

test('inventory detail exposes admin-only film width correction entry and keeps it out of the chemical path', () => {
  const detailWxml = read('miniprogram/pages/inventory-detail/index.wxml');
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');
  const editInventoryJs = read('cloudfunctions/editInventory/index.js');

  assert.match(detailWxml, /title="幅宽"/);
  assert.match(detailWxml, /修正幅宽/);
  assert.doesNotMatch(detailWxml, /修正批次幅宽/);
  assert.match(detailJs, /请输入有效的幅宽/);
  assert.match(detailJs, /幅宽已修正/);
  assert.match(editInventoryJs, /请输入有效的幅宽/);
  assert.match(editInventoryJs, /幅宽由 \[/);
  assert.match(detailJs, /canAdjustFilmWidth/);
  assert.match(detailJs, /onShowWidthAdjustPopup/);
  assert.match(detailJs, /onAdjustFilmWidthConfirm/);
});

test('single stock-in page handles film thickness as governed input and fixes square-meter parsing', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');
  const pageWxml = read('miniprogram/pages/material-add/index.wxml');

  assert.match(pageJs, /normalizeFilmUnit/);
  assert.match(pageJs, /thickness_locked/);
  assert.match(pageWxml, /readonly="\{\{ form\.thickness_locked \}\}"/);
  assert.match(pageWxml, /厚度以主数据为准/);
  assert.match(pageWxml, /label="幅宽\(mm\)"/);
  assert.match(pageWxml, /label="默认单位"/);
  assert.doesNotMatch(pageWxml, /label="宽度\(mm\)"/);
  assert.doesNotMatch(pageWxml, /label="计价单位"/);
});

test('material add top action bar uses a centered single-button layout for managers and keeps dual buttons for normal users', () => {
  const pageWxml = read('miniprogram/pages/material-add/index.wxml');
  const pageWxss = read('miniprogram/pages/material-add/index.wxss');

  assert.match(pageWxml, /class="mb-15 top-action-bar \{\{ isManager \? 'top-action-bar--single' : 'top-action-bar--dual' \}\}"/);
  assert.match(pageWxml, /class="top-action-bar__item top-action-bar__item--primary"/);
  assert.match(pageWxml, /wx:if="\{\{ !isManager \}\}" class="top-action-bar__item"/);
  assert.doesNotMatch(pageWxml, /custom-style="flex: 1; \{\{ !isManager \? 'margin-right: 10px;' : '' \}\}"/);

  assert.match(pageWxss, /\.top-action-bar\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--single\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--single \.top-action-bar__item--primary\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--dual \.top-action-bar__item \+ \.top-action-bar__item\s*\{/);
});

test('admin update user status cloud function still gates target roles through the managed-role whitelist', () => {
  const file = read('cloudfunctions/adminUpdateUserStatus/index.js');

  assert.match(file, /assertSuperAdminAccess/);
  assert.match(file, /isAllowedManagedRole\(role\)/);
  assert.match(file, /仅允许设置为 user 或 admin/);
});

test('legacy stock-in-out and material-detail pages are no longer exposed as active app routes', () => {
  const appJson = read('miniprogram/app.json');

  assert.doesNotMatch(appJson, /"pages\/stock-in-out\/index"/);
  assert.doesNotMatch(appJson, /"pages\/material-detail\/index"/);
});

test('legacy stock-in-out and material-detail page files are retired from the active codebase', () => {
  const root = path.join(__dirname, '..');

  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/stock-in-out/index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/stock-in-out/index.wxml')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/material-detail/index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/material-detail/index.wxml')), false);
});

test('updateInventory rejects the retired quick stock-in-out payload explicitly while keeping withdrawal callers on the governed path', () => {
  const file = read('cloudfunctions/updateInventory/index.js');

  assert.match(file, /quantity/);
  assert.match(file, /type/);
  assert.match(file, /旧快捷出入库协议已停用|请使用正式入库流程或库存详情页领用/);
  assert.match(file, /withdraw_amount/);
  assert.match(file, /assertActiveUserAccess/);
  assert.doesNotMatch(file, /transaction\.collection\('inventory'\)\.where/);
  assert.match(file, /transaction\.collection\('inventory'\)\.doc\(/);
});

test('home batch recommendation and batch-mode deduction share one FEFO allocation contract', () => {
  const homeIndex = read('miniprogram/pages/index/index.js');
  const batchCf = read('cloudfunctions/getInventoryBatches/index.js');
  const updateInventory = read('cloudfunctions/updateInventory/index.js');
  const withdrawDialogWxml = read('miniprogram/components/withdraw-dialog/index.wxml');

  assert.match(batchCf, /recommendedCode/);
  assert.match(batchCf, /pickPreferredAllocationItem|sortInventoryAllocationCandidates/);
  assert.match(updateInventory, /sortInventoryAllocationCandidates/);
  assert.match(updateInventory, /status:\s*'in_stock'/);
  assert.match(homeIndex, /batch\.recommendedCode/);
  assert.doesNotMatch(homeIndex, /orderBy\('expiry_date', 'asc'\)/);
  assert.match(withdrawDialogWxml, /效期优先|FEFO/);
});

test('log pages no longer expose delete actions or call destructive log cloud functions', () => {
  const logsJs = read('miniprogram/pages/logs/index.js');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');
  const removeLogJs = read('cloudfunctions/removeLog/index.js');
  const batchRemoveLogJs = read('cloudfunctions/batchRemoveLog/index.js');

  assert.doesNotMatch(logsJs, /removeLog/);
  assert.doesNotMatch(logsJs, /batchRemoveLog/);
  assert.doesNotMatch(logsWxml, /bind:longpress/);
  assert.doesNotMatch(logsWxml, /删除/);

  assert.doesNotMatch(adminLogsJs, /removeLog/);
  assert.doesNotMatch(adminLogsJs, /batchRemoveLog/);
  assert.doesNotMatch(adminLogsWxml, /bind:longpress/);
  assert.doesNotMatch(adminLogsWxml, /删除/);

  assert.match(removeLogJs, /日志删除已停用|不可删除/);
  assert.match(batchRemoveLogJs, /日志删除已停用|不可删除/);
});

test('dashboard stats uses aggregate-first logic instead of scanning the whole inventory table in memory', () => {
  const file = read('cloudfunctions/getDashboardStats/index.js');

  assert.match(file, /aggregate\(/);
  assert.doesNotMatch(file, /while\s*\(true\)/);
  assert.doesNotMatch(file, /calculateDashboardStatsFromItems/);
});

test('search-backed inventory, master-data, and log queries share escaped keyword matching with broadened field coverage', () => {
  const backendSearch = read('cloudfunctions/_shared/search.js');
  const frontendSearch = read('miniprogram/utils/search.js');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const manageMaterialCf = read('cloudfunctions/manageMaterial/index.js');
  const getLogsCf = read('cloudfunctions/getLogs/index.js');
  const exportDataCf = read('cloudfunctions/exportData/index.js');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');

  assert.match(backendSearch, /escapeRegExp/);
  assert.match(frontendSearch, /escapeRegExp/);

  assert.match(groupedCf, /location_text|location/);
  assert.doesNotMatch(groupedCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.match(manageMaterialCf, /supplier_model/);
  assert.match(manageMaterialCf, /package_type/);
  assert.match(manageMaterialCf, /subcategory_key/);
  assert.match(manageMaterialCf, /sub_category/);
  assert.doesNotMatch(manageMaterialCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.match(getLogsCf, /unique_code/);
  assert.match(getLogsCf, /batch_number/);
  assert.match(getLogsCf, /description/);
  assert.match(getLogsCf, /note/);
  assert.doesNotMatch(getLogsCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.doesNotMatch(exportDataCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);
  assert.match(adminLogsJs, /unique_code/);
  assert.match(adminLogsJs, /batch_number/);
  assert.match(adminLogsJs, /description/);
  assert.match(adminLogsJs, /note/);
});
