const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listCloudFunctionDirectories() {
  return fs.readdirSync(path.join(repoRoot, 'cloudfunctions'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(repoRoot, 'cloudfunctions', name, 'package.json')))
    .sort();
}

test('production dependencies are exact and every deployable package has a lockfile', () => {
  const rootPackage = JSON.parse(read('package.json'));
  assert.equal(rootPackage.dependencies['@vant/weapp'], '1.11.7');
  assert.equal(rootPackage.scripts['preflight:deploy'], 'node scripts/deploy-preflight.js');
  assert.equal(fs.existsSync(path.join(repoRoot, 'package-lock.json')), true);

  for (const functionName of listCloudFunctionDirectories()) {
    const functionDir = path.join(repoRoot, 'cloudfunctions', functionName);
    const pkg = JSON.parse(fs.readFileSync(path.join(functionDir, 'package.json'), 'utf8'));
    if (pkg.dependencies && pkg.dependencies['wx-server-sdk']) {
      assert.equal(pkg.dependencies['wx-server-sdk'], '3.0.4', `${functionName} wx-server-sdk must be pinned`);
    }
    if (pkg.dependencies && pkg.dependencies.exceljs) {
      assert.equal(pkg.dependencies.exceljs, '4.4.0', `${functionName} exceljs must be pinned`);
    }
    assert.equal(
      fs.existsSync(path.join(functionDir, 'package-lock.json')),
      true,
      `${functionName} must commit package-lock.json`
    );
  }

  const gitignore = read('.gitignore');
  assert.doesNotMatch(gitignore, /^package-lock\.json$/m);
  assert.doesNotMatch(gitignore, /^cloudfunctions\/\*\*\/package-lock\.json$/m);
});

test('unused direct database wrapper and retired cloud functions are removed', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'miniprogram/utils/db.js')), false);
  assert.doesNotMatch(read('miniprogram/pages/register/index.js'), /utils\/db/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/login')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/initMDMCollection')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/exportTestMaterialIdentityTemplate')), false);
  // searchInventory 于 2026-07-26 下线：无前端调用方，检索能力由 getInventoryGrouped 承担
  assert.equal(fs.existsSync(path.join(repoRoot, 'cloudfunctions/searchInventory')), false);
});

test('reports and dynamic templates overwrite operator-scoped stable cloud paths', () => {
  assert.match(read('cloudfunctions/exportData/index.js'), /exports\/\$\{OPENID\}\/inventory\/current\.xlsx/);
  assert.match(read('cloudfunctions/exportProjectUsageReport/index.js'), /exports\/\$\{OPENID\}\/project-usage\/current\.xlsx/);
  assert.match(read('cloudfunctions/exportMaterialTemplate/index.js'), /templates\/\$\{OPENID\}\/material-import\/current\.xlsx/);
  assert.match(read('cloudfunctions/exportInventoryTemplate/index.js'), /templates\/\$\{OPENID\}\/inventory-import\/current\.xlsx/);
  assert.match(read('cloudfunctions/exportLabelData/index.js'), /label-exports\/\$\{operatorOpenid\}\/reprint\/\$\{templateType\}\/current\.xlsx/);
});

