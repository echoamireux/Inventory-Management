const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('shared card rows align material name and subcategory tags on the same baseline', () => {
  const groupedCss = read('miniprogram/components/material-list-item/index.wxss');
  const batchCss = read('miniprogram/components/batch-list-item/index.wxss');
  const appCss = read('miniprogram/app.wxss');

  assert.match(groupedCss, /align-items:\s*center/);
  assert.match(batchCss, /align-items:\s*center/);
  assert.match(groupedCss, /\.material-name[\s\S]*min-height:\s*24px/);
  assert.match(batchCss, /\.batch-name[\s\S]*min-height:\s*24px/);
  assert.match(appCss, /\.tag-base[\s\S]*line-height:\s*1\.4/);
  assert.doesNotMatch(appCss, /\.tag-category/);
  assert.match(appCss, /\.tag-subcategory[\s\S]*#F3F4F6/);
});

test('inventory cards keep subcategory chips without enabling a separate category chip', () => {
  const inventoryIndex = read('miniprogram/pages/inventory/index.wxml');
  const homeIndex = read('miniprogram/pages/index/index.wxml');
  const materialItem = read('miniprogram/components/material-list-item/index.wxml');

  assert.match(inventoryIndex, /showCategory="\{\{ false \}\}"/);
  assert.match(homeIndex, /showCategory="\{\{ false \}\}"/);
  assert.match(materialItem, /type="subcategory"/);
});

test('inventory quantities are emphasized as a first-line primary signal', () => {
  const appCss = read('miniprogram/app.wxss');
  const batchCss = read('miniprogram/components/batch-list-item/index.wxss');

  assert.match(appCss, /\.material-qty[\s\S]*font-size:\s*20px/);
  assert.match(batchCss, /\.batch-qty[\s\S]*font-size:\s*20px/);
  assert.match(appCss, /\.material-code[\s\S]*font-size:\s*18px/);
  assert.match(batchCss, /\.batch-code[\s\S]*font-size:\s*18px/);
  assert.match(appCss, /\.material-name[\s\S]*font-size:\s*14px/);
  assert.match(batchCss, /\.batch-name[\s\S]*font-size:\s*14px/);
});

test('batch card keeps subcategory chip adjacent to the material name and uses compact meta pills', () => {
  const batchCss = read('miniprogram/components/batch-list-item/index.wxss');
  const batchWxml = read('miniprogram/components/batch-list-item/index.wxml');
  const appCss = read('miniprogram/app.wxss');
  const batchNameBlock = batchCss.match(/\.batch-name\s*\{[\s\S]*?\}/);

  assert.ok(batchNameBlock);
  assert.doesNotMatch(batchNameBlock[0], /flex:\s*1/);
  assert.match(batchCss, /\.batch-name-row[\s\S]*justify-content:\s*flex-start/);
  assert.match(batchCss, /\.batch-tags-row[\s\S]*flex-wrap:\s*wrap/);
  assert.match(batchWxml, /display\.labelCountLabel/);
  assert.match(batchWxml, /display\.locationSummary/);
  assert.doesNotMatch(batchWxml, /有效期/);
  assert.doesNotMatch(batchWxml, /type="meta"/);
  assert.match(appCss, /\.tag-gray[\s\S]*#F3F4F6/);
});

test('inventory detail list shows a loading state before it ever falls back to empty', () => {
  const wxml = read('miniprogram/pages/inventory/detail-list.wxml');

  assert.match(wxml, /loading && !hasLoadedOnce/);
  assert.match(wxml, /wx:elif="\{\{ hasLoadedOnce \}\}"/);
});

test('inventory index page keeps previous list during refresh and only shows empty after load completes', () => {
  const wxml = read('miniprogram/pages/inventory/index.wxml');
  const js = read('miniprogram/pages/inventory/index.js');

  assert.match(wxml, /loading && !hasLoadedOnce/);
  assert.match(wxml, /wx:elif="\{\{ hasLoadedOnce \}\}"/);
  assert.match(js, /hasLoadedOnce:\s*false/);
  assert.doesNotMatch(js, /setData\(\{\s*loading:\s*true,\s*list:\s*\[\]\s*\}\)/);
});

test('inventory export shows an empty-state toast before calling exportData', () => {
  const js = read('miniprogram/pages/inventory/index.js');
  const emptyToastIndex = js.indexOf("暂无库存可导出");
  const exportCallIndex = js.indexOf("name: 'exportData'");

  assert.notEqual(emptyToastIndex, -1);
  assert.notEqual(exportCallIndex, -1);
  assert.ok(emptyToastIndex < exportCallIndex);
  assert.match(js, /hasLoadedOnce/);
  assert.match(js, /Number\(this\.data\.total\s*\|\|\s*0\)\s*===\s*0/);
  assert.match(js, /\(this\.data\.list\s*\|\|\s*\[\]\)\.length\s*===\s*0/);
});

test('inventory pages support pull-down refresh for manual recovery', () => {
  const detailJson = read('miniprogram/pages/inventory/detail-list.json');
  const indexJson = read('miniprogram/pages/inventory/index.json');

  assert.match(detailJson, /"enablePullDownRefresh":\s*true/);
  assert.match(indexJson, /"enablePullDownRefresh":\s*true/);
});

test('inventory query pages expose explicit pagination state instead of silent truncation', () => {
  const detailJs = read('miniprogram/pages/inventory/detail-list.js');
  const detailWxml = read('miniprogram/pages/inventory/detail-list.wxml');
  const indexJs = read('miniprogram/pages/inventory/index.js');
  const indexWxml = read('miniprogram/pages/inventory/index.wxml');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const appCss = read('miniprogram/app.wxss');

  assert.match(detailJs, /page:\s*1/);
  assert.match(detailJs, /pageSize:/);
  assert.match(detailJs, /isEnd:/);
  assert.match(detailJs, /onReachBottom/);
  assert.match(detailWxml, /class="list-end-state"/);

  assert.match(indexJs, /page:\s*1/);
  assert.match(indexJs, /pageSize:/);
  assert.match(indexJs, /isEnd:/);
  assert.match(indexJs, /onReachBottom/);
  assert.match(indexWxml, /class="list-end-state"/);
  assert.match(appCss, /\.list-end-state[\s\S]*font-size:\s*12px/);
  assert.match(appCss, /\.list-end-state[\s\S]*color:\s*var\(--color-text-placeholder\)/);

  assert.match(groupedCf, /page\s*=/);
  assert.match(groupedCf, /pageSize\s*=/);
  assert.doesNotMatch(groupedCf, /\.slice\(0,\s*50\)/);
});

test('home risk entry routes into a real inventory filter instead of a dead storage flag', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const inventoryJs = read('miniprogram/pages/inventory/index.js');
  const inventoryWxml = read('miniprogram/pages/inventory/index.wxml');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');

  assert.match(homeIndexJs, /filter=risk/);
  assert.doesNotMatch(homeIndexJs, /setStorageSync\(\s*["']filterAction["']/);
  assert.match(inventoryJs, /activeFilter:/);
  assert.match(inventoryJs, /options\.filter/);
  assert.match(inventoryJs, /clearFilter/);
  assert.match(inventoryWxml, /activeFilter/);
  assert.match(groupedCf, /const \{ searchVal, category, filter/);
  assert.match(groupedCf, /isLowStock/);
  assert.match(groupedCf, /isRisky/);
});

test('home log shortcuts and log pages expose visible date range filters', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const logsJs = read('miniprogram/pages/logs/index.js');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const logsJson = read('miniprogram/pages/logs/index.json');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');
  const adminLogsJson = read('miniprogram/pages/admin-logs/index.json');
  const getLogsCf = read('cloudfunctions/getLogs/index.js');

  assert.match(homeIndexJs, /dateFilter=today&typeFilter=inbound/);
  assert.match(homeIndexJs, /dateFilter=today&typeFilter=outbound/);
  assert.doesNotMatch(homeIndexJs, /filter=today_in/);
  assert.doesNotMatch(homeIndexJs, /filter=today_out/);

  assert.match(logsJs, /options\.filter === 'today_in' \|\| options\.filter === 'today_out'/);
  assert.match(logsJs, /initialDateFilter = 'today'/);
  assert.match(logsJs, /initialTypeFilter = options\.filter === 'today_in' \? 'inbound' : 'outbound'/);
  assert.match(logsJs, /TYPE_TITLE_MAP/);
  assert.match(logsJs, /outbound:\s*'领用记录'/);
  assert.match(logsJs, /onTypeFilterChange\(e\)[\s\S]*setNavigationBarTitle/);
  assert.match(logsJs, /dateOptions:[\s\S]*自定义/);
  assert.match(logsJs, /startDate: dateFilter === 'custom' \? startDate : ''/);
  assert.match(logsJs, /endDate: dateFilter === 'custom' \? endDate : ''/);
  assert.match(logsWxml, /date-range-bar/);
  assert.match(logsWxml, /van-calendar/);
  assert.match(logsJson, /van-calendar/);

  assert.match(adminLogsJs, /dateOptions:[\s\S]*自定义/);
  assert.match(adminLogsJs, /startDate: dateFilter === 'custom' \? startDate : ''/);
  assert.match(adminLogsJs, /endDate: dateFilter === 'custom' \? endDate : ''/);
  assert.match(adminLogsWxml, /date-range-bar/);
  assert.match(adminLogsWxml, /van-calendar/);
  assert.match(adminLogsJson, /van-calendar/);

  assert.match(getLogsCf, /parseCstDateRange/);
  assert.match(getLogsCf, /buildDateRangeCondition/);
  assert.match(getLogsCf, /startDate/);
  assert.match(getLogsCf, /endDate/);
});

test('log pages present operator names and audit enums as user-facing Chinese text', () => {
  const logsJs = read('miniprogram/pages/logs/index.js');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const logItemWxml = read('miniprogram/components/log-item/index.wxml');
  const getLogsCf = read('cloudfunctions/getLogs/index.js');
  const getOperatorsCf = read('cloudfunctions/getOperators/index.js');
  const logSearch = read('cloudfunctions/_shared/log-search.js');

  assert.match(logsJs, /resolveOperatorDisplayName/);
  assert.match(logsJs, /'width_adjust':\s*\{\s*text:\s*'修正幅宽'/);
  assert.match(logsJs, /'stocktake_adjust':\s*\{\s*text:\s*'盘点调整'/);
  assert.match(logsJs, /'inventory_correction':\s*\{\s*text:\s*'库存纠错'/);
  assert.match(adminLogsJs, /test_material_identity:\s*'测试料型号'/);
  assert.match(adminLogsJs, /product_code_prefix:\s*'产品代码前缀'/);
  assert.match(adminLogsJs, /width_adjust:\s*\{\s*text:\s*'修正幅宽'/);
  assert.match(adminLogsJs, /stocktake_adjust:\s*\{\s*text:\s*'盘点调整'/);
  assert.match(adminLogsJs, /inventory_correction:\s*\{\s*text:\s*'库存纠错'/);
  assert.match(adminLogsJs, /resolveOperatorDisplayName/);
  assert.match(adminLogsJs, /_hideQuantity:\s*true/);
  assert.doesNotMatch(adminLogsJs, /\\u4e00-\\u9fff/);
  assert.match(logItemWxml, /wx:if="\{\{ !item\._hideQuantity \}\}"/);

  assert.match(getLogsCf, /loadOperatorFilterAliases/);
  assert.match(getLogsCf, /actor_id:\s*_\.\in\(aliases\)/);
  assert.match(getLogsCf, /operatorFilterAliases/);
  assert.match(getOperatorsCf, /looksLikeInternalId/);
  assert.match(getOperatorsCf, /resolveUserDisplayName/);
  assert.match(logSearch, /const INBOUND_TYPES = \['inbound'\]/);
  assert.match(logSearch, /const OUTBOUND_TYPES = \['outbound'\]/);
  assert.match(logSearch, /const TRANSFER_TYPES = \['transfer'\]/);
  assert.match(logSearch, /ACTION_FILTER_TYPES = \['width_adjust', 'stocktake_adjust', 'inventory_correction'\]/);
  assert.match(logSearch, /\{\s*operator_id:\s*_\.\in\(aliases\)\s*\}/);
});

test('home dashboard cards describe identity and log-count semantics explicitly', () => {
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const dashboardStats = read('cloudfunctions/_shared/dashboard-stats.js');
  const dashboardCf = read('cloudfunctions/getDashboardStats/index.js');

  assert.match(homeIndexWxml, /在库品项/);
  assert.match(homeIndexWxml, /预警品项/);
  assert.match(homeIndexWxml, /今日入库记录/);
  assert.match(homeIndexWxml, /今日领料记录/);
  assert.match(dashboardStats, /supplier_model_key\s*\|\|\s*item\.supplier_model/);
  assert.match(dashboardCf, /supplier_model_key:\s*true/);
});

test('home and search-driven pages expose consistent search trigger wiring and field descriptions', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const homeIndexWxss = read('miniprogram/pages/index/index.wxss');
  const inventoryIndexWxml = read('miniprogram/pages/inventory/index.wxml');
  const materialDirectoryWxml = read('miniprogram/pages/material-directory/index.wxml');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');

  assert.match(homeIndexJs, /homeSearchVal:/);
  assert.match(homeIndexJs, /onSearchChange/);
  assert.match(homeIndexJs, /onSearchClear/);
  assert.match(homeIndexJs, /loadHomeSearchSuggestions/);
  assert.match(homeIndexJs, /navigateToInventorySearch/);
  assert.doesNotMatch(homeIndexJs, /this\.homeSearchTimer\s*=\s*setTimeout\(\s*\(\)\s*=>\s*\{\s*this\.navigateToInventorySearch/);
  assert.match(homeIndexWxml, /value="\{\{ homeSearchVal \}\}"/);
  assert.match(homeIndexWxml, /slot="action"[\s\S]*搜索/);
  assert.match(homeIndexWxml, /home-search-suggestions/);
  assert.match(homeIndexWxml, /bind:change="onSearchChange"/);
  assert.match(homeIndexWxml, /bind:clear="onSearchClear"/);
  assert.match(homeIndexWxml, /placeholder="在库：产品代码\/物料名\/原厂型号\/标签等"/);
  assert.match(homeIndexWxss, /\.home-search-suggestions/);
  assert.match(homeIndexWxss, /\.home-search-action/);

  assert.match(inventoryIndexWxml, /placeholder="在库：产品代码\/物料名\/原厂型号\/标签等"/);
  assert.match(materialDirectoryWxml, /placeholder="物料目录：产品代码\/物料名\/原厂型号等"/);
  assert.match(materialListWxml, /placeholder="主数据：产品代码\/物料名\/原厂型号等"/);
  assert.match(logsWxml, /placeholder="日志：产品代码\/物料名\/原厂型号\/项目等"/);
  assert.match(adminLogsWxml, /placeholder="\{\{ searchPlaceholder \}\}"/);
  assert.match(adminLogsJs, /库存流水：产品代码\/物料名\/原厂型号等/);
  assert.match(adminLogsJs, /审计：领域\/动作\/操作人\/对象\/操作号/);
});

test('search-driven list pages use the agreed debounce timing and stale-request protection', () => {
  const inventoryIndexJs = read('miniprogram/pages/inventory/index.js');
  const materialDirectoryJs = read('miniprogram/pages/material-directory/index.js');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const identityManageJs = read('miniprogram/pages/admin/test-material-identity-manage/index.js');
  const labelExportJs = read('miniprogram/pages/admin/label-export/index.js');
  const projectUsageJs = read('miniprogram/pages/project-usage/index.js');

  assert.match(inventoryIndexJs, /setTimeout\(\(\)\s*=>\s*\{\s*this\.getList\(true\);?\s*\},\s*400\)/);
  assert.match(materialDirectoryJs, /setTimeout\(\(\)\s*=>\s*\{\s*this\.getList\(true\);?\s*\},\s*400\)/);
  assert.match(materialListJs, /setTimeout\(\(\)\s*=>\s*this\.refreshSearchResults\(\),\s*400\)/);
  assert.match(identityManageJs, /setTimeout\(\(\)\s*=>\s*this\.loadIdentities\(\{\s*refresh:\s*true\s*\}\),\s*400\)/);
  assert.match(labelExportJs, /setTimeout\(\(\)\s*=>\s*\{\s*this\.resetSelection\(\);[\s\S]*this\.getList\(true\);[\s\S]*\},\s*400\)/);
  assert.match(projectUsageJs, /setTimeout\(\(\)\s*=>\s*\{\s*this\.loadReport\(true\);?\s*\},\s*600\)/);
  assert.match(projectUsageJs, /_reportRequestKey/);
  assert.match(projectUsageJs, /_reportRequestPromise/);
});

test('grouped inventory search keeps full product totals while using search only for matching', () => {
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');

  assert.match(groupedCf, /const baseConditions = \[\{ status: 'in_stock' \}\]/);
  assert.match(groupedCf, /const searchConditions = baseConditions\.slice\(\)/);
  assert.match(groupedCf, /const matchedSourceResult = await loadInventoryGroupSourceItems\(where,\s*100,\s*\{/);
  assert.match(groupedCf, /maxRows:\s*regex \? MAX_SEARCH_CANDIDATES : 0/);
  assert.match(groupedCf, /const matchedSourceItems = matchedSourceResult\.items \|\| \[\]/);
  assert.match(groupedCf, /const matchedGroupKeys = new Set/);
  assert.match(groupedCf, /const groupSourceResult = regex[\s\S]*await loadInventoryGroupSourceItems\(baseWhere\)[\s\S]*matchedSourceResult/);
  assert.match(groupedCf, /const groupSourceItems = groupSourceResult\.items \|\| \[\]/);
  assert.match(groupedCf, /matchedGroupKeys\.has\(item\._groupKey\)/);
  assert.match(groupedCf, /loadInventoryItemsForGroups\(baseWhere, list\)/);
  assert.doesNotMatch(groupedCf, /loadInventoryItemsByProductCodes\(where, pageCodes\)/);
  assert.doesNotMatch(groupedCf, /OFFSET_MS|currentRescaled|getTime\(\)\s*\+\s*8\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('test material inventory queries keep supplier model as a narrowing identity', () => {
  const inventoryIndexWxml = read('miniprogram/pages/inventory/index.wxml');
  const inventoryIndexJs = read('miniprogram/pages/inventory/index.js');
  const detailJs = read('miniprogram/pages/inventory/detail-list.js');
  const detailWxml = read('miniprogram/pages/inventory/detail-list.wxml');
  const labelQueryUtil = read('miniprogram/utils/inventory-label-query.js');
  const batchCf = read('cloudfunctions/getInventoryBatches/index.js');
  const recordCf = read('cloudfunctions/getInventoryRecord/index.js');
  const exportDataCf = read('cloudfunctions/exportData/index.js');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');

  assert.match(inventoryIndexWxml, /wx:key="_groupKey"/);
  assert.match(inventoryIndexWxml, /placeholder="在库：产品代码\/物料名\/原厂型号\/标签等"/);
  assert.match(inventoryIndexJs, /supplierModel/);
  assert.match(inventoryIndexJs, /supplier_model=/);

  assert.match(groupedCf, /buildInventoryGroupKey/);
  assert.match(groupedCf, /is_test_material[\s\S]*supplier_model/);
  assert.match(groupedCf, /\{\s*supplier_model_key:\s*regex\s*\}/);
  assert.match(groupedCf, /_groupKey/);
  assert.match(groupedCf, /supplier_model:\s*item\.supplier_model/);
  assert.match(groupedCf, /supplier_model_key:\s*item\.supplier_model_key/);

  assert.match(detailJs, /querySupplierModel/);
  assert.match(detailJs, /supplierModel:\s*querySupplierModel/);
  assert.match(detailJs, /supplierModel:\s*this\.data\.querySupplierModel/);
  assert.match(detailWxml, /label\.supplier_model/);

  assert.match(labelQueryUtil, /supplierModel/);
  assert.match(batchCf, /supplierModel/);
  assert.match(batchCf, /supplier_model:\s*supplierModel/);
  assert.match(batchCf, /isTestMaterialGroup/);
  assert.match(batchCf, /isTestMaterialGroup[\s\S]*group\.material_name[\s\S]*material\.material_name/);
  assert.match(batchCf, /isTestMaterialGroup[\s\S]*group\.sub_category[\s\S]*material\.sub_category/);
  assert.match(recordCf, /supplierModel/);
  assert.match(recordCf, /supplier_model:\s*supplierModel/);
  assert.match(exportDataCf, /\{\s*supplier_model:\s*searchRegex\s*\}/);
});

test('app user status check surfaces retry and routes disabled users away from business pages', () => {
  const appJs = read('miniprogram/app.js');
  const pendingWxml = read('miniprogram/pages/status/pending.wxml');
  const pendingJs = read('miniprogram/pages/status/pending.js');

  assert.match(appJs, /USER_STATUS\.DISABLED[\s\S]*wx\.reLaunch\(\{\s*url:\s*['"`]\/pages\/status\/pending\?status=disabled/);
  assert.match(appJs, /wx\.showModal\(\{[\s\S]*身份校验失败[\s\S]*confirmText:\s*['"]重试['"][\s\S]*this\.checkUserStatus\(\)/);
  assert.match(pendingWxml, /账号已禁用/);
  assert.match(pendingWxml, /请联系管理员处理/);
  assert.match(pendingJs, /pending \| rejected \| disabled/);
});

test('inventory change token propagates from detail page back to list pages', () => {
  const appJs = read('miniprogram/app.js');
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');
  const listJs = read('miniprogram/pages/inventory/detail-list.js');
  const inventoryIndexJs = read('miniprogram/pages/inventory/index.js');

  assert.match(appJs, /inventoryChangedAt:\s*0/);
  assert.match(detailJs, /inventoryChangedAt\s*=\s*Date\.now\(\)/);
  assert.match(listJs, /inventoryChangedAt/);
  assert.match(inventoryIndexJs, /inventoryChangedAt/);
});

test('master data change token refreshes master-data and directory pages after returning from writes', () => {
  const appJs = read('miniprogram/app.js');
  const materialEditJs = read('miniprogram/pages/admin/material-edit.js');
  const materialImportJs = read('miniprogram/pages/admin/material-import/index.js');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListJson = read('miniprogram/pages/admin/material-list.json');
  const materialDirectoryJs = read('miniprogram/pages/material-directory/index.js');
  const materialDirectoryJson = read('miniprogram/pages/material-directory/index.json');
  const identityEditJs = read('miniprogram/pages/admin/test-material-identity-edit/index.js');
  const identityManageJs = read('miniprogram/pages/admin/test-material-identity-manage/index.js');
  const identityManageJson = read('miniprogram/pages/admin/test-material-identity-manage/index.json');
  const approvalCenterJs = read('miniprogram/pages/admin/approval-center/index.js');

  assert.match(appJs, /masterDataChangedAt:\s*0/);
  assert.match(materialEditJs, /masterDataChangedAt\s*=\s*Date\.now\(\)/);
  assert.match(materialImportJs, /masterDataChangedAt\s*=\s*Date\.now\(\)/);
  assert.match(identityEditJs, /masterDataChangedAt\s*=\s*Date\.now\(\)/);
  assert.match(identityManageJs, /masterDataChangedAt\s*=\s*Date\.now\(\)/);
  assert.match(approvalCenterJs, /action === 'approve'[\s\S]*masterDataChangedAt\s*=\s*Date\.now\(\)/);

  assert.match(materialListJs, /hasLoadedOnce:\s*false/);
  assert.match(materialListJs, /lastSeenMasterDataChangedAt:\s*0/);
  assert.match(materialListJs, /masterDataChangedAt === this\.data\.lastSeenMasterDataChangedAt/);
  assert.match(materialListJs, /refreshSearchResults\(\)/);
  assert.match(materialListJson, /"enablePullDownRefresh":\s*true/);

  assert.match(materialDirectoryJs, /hasLoadedOnce:\s*false/);
  assert.match(materialDirectoryJs, /lastSeenMasterDataChangedAt:\s*0/);
  assert.match(materialDirectoryJs, /masterDataChangedAt !== this\.data\.lastSeenMasterDataChangedAt/);
  assert.match(materialDirectoryJson, /"enablePullDownRefresh":\s*true/);
  assert.match(identityManageJson, /"enablePullDownRefresh":\s*true/);
});

test('inventory detail exposes label logs but keeps destructive delete entry retired', () => {
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');
  const detailWxml = read('miniprogram/pages/inventory-detail/index.wxml');

  assert.match(detailWxml, /item\._title/);
  assert.match(detailWxml, /item\._subtitle/);
  assert.match(detailWxml, /item\._headerCodeText/);
  assert.match(detailJs, /item\.is_test_material && supplierModel/);
  assert.match(detailJs, /测试料代码/);
  assert.match(detailWxml, /查看标签日志/);
  assert.match(detailWxml, /bindtap="onViewLogs"/);
  assert.match(detailJs, /onViewLogs/);
  assert.match(detailJs, /inventory_id=/);
  assert.match(detailJs, /this\.data\.id\s*\|\|\s*item\._id/);
  assert.match(detailJs, /encodeURIComponent/);
  assert.doesNotMatch(detailJs, /onDelete\s*\(/);
  assert.doesNotMatch(detailJs, /removeInventory/);
  assert.doesNotMatch(detailWxml, /删除警告|删除库存|bindtap="onDelete"|bind:click="onDelete"/);
});

test('home and inventory pages do not keep retired client state fields', () => {
  const homeJs = read('miniprogram/pages/index/index.js');
  const homeWxml = read('miniprogram/pages/index/index.wxml');
  const inventoryJs = read('miniprogram/pages/inventory/index.js');
  const inventoryWxml = read('miniprogram/pages/inventory/index.wxml');

  assert.doesNotMatch(homeJs, /alertConfig/);
  assert.doesNotMatch(homeWxml, /alertConfig/);
  assert.doesNotMatch(inventoryJs, /isGrouped|showDetailPopup|detailList|detailTitle|detailTotal/);
  assert.doesNotMatch(inventoryWxml, /isGrouped|showDetailPopup|detailList|detailTitle|detailTotal/);
});

test('inventory query page does not initialize direct cloud database clients', () => {
  const inventoryJs = read('miniprogram/pages/inventory/index.js');

  assert.doesNotMatch(inventoryJs, /wx\.cloud\.database\(\)/);
  assert.doesNotMatch(inventoryJs, /db\.command/);
});

test('search-driven list pages keep an explicit request id so stale responses can be ignored safely', () => {
  const inventoryIndexJs = read('miniprogram/pages/inventory/index.js');
  const materialDirectoryJs = read('miniprogram/pages/material-directory/index.js');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');

  assert.match(inventoryIndexJs, /requestId:/);
  assert.match(inventoryIndexJs, /nextRequestId|currentRequestId/);

  assert.match(materialDirectoryJs, /requestId:/);
  assert.match(materialDirectoryJs, /nextRequestId|currentRequestId/);

  assert.match(materialListJs, /requestId:/);
  assert.match(materialListJs, /nextRequestId|currentRequestId/);
});

test('home retrieval popup paginates inventory suggestions instead of stopping at the first page', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const appCss = read('miniprogram/app.wxss');

  assert.match(homeIndexJs, /selectPage:/);
  assert.match(homeIndexJs, /selectPageSize:/);
  assert.match(homeIndexJs, /selectIsEnd:/);
  assert.match(homeIndexJs, /selectRequestId:/);
  assert.match(homeIndexJs, /onSelectPopupReachBottom/);
  assert.match(homeIndexWxml, /bindscrolltolower="onSelectPopupReachBottom"/);
  assert.match(appCss, /\.page-loading-state[\s\S]*justify-content:\s*center/);
});

test('home quick-withdraw popup exposes product and batch modes under one action entry', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');

  assert.match(homeIndexJs, /quickWithdrawMode:/);
  assert.match(homeIndexJs, /onQuickWithdrawModeChange/);
  assert.match(homeIndexJs, /withdrawMode:/);
  assert.match(homeIndexJs, /mode === 'product'|quickWithdrawMode === 'product'/);
  assert.match(homeIndexWxml, /快捷领料/);
  assert.match(homeIndexWxml, /按产品代码领料/);
  assert.match(homeIndexWxml, /按批次领料/);
  assert.match(homeIndexWxml, /mode="\{\{ withdrawMode \}\}"/);
});

test('home shortcuts are grouped by usage frequency and permission level', () => {
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const expectedOrder = [
    '常用操作',
    '库存查询',
    '物料入库',
    '标签打印',
    '项目用料查询',
    '物料目录',
    '管理维护',
    '审批中心',
    '主数据管理',
    '项目编码管理',
    '人员与权限',
    '日志追溯',
    '操作日志',
    '审计日志'
  ];

  let lastIndex = -1;
  expectedOrder.forEach((label) => {
    const nextIndex = homeIndexWxml.indexOf(label);
    assert.notEqual(nextIndex, -1, `${label} should exist on the home page`);
    assert.ok(nextIndex > lastIndex, `${label} should appear after the previous shortcut group item`);
    lastIndex = nextIndex;
  });

  assert.match(homeIndexWxml, /wx:if="\{\{ isAdmin \|\| isSuperAdmin \}\}"/);
  assert.match(homeIndexWxml, /title="人员与权限"[\s\S]*wx:if="\{\{ isSuperAdmin \}\}"/);
  assert.match(homeIndexWxml, /title="审计日志"[\s\S]*wx:if="\{\{ isAdmin \}\}"/);
});

test('master data page groups material and test-model search results with status and parent context', () => {
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const materialListJson = read('miniprogram/pages/admin/material-list.json');

  assert.match(materialListJson, /"navigationBarTitleText":\s*"主数据管理"/);
  assert.match(materialListWxml, /title="物料主数据"/);
  assert.match(materialListWxml, /title="测试料"/);
  assert.match(materialListWxml, /title="在用"/);
  assert.match(materialListWxml, /title="已归档"/);
  assert.ok(
    materialListWxml.indexOf('class="search-transparent bg-white"') < materialListWxml.indexOf('active="{{ activeTab }}"'),
    'global search should be visually above browse tabs'
  );
  assert.match(materialListWxml, /<van-tabs wx:if="\{\{ !hasSearchKeyword \}\}" active="\{\{ activeTab \}\}"/);
  assert.match(materialListJs, /status:\s*normalizedSearchVal \? 'all' : materialStatus/);
  assert.match(materialListJs, /includeDisabled:\s*this\.data\.activeTab === 'testIdentity' \|\| !!normalizeSearchKeyword/);
  assert.match(materialListJs, /Promise\.all\(\[[\s\S]*this\.getList\(true\)[\s\S]*this\.loadIdentityResults\(\{ refresh: true \}\)/);
  assert.match(materialListJs, /onIdentityItemClick/);
  assert.match(materialListJs, /test-material-identity-edit\/index\?id=/);
  assert.match(materialListWxml, /物料主数据[\s\S]*测试料/);
  assert.match(materialListWxml, /item\.label_material_name \|\| item\.material_name/);
  assert.match(materialListWxml, /identity-model-title/);
  assert.match(materialListWxml, /item\.supplier_model \|\| '-'/);
  assert.match(materialListWxml, /测试料代码：/);
  assert.match(materialListWxml, /子类别：/);
  assert.doesNotMatch(materialListWxml, /供应商：\{\{ item\.supplier \}\}/);
  assert.match(materialListWxml, /全局搜索结果：\{\{ total \}\} 项物料 · \{\{ identityTotal \}\} 个型号/);
  assert.match(materialListWxml, /bind:tap="onIdentityItemClick"/);
  assert.match(materialListWxml, /class="count-wrap"/);
  assert.match(materialListWxml, /class="top-actions"/);
  assert.doesNotMatch(materialListWxml, /bind:click="onImportTestMaterialIdentity"[\s\S]*导入/);
  assert.match(materialListWxml, /bind:click="onCreateTestMaterialIdentity"[\s\S]*新增/);
  assert.doesNotMatch(materialListWxml, /批量导入|新增型号/);
  assert.match(materialListWxml, /已归档/);
  assert.match(materialListWxml, /已停用/);
  assert.match(materialListWxml, /match-reason/);
  assert.doesNotMatch(materialListWxml, /维护型号库/);
});

test('material directory uses unified material cards and includes test identities as usable materials', () => {
  const materialDirectoryJs = read('miniprogram/pages/material-directory/index.js');
  const materialDirectoryWxml = read('miniprogram/pages/material-directory/index.wxml');
  const materialDirectoryWxss = read('miniprogram/pages/material-directory/index.wxss');
  const manageMaterialCf = read('cloudfunctions/manageMaterial/index.js');

  assert.match(materialDirectoryJs, /action:\s*'directoryList'/);
  assert.match(materialDirectoryJs, /buildDirectoryDisplayItem/);
  assert.match(materialDirectoryJs, /\(res\.result\.list \|\| \[\]\)\.map\(buildDirectoryDisplayItem\)/);
  assert.match(materialDirectoryJs, /item\.display_title \|\| supplierModel \|\| productCode/);
  assert.match(materialDirectoryJs, /item\.display_name[\s\S]*item\.label_material_name[\s\S]*item\.material_name/);
  assert.match(materialDirectoryWxml, /wx:key="directory_key"/);
  assert.match(materialDirectoryWxml, /item\.display_title/);
  assert.match(materialDirectoryWxml, /item\.display_name/);
  assert.match(materialDirectoryWxml, /item\.display_meta/);
  assert.doesNotMatch(materialDirectoryWxml, /wx:if="\{\{ item\.is_test_identity \}\}"[\s\S]*测试料/);
  assert.doesNotMatch(materialDirectoryWxml, /供应商:/);
  assert.match(materialDirectoryWxss, /\.material-card__top[\s\S]*justify-content:\s*space-between/);
  assert.match(materialDirectoryWxss, /\.material-card__tags[\s\S]*justify-content:\s*flex-end/);
  assert.match(manageMaterialCf, /case 'directoryList'/);
  assert.match(manageMaterialCf, /listMaterialDirectory/);
  assert.match(manageMaterialCf, /is_test_material:\s*_\.neq\(true\)/);
  assert.match(manageMaterialCf, /test_material_identities/);
  assert.match(manageMaterialCf, /directory_kind:\s*'test_identity'/);
  assert.match(manageMaterialCf, /display_meta:[\s\S]*测试料代码：/);
});

test('master data and test identity pages keep count/actions and loading states visually separated', () => {
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const materialListWxss = read('miniprogram/pages/admin/material-list.wxss');
  const identityManageWxss = read('miniprogram/pages/admin/test-material-identity-manage/index.wxss');

  assert.match(materialListWxss, /\.top-bar[\s\S]*flex-direction:\s*column/);
  assert.match(materialListWxss, /\.count-text[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(materialListWxss, /\.top-actions[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(materialListWxss, /\.top-actions[\s\S]*width:\s*100%/);
  assert.match(materialListWxml, /class="card-action card-action--edit"[\s\S]*编辑/);
  assert.match(materialListWxml, /class="card-action card-action--archive"[\s\S]*归档/);
  assert.doesNotMatch(materialListWxml, /custom-style="margin-bottom: 8rpx;"[\s\S]*归档/);
  assert.match(materialListWxss, /\.card-actions[\s\S]*border-radius:\s*999rpx/);
  assert.match(materialListWxss, /\.card-action\s*\{[\s\S]*font-size:\s*22rpx/);
  assert.match(materialListWxss, /\.loading-state[\s\S]*align-items:\s*center/);
  assert.match(materialListWxss, /\.loading-state[\s\S]*justify-content:\s*center/);
  assert.match(identityManageWxss, /\.identity-loading[\s\S]*align-items:\s*center/);
  assert.match(identityManageWxss, /\.identity-loading[\s\S]*justify-content:\s*center/);
});

test('inventory and master data pages surface broad-search guidance from cloud functions', () => {
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const inventoryIndexJs = read('miniprogram/pages/inventory/index.js');
  const inventoryIndexWxml = read('miniprogram/pages/inventory/index.wxml');
  const materialDirectoryJs = read('miniprogram/pages/material-directory/index.js');
  const materialDirectoryWxml = read('miniprogram/pages/material-directory/index.wxml');
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const identityServiceJs = read('miniprogram/utils/test-material-identity-service.js');
  const identityManageJs = read('miniprogram/pages/admin/test-material-identity-manage/index.js');
  const identityManageWxml = read('miniprogram/pages/admin/test-material-identity-manage/index.wxml');

  assert.match(groupedCf, /MAX_SEARCH_CANDIDATES/);
  assert.match(groupedCf, /searchTruncated/);
  assert.match(groupedCf, /结果较多，请继续输入关键词/);
  assert.match(inventoryIndexJs, /searchMessage:/);
  assert.match(inventoryIndexWxml, /text="\{\{ searchMessage \}\}"/);
  assert.match(materialDirectoryJs, /searchMessage:/);
  assert.match(materialDirectoryWxml, /text="\{\{ searchMessage \}\}"/);
  assert.match(materialListJs, /searchNoticeText:/);
  assert.match(materialListWxml, /text="\{\{ searchNoticeText \}\}"/);
  assert.match(identityServiceJs, /searchTruncated/);
  assert.match(identityServiceJs, /searchMessage/);
  assert.match(identityManageJs, /searchMessage:/);
  assert.match(identityManageWxml, /text="\{\{ searchMessage \}\}"/);
});

test('grouped inventory cards expose a compact match reason hint during searches', () => {
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const itemComponentJs = read('miniprogram/components/material-list-item/index.js');
  const itemComponentWxml = read('miniprogram/components/material-list-item/index.wxml');
  const inventoryDisplayJs = read('miniprogram/utils/inventory-display.js');

  assert.match(groupedCf, /matchReasonText|标签编号匹配|批号匹配|库位匹配|供应商匹配/);
  assert.doesNotMatch(groupedCf, /命中产品代码|命中物料名称|产品代码匹配|物料名称匹配/);
  assert.match(itemComponentJs, /buildGroupedInventoryCardState/);
  assert.match(inventoryDisplayJs, /matchReasonText/);
  assert.match(itemComponentWxml, /display\.matchReasonText/);
});

test('inventory second layer uses batch aggregation with single-label direct open and multi-label inline expansion', () => {
  const detailJs = read('miniprogram/pages/inventory/detail-list.js');
  const detailWxml = read('miniprogram/pages/inventory/detail-list.wxml');
  const detailWxss = read('miniprogram/pages/inventory/detail-list.wxss');
  const batchItemJs = read('miniprogram/components/batch-list-item/index.js');

  assert.match(detailJs, /getInventoryBatches/);
  assert.match(detailJs, /expandedBatchKey/);
  assert.match(detailJs, /expandedBatchLabels/);
  assert.match(detailJs, /expandedLabelRequestId/);
  assert.match(detailJs, /labelCount\s*<=\s*1|labelCount\s*===\s*1/);
  assert.match(detailJs, /\/pages\/inventory-detail\/index\?id=/);
  assert.match(detailJs, /expandedLabelRequestId:\s*this\.data\.expandedLabelRequestId \+ 1|expandedLabelRequestId:\s*currentRequestId \+ 1/);
  assert.match(detailJs, /inventoryChangedAt/);
  assert.match(detailWxml, /batch-list-item/);
  assert.match(detailWxml, /bind:itemtap="onBatchTap"/);
  assert.match(detailWxml, /expandedBatchKey/);
  assert.match(detailWxml, /expandedBatchLabels/);
  assert.match(detailWxml, /label\.expiryBadgeText/);
  assert.match(detailWxml, /label\.rowTone/);
  assert.match(detailWxml, /class="list-end-state"/);
  assert.match(detailWxml, /bindtap="openLabelDetail"|catchtap="openLabelDetail"/);
  assert.match(detailWxss, /\.label-row-inline[\s\S]*grid-template-columns:/);
  assert.match(detailWxss, /\.label-inline-code[\s\S]*color:\s*var\(--color-brand\)/);
  assert.doesNotMatch(detailWxss, /\.label-inline-code\.is-warning/);
  assert.match(detailWxss, /\.label-inline-qty[\s\S]*color:\s*var\(--color-brand\)/);
  assert.match(detailWxss, /\.label-inline-qty\.is-warning[\s\S]*var\(--color-warning\)/);
  assert.doesNotMatch(detailWxss, /\.list-end-state/);
  assert.match(detailWxss, /\.label-inline-code[\s\S]*font-size:\s*16px/);
  assert.match(detailWxss, /\.label-inline-qty[\s\S]*font-size:\s*18px/);
  assert.match(detailWxss, /\.label-inline-badge[\s\S]*font-size:\s*18rpx/);
  assert.doesNotMatch(detailWxss, /\.inline-label-panel[\s\S]*margin:\s*-/);
  assert.match(batchItemJs, /triggerEvent\('itemtap'/);
  assert.doesNotMatch(detailJs, /\/pages\/inventory\/labels\/index/);
});

test('standalone label list page remains compact when opened directly', () => {
  const appJson = read('miniprogram/app.json');
  const labelsJsPath = path.join(__dirname, '..', 'miniprogram/pages/inventory/labels/index.js');
  const labelsWxmlPath = path.join(__dirname, '..', 'miniprogram/pages/inventory/labels/index.wxml');

  assert.match(appJson, /pages\/inventory\/labels\/index/);
  assert.equal(fs.existsSync(labelsJsPath), true);
  assert.equal(fs.existsSync(labelsWxmlPath), true);
  const labelsJs = fs.readFileSync(labelsJsPath, 'utf8');
  const labelsWxml = fs.readFileSync(labelsWxmlPath, 'utf8');
  const labelsWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/inventory/labels/index.wxss'), 'utf8');
  assert.match(labelsJs, /loadBatchLabelPage/);
  assert.match(labelsJs, /inventoryChangedAt/);
  assert.match(labelsWxml, /item\.unique_code/);
  assert.match(labelsWxml, /item\._qtyStr/);
  assert.match(labelsWxml, /item\.location/);
  assert.match(labelsWxml, /class="list-end-state"/);
  assert.doesNotMatch(labelsWxml, /item\.batch_number|item\.supplier(?!_model)|item\._expiryStr/);
  assert.doesNotMatch(labelsWxss, /\.label-code\.is-warning/);
  assert.match(labelsWxss, /\.label-qty\.is-warning[\s\S]*var\(--color-warning\)/);
  assert.doesNotMatch(labelsWxss, /\.list-end-state/);
});

test('home retrieval popup and inventory batch page share the same batch aggregation cloud function', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const detailJs = read('miniprogram/pages/inventory/detail-list.js');
  const batchCfPath = path.join(__dirname, '..', 'cloudfunctions/getInventoryBatches/index.js');

  assert.equal(fs.existsSync(batchCfPath), true);
  const batchCf = fs.readFileSync(batchCfPath, 'utf8');
  assert.match(homeIndexJs, /getInventoryBatches/);
  assert.match(homeIndexWxml, /bind:itemtap="onSelectBatchItem"/);
  assert.match(detailJs, /getInventoryBatches/);
  assert.match(batchCf, /labelCount|itemCount/);
  assert.match(batchCf, /page\s*=/);
  assert.match(batchCf, /pageSize\s*=/);
  assert.match(batchCf, /require\('\.\/warehouse-zones'\)/);
  assert.match(batchCf, /buildLocationDetailMapByZone/);
  assert.match(batchCf, /resolveInventoryLocationText\(item,\s*zoneMap,\s*detailMapByZone\)/);
});

test('home scan opens inventory detail for existing labels instead of direct withdrawal popup', () => {
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const handleScanMatch = homeIndexJs.match(/async handleScanResult\(code\) \{[\s\S]*?\n  \},\n\n  onAmountInput/);

  assert.ok(handleScanMatch);
  assert.match(handleScanMatch[0], /\/pages\/inventory-detail\/index\?id=\$\{encodeURIComponent\(item\._id\)\}/);
  assert.match(handleScanMatch[0], /标签已在库/);
  assert.doesNotMatch(handleScanMatch[0], /showWithdrawDialog:\s*true/);
  assert.doesNotMatch(handleScanMatch[0], /withdrawMode:\s*["']scan["']/);
});

test('batch and label layers keep expiry messaging split between grouped and tag-level semantics', () => {
  const batchItemWxml = read('miniprogram/components/batch-list-item/index.wxml');
  const batchItemJs = read('miniprogram/components/batch-list-item/index.js');
  const labelQueryJs = read('miniprogram/utils/inventory-label-query.js');
  const inventoryDisplayJs = read('miniprogram/utils/inventory-display.js');

  assert.match(batchItemWxml, /display\.expiryBadgeText/);
  assert.match(batchItemJs, /buildBatchCardState/);
  assert.match(labelQueryJs, /expiry_date/);
  assert.match(labelQueryJs, /is_long_term_valid/);
  assert.match(labelQueryJs, /isExpiring/);
  assert.match(labelQueryJs, /expiryBadgeText/);
  assert.match(labelQueryJs, /rowTone/);
  assert.match(inventoryDisplayJs, /即将过期/);
});

test('list end states use one shared subtle footer style across search and log views', () => {
  const appCss = read('miniprogram/app.wxss');
  const homeIndexWxml = read('miniprogram/pages/index/index.wxml');
  const inventoryIndexWxml = read('miniprogram/pages/inventory/index.wxml');
  const detailWxml = read('miniprogram/pages/inventory/detail-list.wxml');
  const labelsWxml = read('miniprogram/pages/inventory/labels/index.wxml');
  const materialDirectoryWxml = read('miniprogram/pages/material-directory/index.wxml');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');

  assert.match(appCss, /\.list-end-state[\s\S]*font-size:\s*12px/);
  assert.match(appCss, /\.list-end-state[\s\S]*padding:\s*10px/);
  assert.match(appCss, /\.list-end-state[\s\S]*color:\s*var\(--color-text-placeholder\)/);
  assert.match(homeIndexWxml, /class="list-end-state"/);
  assert.match(inventoryIndexWxml, /class="list-end-state"/);
  assert.match(detailWxml, /class="list-end-state"/);
  assert.match(labelsWxml, /class="list-end-state"/);
  assert.match(materialDirectoryWxml, /class="list-end-state"/);
  assert.match(materialListWxml, /class="list-end-state"/);
  assert.match(logsWxml, /class="list-end-state"/);
  assert.match(adminLogsWxml, /class="list-end-state"/);
  assert.doesNotMatch(homeIndexWxml, /到底了/);
  assert.doesNotMatch(materialDirectoryWxml, /到底了/);
  assert.doesNotMatch(materialListWxml, /到底了/);
});
