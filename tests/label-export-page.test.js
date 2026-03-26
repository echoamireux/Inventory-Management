const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('app routes and home shortcuts expose label export to all active users', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');

  assert.match(appJson, /"pages\/admin\/label-export\/index"/);
  assert.match(
    homeWxml,
    /<van-cell title="标签导出" icon="description" is-link url="\/pages\/admin\/label-export\/index"\s*\/>/
  );
});

test('label export page exposes template tabs, governed search fields, selection state, and export action wiring', () => {
  const pageJs = read('miniprogram/pages/admin/label-export/index.js');
  const pageWxml = read('miniprogram/pages/admin/label-export/index.wxml');
  const pageJson = read('miniprogram/pages/admin/label-export/index.json');
  const pageWxss = read('miniprogram/pages/admin/label-export/index.wxss');

  assert.match(pageJson, /"enablePullDownRefresh":\s*true/);

  assert.match(pageJs, /templateType:/);
  assert.match(pageJs, /selectedIds:/);
  assert.match(pageJs, /requestId:/);
  assert.match(pageJs, /onTemplateChange/);
  assert.match(pageJs, /toggleSelectItem/);
  assert.match(pageJs, /onExportSelected/);
  assert.match(pageJs, /name:\s*'exportLabelData'/);
  assert.match(pageJs, /status\s*!==\s*'active'/);
  assert.match(pageJs, /仅已激活用户可访问/);

  assert.match(pageWxml, /placeholder="标签编号\/产品代码\/物料名称\/批号"/);
  assert.match(pageWxml, /膜材信息标签/);
  assert.match(pageWxml, /化材标准瓶信息标签/);
  assert.match(pageWxml, /化材小瓶信息标签/);
  assert.match(pageWxml, /selectedIds\.length/);
  assert.match(pageWxml, /bindtap="toggleSelectItem"/);
  assert.match(pageWxml, /bindtap="onExportSelected"/);
  assert.match(pageWxml, /请先勾选需要打印的标签/);
  assert.match(pageWxml, /请按标签编号对应基础二维码标签粘贴/);
  assert.match(pageWxss, /\.inline-refresh-state[\s\S]*justify-content:\s*center/);
  assert.match(pageWxss, /\.inline-refresh-state[\s\S]*align-items:\s*center/);
});

test('label export cloud function separates list and export actions and only allows active users', () => {
  const file = read('cloudfunctions/exportLabelData/index.js');

  assert.match(file, /action/);
  assert.match(file, /case 'list'|if \(action === 'list'\)/);
  assert.match(file, /case 'export'|if \(action === 'export'\)/);
  assert.match(file, /assertActiveUserAccess/);
  assert.match(file, /仅已激活用户可导出信息标签/);
  assert.match(file, /templateType/);
  assert.match(file, /selectedIds/);
  assert.match(file, /searchVal/);
  assert.doesNotMatch(file, /qr_text/);
});
