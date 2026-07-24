#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const SHARED_COPY_EXCEPTIONS = new Set([
  'cloudfunctions/addMaterialRequest/material-units.js',
  'cloudfunctions/approveMaterialRequest/material-units.js'
]);

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function fail(message) {
  throw new Error(message);
}

function listCloudFunctionDirectories() {
  return fs.readdirSync(path.join(repoRoot, 'cloudfunctions'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name)
    .filter(name => exists(`cloudfunctions/${name}/package.json`))
    .sort();
}

function collectFrontendCloudCalls() {
  const roots = ['miniprogram/pages', 'miniprogram/components', 'miniprogram/utils'];
  const calls = new Set();

  function walk(absDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!/\.(js|wxs)$/.test(entry.name)) {
        continue;
      }
      const source = fs.readFileSync(absPath, 'utf8');
      const callRegex = /wx\.cloud\.callFunction\(\s*\{[\s\S]*?name:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = callRegex.exec(source))) {
        calls.add(match[1]);
      }
    }
  }

  roots.forEach(root => {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) {
      walk(abs);
    }
  });

  return Array.from(calls).sort();
}

function assertCloudFunctions() {
  if (!exists('package-lock.json')) {
    fail('根目录缺少 package-lock.json');
  }

  const functionNames = listCloudFunctionDirectories();
  const manifest = readJson('scripts/cloudfunctions-manifest.json');
  const expectedFunctionNames = Array.from(new Set(manifest.cloudFunctions || [])).sort();
  if (!expectedFunctionNames.length) {
    fail('cloudfunctions-manifest.json 未登记任何云函数');
  }
  if (expectedFunctionNames.length !== (manifest.cloudFunctions || []).length) {
    fail('cloudfunctions-manifest.json 存在重复云函数名称');
  }

  const expectedSet = new Set(expectedFunctionNames);
  const actualSet = new Set(functionNames);
  const missingFromDisk = expectedFunctionNames.filter(name => !actualSet.has(name));
  const unregistered = functionNames.filter(name => !expectedSet.has(name));
  if (missingFromDisk.length) {
    fail(`清单登记但目录缺失: ${missingFromDisk.join(', ')}`);
  }
  if (unregistered.length) {
    fail(`新增未登记云函数: ${unregistered.join(', ')}`);
  }
  for (const name of functionNames) {
    if (!exists(`cloudfunctions/${name}/index.js`)) {
      fail(`${name} 缺少 index.js`);
    }
    if (!exists(`cloudfunctions/${name}/package-lock.json`)) {
      fail(`${name} 缺少 package-lock.json`);
    }
  }

  const known = new Set(functionNames);
  const missingCalls = collectFrontendCloudCalls().filter(name => !known.has(name));
  if (missingCalls.length) {
    fail(`前端调用了不存在的云函数: ${missingCalls.join(', ')}`);
  }
}

