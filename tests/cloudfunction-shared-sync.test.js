const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function walkFunctionFiles(rootDir) {
  const results = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_shared' || entry.name === 'node_modules') {
        continue;
      }
      const nested = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const child of nested) {
        if (child.isFile() && child.name.endsWith('.js')) {
          results.push(path.join(fullPath, child.name));
        }
      }
    }
  }

  return results;
}

test('deployable cloudfunction files do not require helpers through ../_shared paths', () => {
  const functionFiles = walkFunctionFiles(path.join(repoRoot, 'cloudfunctions'));
  const offenders = functionFiles.filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return /require\((['"])\.\.\/_shared\//.test(source);
  }).map((filePath) => path.relative(repoRoot, filePath));

  assert.deepEqual(offenders, []);
});

test('importInventoryTemplate keeps a deployable local film helper and sync script covers shared helper copies', () => {
  const syncScript = read('cloudfunctions/sync_shared.sh');
  const importInventoryQuantity = read('cloudfunctions/importInventoryTemplate/inventory-quantity.js');
  const importFilmQuantityPath = path.join(repoRoot, 'cloudfunctions/importInventoryTemplate/film-quantity.js');

  assert.match(importInventoryQuantity, /require\(['"]\.\/film-quantity['"]\)/);
  assert.equal(fs.existsSync(importFilmQuantityPath), true);

  assert.match(syncScript, /cp cloudfunctions\/_shared\/film-quantity\.js cloudfunctions\/approveInventoryCorrectionRequest\/film-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/film-quantity\.js cloudfunctions\/importInventoryTemplate\/film-quantity\.js/);

  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/addMaterial\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/batchAddInventory\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/approveInventoryCorrectionRequest\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/importInventoryTemplate\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/export-report\.js cloudfunctions\/exportData\/export-report\.js/);
});
