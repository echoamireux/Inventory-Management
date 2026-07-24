#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const readinessPath = path.join(__dirname, 'release-readiness.json');

function fail(message) {
  console.error(`发布检查失败：${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} 未通过`);
  }
}

function assertEnvironmentFile() {
  const envPath = path.join(repoRoot, 'miniprogram', 'env.js');
  if (!fs.existsSync(envPath)) {
    fail('缺少 miniprogram/env.js；请从 env.example.js 创建并填写正式云环境 ID');
  }
  let config;
  try {
    delete require.cache[require.resolve(envPath)];
    config = require(envPath);
  } catch (_error) {
    fail('miniprogram/env.js 不是有效的 CommonJS 配置');
  }
  const envId = String(config && config.env || '').trim();
  if (!envId || /^YOUR[-_]/i.test(envId) || envId === 'YOUR-REAL-ENV-ID' || envId === 'REPLACE_WITH_WECHAT_CLOUD_ENV_ID') {
    fail('miniprogram/env.js 仍是占位环境 ID');
  }
}

function assertExternalReadiness() {
  if (!fs.existsSync(readinessPath)) {
    fail('缺少 scripts/release-readiness.json；请完成正式库集合、索引、ACL 与旧云函数清理确认');
  }
  let readiness;
  try {
    readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
  } catch (_error) {
    fail('scripts/release-readiness.json 不是有效 JSON');
  }
  if (readiness.environment !== 'production') {
    fail('release-readiness.json 的 environment 必须为 production');
  }
  const requiredCollections = [
    'operation_receipts', 'audit_events', 'material_requests',
    'inventory_correction_requests', 'test_material_identities'
  ];
  const requiredIndexes = [
    'inventory.unique_code',
    'inventory.product_code + status + expiry_date + create_time + _id',
    'inventory.product_code + status + batch_number + expiry_date + create_time + _id',
    'inventory.product_code + status + supplier_model_key + expiry_date + create_time + _id',
    'inventory.product_code + status + batch_number + supplier_model_key + expiry_date + create_time + _id',
    'inventory_log.timestamp desc + _id desc',
    'inventory_log.type + timestamp desc + _id desc',
    'audit_events.timestamp desc + _id desc',
    'material_requests.product_code + status',
    'inventory_correction_requests.source_log_id + status',
    'material_requests.pending_key unique',
    'inventory_correction_requests.pending_key unique'
  ];
  for (const collection of requiredCollections) {
    if (!readiness.collections || readiness.collections[collection] !== true) {
      fail(`正式库集合未确认：${collection}`);
    }
  }
  for (const index of requiredIndexes) {
    if (!readiness.indexes || readiness.indexes[index] !== true) {
      fail(`正式库索引未确认：${index}`);
    }
  }
  if (readiness.aclCloudFunctionOnly !== true) {
    fail('核心集合 ACL 尚未确认“仅云函数可读写”');
  }
  const removed = new Set(readiness.removedCloudFunctions || []);
  for (const legacy of ['login', 'initMDMCollection', 'exportTestMaterialIdentityTemplate']) {
    if (!removed.has(legacy)) {
      fail(`旧云函数清理未确认：${legacy}`);
    }
  }
}

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preflight:deploy']);
assertEnvironmentFile();
assertExternalReadiness();
console.log('发布检查通过：测试、预检、环境配置和正式库门槛均已确认。');