function assertSharedSync() {
  const syncScript = read('cloudfunctions/sync_shared.sh');
  if (!/set -euo pipefail/.test(syncScript)) {
    fail('sync_shared.sh 必须启用 set -euo pipefail');
  }

  const sharedFiles = [
    'auth.js',
    'audit-events.js',
    'error-response.js',
    'operation-receipts.js',
    'inventory-quantity.js',
    'preprint-jobs.js',
    'search.js',
    'warehouse-zones.js',
    'test-material-identities.js'
  ];
  for (const fileName of sharedFiles) {
    if (!exists(`cloudfunctions/_shared/${fileName}`)) {
      fail(`缺少共享文件 cloudfunctions/_shared/${fileName}`);
    }
    if (!syncScript.includes(fileName)) {
      fail(`sync_shared.sh 未同步 ${fileName}`);
    }
  }

  const requiredAuditCopies = [
    'addMaterial',
    'batchAddInventory',
    'importInventoryTemplate',
    'updateInventory',
    'editInventory',
    'approveInventoryCorrectionRequest',
    'exportLabelData',
    'manageMaterial',
    'adminUpdateUserStatus'
  ];
  for (const functionName of requiredAuditCopies) {
    if (!exists(`cloudfunctions/${functionName}/audit-events.js`)) {
      fail(`${functionName} 缺少 audit-events.js 副本，请运行 npm run sync:shared`);
    }
  }

  const requiredErrorResponseCopies = [
    'addMaterial',
    'batchAddInventory',
    'importInventoryTemplate',
    'updateInventory',
    'addMaterialRequest',
    'submitInventoryCorrectionRequest',
    'manageProjectCode',
    'manageSubcategory',
    'addWarehouseZone',
    'manageTestMaterialIdentity',
    'manageProductCodePrefix',
    'getLogs',
    'getProjectUsageReport',
    'exportProjectUsageReport'
  ];
  for (const functionName of requiredErrorResponseCopies) {
    if (!exists(`cloudfunctions/${functionName}/error-response.js`)) {
      fail(`${functionName} 缺少 error-response.js 副本，请运行 npm run sync:shared`);
    }
  }

  const mappings = new Map();
  const copyPattern = /^cp\s+(cloudfunctions\/_shared\/\S+)\s+(cloudfunctions\/\S+)$/gm;
  let match;
  while ((match = copyPattern.exec(syncScript))) {
    mappings.set(match[2], match[1]);
  }
  const hash = relPath => crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relPath))).digest('hex');
  for (const [target, source] of mappings) {
    if (!exists(target)) {
      fail(`共享副本缺失: ${target}`);
    }
    if (hash(source) !== hash(target)) {
      fail(`共享副本内容不一致: ${target}；请运行 npm run sync:shared`);
    }
  }

  const sharedNames = new Set(fs.readdirSync(path.join(repoRoot, 'cloudfunctions', '_shared')));
  for (const functionName of listCloudFunctionDirectories()) {
    const functionDir = path.join(repoRoot, 'cloudfunctions', functionName);
    for (const fileName of fs.readdirSync(functionDir)) {
      if (!sharedNames.has(fileName)) continue;
      const relPath = `cloudfunctions/${functionName}/${fileName}`;
      if (!mappings.has(relPath) && !SHARED_COPY_EXCEPTIONS.has(relPath)) {
        fail(`共享副本未登记同步或例外白名单: ${relPath}`);
      }
    }
  }
}

function assertReadmeDeploymentChecklist() {
  const readme = read('README.md');
  const requiredTexts = [
    'operation_receipts',
    'audit_events',
    'preprint_daily_usage',
    'material_requests.pending_key',
    'inventory_correction_requests.pending_key',
    'audit_events.timestamp desc + _id desc',
    'npm run release:check',
    'test_material_identities',
    'test_material_identities.identity_key',
    'test_material_identities.product_code + status + supplier_model_key',
    'inventory.status + identity_key',
    'audit_events.timestamp desc',
    'audit_events.actor_id + timestamp desc',
    'audit_events.domain + timestamp desc',
    'operation_receipts.operator_id + created_at desc',
    'preprint_daily_usage',
    'npm run preflight:deploy',
    '仅云函数可读写',
    '删除云端 `login`',
    '删除云端 `initMDMCollection`',
    '删除云端 `exportTestMaterialIdentityTemplate`',
    '`removeInventory` 安全部署'
  ];
  for (const text of requiredTexts) {
    if (!readme.includes(text)) {
      fail(`README 缺少投产说明: ${text}`);
    }
  }
}

function assertStableQuerySorts() {
  const files = [
    'cloudfunctions/getLogs/index.js',
    'cloudfunctions/getInventoryGrouped/index.js',
    'cloudfunctions/getInventoryBatches/index.js',
    'cloudfunctions/getDashboardStats/index.js',
    'cloudfunctions/getOperators/index.js'
    , 'cloudfunctions/getProjectUsageReport/index.js'
    , 'cloudfunctions/exportProjectUsageReport/index.js'
  ];
  for (const relPath of files) {
    const source = read(relPath);
    if (!/_id/.test(source) || !/(orderBy|applyStableOrder)/.test(source)) {
      fail(`${relPath} 缺少 _id 稳定排序`);
    }
  }
}

function main() {
  assertCloudFunctions();
  assertSharedSync();
  assertReadmeDeploymentChecklist();
  assertStableQuerySorts();
  console.log('发布预检通过：云函数、共享副本、前端调用、README 与稳定排序检查均通过。');
}

try {
  main();
} catch (error) {
  console.error(`发布预检失败：${error.message}`);
  process.exit(1);
}