test('README documents production permissions, required indexes and retired cloud cleanup', () => {
  const readme = read('README.md');
  for (const requiredText of [
    '仅云函数可读写',
    'preprint_jobs.operator_id + created_at desc',
    'preprinted_labels.job_id + operator_id + job_index',
    'users.status + create_time desc',
    'material_requests.status + created_at desc',
    'inventory_correction_requests.status + created_at desc',
    'project_codes.project_code',
    'material_subcategories.subcategory_key',
    'warehouse_zones.zone_key',
    'inventory.material_id + status',
    'operation_receipts.operator_id + created_at desc',
    'test_material_identities.category + product_code + similar_key',
    'audit_events.timestamp desc',
    'audit_events.actor_id + timestamp desc',
    'audit_events.domain + timestamp desc',
    'preprint_daily_usage',
    'inventory.status + identity_key',
    '`audit_events`',
    '`removeInventory`',
    '`removeInventory` 安全部署',
    '`editInventory`',
    '管理员继续可以直接执行盘点调整',
    '允许审批自己提交的纠错申请',
    '审计写入失败时，业务事务必须一并回滚',
    'npm run preflight:deploy',
    '删除云端 `login`',
    '删除云端 `initMDMCollection`',
    '删除云端 `exportTestMaterialIdentityTemplate`'
  ]) {
    assert.match(readme, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(readme, /project_codes\.project_code[\s\S]*material_subcategories\.subcategory_key[\s\S]*warehouse_zones\.zone_key[\s\S]*勾选“唯一索引”/);
});

test('deployment preflight script verifies cloud functions, shared copies and stable query sorts', () => {
  const script = read('scripts/deploy-preflight.js');
  assert.doesNotMatch(script, /预期 34 个可部署云函数目录/);
  assert.match(script, /删除云端 `exportTestMaterialIdentityTemplate`/);
  assert.match(script, /cloudfunctions-manifest\.json/);
  assert.match(script, /新增未登记云函数/);
  assert.match(script, /清单登记但目录缺失/);
  assert.match(script, /collectFrontendCloudCalls/);
  assert.match(script, /audit-events\.js/);
  assert.match(script, /operation_receipts/);
  assert.match(script, /audit_events/);
  assert.match(script, /preprint_daily_usage/);
  assert.match(script, /applyStableOrder/);

  for (const relPath of [
    'cloudfunctions/getLogs/index.js',
    'cloudfunctions/getInventoryGrouped/index.js',
    'cloudfunctions/getInventoryBatches/index.js',
    'cloudfunctions/getDashboardStats/index.js',
    'cloudfunctions/getOperators/index.js'
  ]) {
    const source = read(relPath);
    assert.match(source, /_id/, `${relPath} should include _id in stable sorting`);
    assert.match(source, /orderBy|applyStableOrder/, `${relPath} should apply stable sorting`);
  }
});

test('release gates reject placeholder environments and declare concurrency and FEFO indexes', () => {
  const appSource = read('miniprogram/app.js');
  const releaseCheck = read('scripts/release-check.js');
  const readinessExample = JSON.parse(read('scripts/release-readiness.example.json'));
  const readme = read('README.md');

  assert.match(appSource, /REPLACE_WITH_WECHAT_CLOUD_ENV_ID/);
  for (const requiredCollection of [
    'preprinted_labels',
    'preprint_jobs',
    'preprint_daily_usage',
    'system_counters',
    'test_material_identities',
    'warehouse_location_details'
  ]) {
    assert.equal(releaseCheck.includes(requiredCollection), true, `release-check missing ${requiredCollection}`);
    assert.equal(readinessExample.collections[requiredCollection], false, `readiness example missing ${requiredCollection}`);
  }
  for (const requiredIndex of [
    'material_requests.product_code + status',
    'inventory_correction_requests.source_log_id + status',
    'inventory.product_code + status + expiry_date + create_time + _id',
    'test_material_identities.identity_key',
    'test_material_identities.product_code + status + supplier_model_key',
    'test_material_identities.material_id + status + updated_at desc',
    'test_material_identities.category + product_code + similar_key',
    'preprinted_labels.unique_code',
    'preprint_jobs.operator_id + created_at desc',
    'operation_receipts.operator_id + created_at desc',
    'audit_events.timestamp desc + _id desc'
  ]) {
    assert.equal(releaseCheck.includes(requiredIndex), true, `release-check missing ${requiredIndex}`);
    assert.equal(readinessExample.indexes[requiredIndex], false, `readiness example missing ${requiredIndex}`);
    assert.equal(readme.includes(requiredIndex), true, `README missing ${requiredIndex}`);
  }
});

test('critical release cloud functions mask unknown technical errors', () => {
  for (const relPath of [
    'cloudfunctions/exportLabelData/index.js',
    'cloudfunctions/approveMaterialRequest/index.js',
    'cloudfunctions/approveInventoryCorrectionRequest/index.js'
  ]) {
    const source = read(relPath);
    assert.match(source, /handleCloudError/, `${relPath} should use shared error response helper`);
    assert.doesNotMatch(source, /msg:\s*['"`]操作失败:\s*['"`]\s*\+\s*(err|error)\.message/);
    assert.doesNotMatch(source, /msg:\s*(err|error)\.message\s*\|\|/);
  }

  const syncScript = read('cloudfunctions/sync_shared.sh');
  for (const expectedCopy of [
    'cloudfunctions/approveMaterialRequest/operation-receipts.js',
    'cloudfunctions/approveMaterialRequest/error-response.js',
    'cloudfunctions/approveInventoryCorrectionRequest/error-response.js',
    'cloudfunctions/exportLabelData/error-response.js'
  ]) {
    assert.match(syncScript, new RegExp(expectedCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
