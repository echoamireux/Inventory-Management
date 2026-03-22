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
  assert.match(batchCss, /\.batch-meta-row[\s\S]*align-items:\s*center/);
  assert.match(batchCss, /\.batch-meta-group[\s\S]*align-items:\s*center/);
  assert.match(batchCss, /\.batch-meta-value[\s\S]*min-height:\s*20px/);
  assert.match(batchCss, /\.batch-meta-group-location[\s\S]*margin-left:/);
  assert.match(batchWxml, /type="meta"\s+text="有效期"/);
  assert.match(batchWxml, /type="meta"\s+text="库位"/);
  assert.doesNotMatch(batchWxml, /class="batch-meta-label"/);
  assert.match(appCss, /\.tag-meta[\s\S]*font-size:\s*11px/);
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

test('inventory pages support pull-down refresh for manual recovery', () => {
  const detailJson = read('miniprogram/pages/inventory/detail-list.json');
  const indexJson = read('miniprogram/pages/inventory/index.json');

  assert.match(detailJson, /"enablePullDownRefresh":\s*true/);
  assert.match(indexJson, /"enablePullDownRefresh":\s*true/);
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
