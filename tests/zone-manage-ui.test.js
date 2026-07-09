const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('zone manage page uses compact toolbar and detail row layouts', () => {
  const wxml = read('miniprogram/pages/admin/zone-manage/index.wxml');
  const wxss = read('miniprogram/pages/admin/zone-manage/index.wxss');

  assert.match(wxml, /class="zone-header__main"/);
  assert.match(wxml, /class="zone-header__copy"/);
  assert.match(wxml, /class="zone-header__action"/);
  assert.match(wxml, /class="zone-detail-header__main"/);
  assert.match(wxml, /class="zone-detail-row__content"/);
  assert.doesNotMatch(wxml, /<van-button[^>]*round block[^>]*bind:click="onCreateZone"/);

  assert.match(wxss, /\.zone-header__main\s*\{[\s\S]*justify-content:\s*space-between/);
  assert.match(wxss, /\.zone-header__action\s*\{[\s\S]*flex-shrink:\s*0/);
  assert.match(wxss, /\.zone-detail-header\s*\{[\s\S]*align-items:\s*center/);
  assert.match(wxss, /\.zone-detail-row\s*\{[\s\S]*display:\s*flex[\s\S]*align-items:\s*center/);
  assert.match(wxss, /\.zone-detail-row__actions\s*\{[\s\S]*justify-content:\s*flex-end/);
  assert.doesNotMatch(wxss, /\.zone-detail-row__main\s*\{[\s\S]*margin-bottom/);
});
