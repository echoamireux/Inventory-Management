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

function walkJsFiles(rootDir) {
  const results = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }

  return results;
}

function resolveLocalRequire(fromFile, spec) {
  const basePath = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.json`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.json'),
    path.join(basePath, 'package.json')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function listCloudFunctionDirs() {
  return fs.readdirSync(path.join(repoRoot, 'cloudfunctions'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '_shared' && entry.name !== 'node_modules')
    .map(entry => entry.name)
    .sort();
}

function extractAuthImportNames(source) {
  const names = [];
  const authImportPattern = /const\s*\{([\w\s,]+?)\}\s*=\s*require\(\s*['"]\.\/auth['"]\s*\)/g;
  let match;

  while ((match = authImportPattern.exec(source))) {
    const importedNames = match[1]
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map((item) => item.split(':')[0].trim());
    names.push(...importedNames);
  }

  return names;
}

test('deployable cloudfunction files do not require helpers through ../_shared paths', () => {
  const functionFiles = walkFunctionFiles(path.join(repoRoot, 'cloudfunctions'));
  const offenders = functionFiles.filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return /require\((['"])\.\.\/_shared\//.test(source);
  }).map((filePath) => path.relative(repoRoot, filePath));

  assert.deepEqual(offenders, []);
});

test('cloudfunction local require targets exist in deployable packages', () => {
  const functionFiles = walkJsFiles(path.join(repoRoot, 'cloudfunctions'));
  const missing = [];

  for (const filePath of functionFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const requirePattern = /require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;
    let match;

    while ((match = requirePattern.exec(source))) {
      const spec = match[2];
      const resolved = resolveLocalRequire(filePath, spec);
      if (!resolved) {
        missing.push({
          file: path.relative(repoRoot, filePath),
          spec,
          expected: path.relative(repoRoot, path.resolve(path.dirname(filePath), `${spec}.js`))
        });
      }
    }
  }

  assert.deepEqual(missing, []);
});

test('cloudfunction auth imports are provided by each deployable auth helper', () => {
  const missing = [];

  for (const functionName of listCloudFunctionDirs()) {
    const functionDir = path.join(repoRoot, 'cloudfunctions', functionName);
    const indexPath = path.join(functionDir, 'index.js');
    const authPath = path.join(functionDir, 'auth.js');

    if (!fs.existsSync(indexPath) || !fs.existsSync(authPath)) {
      continue;
    }

    const importedAuthNames = extractAuthImportNames(fs.readFileSync(indexPath, 'utf8'));
    if (importedAuthNames.length === 0) {
      continue;
    }

    delete require.cache[require.resolve(authPath)];
    const localAuth = require(authPath);
    for (const name of importedAuthNames) {
      if (typeof localAuth[name] === 'undefined') {
        missing.push(`${functionName}/auth.js:${name}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test('shared auth sync script covers every deployable local auth helper', () => {
  const syncScript = read('cloudfunctions/sync_shared.sh');
  const missing = [];

  for (const functionName of listCloudFunctionDirs()) {
    const relAuthPath = `cloudfunctions/${functionName}/auth.js`;
    if (fs.existsSync(path.join(repoRoot, relAuthPath))
      && !syncScript.includes(`cp cloudfunctions/_shared/auth.js ${relAuthPath}`)) {
      missing.push(relAuthPath);
    }
  }

  assert.deepEqual(missing, []);
});

test('cloudfunctions requiring wx-server-sdk declare it in their package dependencies', () => {
  const cloudfunctionsDir = path.join(repoRoot, 'cloudfunctions');
  const missing = [];
  const functionDirs = fs.readdirSync(cloudfunctionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '_shared' && entry.name !== 'node_modules');

  for (const entry of functionDirs) {
    const functionDir = path.join(cloudfunctionsDir, entry.name);
    const jsFiles = walkJsFiles(functionDir);
    const requiresWxServerSdk = jsFiles.some((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /require\(\s*['"]wx-server-sdk['"]\s*\)/.test(source);
    });

    if (!requiresWxServerSdk) {
      continue;
    }

    const packageJsonPath = path.join(functionDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      missing.push(`${entry.name}/package.json`);
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {})
    };
    if (!dependencies['wx-server-sdk']) {
      missing.push(`${entry.name}/package.json`);
    }
  }

  assert.deepEqual(missing, []);
});

test('batchRemoveLog package name matches its deployable function folder', () => {
  const packageJson = JSON.parse(read('cloudfunctions/batchRemoveLog/package.json'));

  assert.equal(packageJson.name, 'batchRemoveLog');
});

test('importInventoryTemplate keeps a deployable local film helper and sync script covers shared helper copies', () => {
  const syncScript = read('cloudfunctions/sync_shared.sh');
  const importInventoryQuantity = read('cloudfunctions/importInventoryTemplate/inventory-quantity.js');
  const importFilmQuantityPath = path.join(repoRoot, 'cloudfunctions/importInventoryTemplate/film-quantity.js');
  const exportDataCstTimePath = path.join(repoRoot, 'cloudfunctions/exportData/cst-time.js');
  const addMaterialRequestAuthPath = path.join(repoRoot, 'cloudfunctions/addMaterialRequest/auth.js');
  const projectUsageAuthPath = path.join(repoRoot, 'cloudfunctions/getProjectUsageReport/auth.js');
  const exportProjectUsageAuthPath = path.join(repoRoot, 'cloudfunctions/exportProjectUsageReport/auth.js');
  const inventoryRecordAuthPath = path.join(repoRoot, 'cloudfunctions/getInventoryRecord/auth.js');
  const approvalCenterAuthPath = path.join(repoRoot, 'cloudfunctions/getApprovalCenterData/auth.js');

  assert.match(importInventoryQuantity, /require\(['"]\.\/film-quantity['"]\)/);
  assert.equal(fs.existsSync(importFilmQuantityPath), true);
  assert.equal(fs.existsSync(exportDataCstTimePath), true);
  assert.equal(fs.existsSync(addMaterialRequestAuthPath), true);
  assert.equal(fs.existsSync(projectUsageAuthPath), true);
  assert.equal(fs.existsSync(exportProjectUsageAuthPath), true);
  assert.equal(fs.existsSync(inventoryRecordAuthPath), true);
  assert.equal(fs.existsSync(approvalCenterAuthPath), true);

  assert.match(syncScript, /cp cloudfunctions\/_shared\/auth\.js cloudfunctions\/addMaterialRequest\/auth\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/auth\.js cloudfunctions\/getProjectUsageReport\/auth\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/auth\.js cloudfunctions\/exportProjectUsageReport\/auth\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/auth\.js cloudfunctions\/getInventoryRecord\/auth\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/auth\.js cloudfunctions\/getApprovalCenterData\/auth\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/film-quantity\.js cloudfunctions\/approveInventoryCorrectionRequest\/film-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/film-quantity\.js cloudfunctions\/importInventoryTemplate\/film-quantity\.js/);

  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/addMaterial\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/batchAddInventory\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/approveInventoryCorrectionRequest\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/inventory-quantity\.js cloudfunctions\/importInventoryTemplate\/inventory-quantity\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/export-report\.js cloudfunctions\/exportData\/export-report\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/cst-time\.js cloudfunctions\/exportData\/cst-time\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/cst-time\.js cloudfunctions\/getProjectUsageReport\/cst-time\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/cst-time\.js cloudfunctions\/exportProjectUsageReport\/cst-time\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/search\.js cloudfunctions\/getProjectUsageReport\/search\.js/);
  assert.match(syncScript, /cp cloudfunctions\/_shared\/material-subcategories\.js cloudfunctions\/getApprovalCenterData\/material-subcategories\.js/);
});
