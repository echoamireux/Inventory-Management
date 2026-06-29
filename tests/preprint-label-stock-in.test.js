const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('single stock-in page checks preprinted labels after scanning', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');

  assert.match(pageJs, /loadPreprintLabel/);
  assert.match(pageJs, /action:\s*'getPreprintLabel'/);
  assert.match(pageJs, /applyPreprintLabel/);
  assert.match(pageJs, /form\.supplier_model/);
  assert.match(pageJs, /form\.sample_note/);
});

test('batch stock-in page validates scanned preprinted labels against the selected material', () => {
  const pageJs = read('miniprogram/pages/material-add/batch-entry.js');
  const utilJs = read('miniprogram/utils/batch-entry.js');

  assert.match(pageJs, /loadPreprintLabel/);
  assert.match(pageJs, /action:\s*'getPreprintLabel'/);
  assert.match(pageJs, /预生成标签不属于当前物料/);
  assert.match(utilJs, /supplier_model/);
  assert.match(utilJs, /sample_note/);
});
