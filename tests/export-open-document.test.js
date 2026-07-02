const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('export pages open downloaded workbooks through the shared readable-name resolver', () => {
  const exportPages = [
    'miniprogram/pages/admin/label-export/index.js',
    'miniprogram/pages/admin/material-import/index.js',
    'miniprogram/pages/material-add/template-import/index.js',
    'miniprogram/pages/inventory/index.js',
    'miniprogram/pages/project-usage/index.js'
  ];

  for (const relPath of exportPages) {
    const source = read(relPath);
    assert.match(source, /resolveOpenDocumentPath/, `${relPath} should use the shared open-path resolver`);
    assert.doesNotMatch(
      source,
      /allowTempFallback:\s*false/,
      `${relPath} should not fail export only because DevTools cannot save a readable local file name`
    );
  }
});
