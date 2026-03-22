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
  assert.match(wxml, /label="默认幅宽\(mm\)"/);
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
  assert.doesNotMatch(file, /shelf_life_days/);
});

test('inventory detail and list pages read master material fields to keep film display units in sync', () => {
  const detailList = read('miniprogram/pages/inventory/detail-list.js');
  const detailPage = read('miniprogram/pages/inventory-detail/index.js');
  const homeIndex = read('miniprogram/pages/index/index.js');
  const withdrawDialog = read('miniprogram/components/withdraw-dialog/index.js');

  assert.match(detailList, /getInventoryQuantityDisplayState/);
  assert.match(detailPage, /getInventoryQuantityDisplayState/);
  assert.match(homeIndex, /getInventoryQuantityDisplayState/);
  assert.match(withdrawDialog, /getInventoryQuantityDisplayState/);
});

test('inventory detail exposes admin-only film width correction entry and keeps it out of the chemical path', () => {
  const detailWxml = read('miniprogram/pages/inventory-detail/index.wxml');
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');

  assert.match(detailWxml, /修正批次幅宽/);
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
