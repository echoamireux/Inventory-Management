const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let preprintJobs = null;
try {
  preprintJobs = require('../cloudfunctions/_shared/preprint-jobs');
} catch (_error) {
  preprintJobs = null;
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('preprint jobs use stable operator-scoped document and label ids', () => {
  assert.ok(preprintJobs, 'expected shared preprint job helper');
  const first = preprintJobs.buildPreprintJobId('openid-a', 'request-1');
  const repeated = preprintJobs.buildPreprintJobId('openid-a', 'request-1');
  const otherUser = preprintJobs.buildPreprintJobId('openid-b', 'request-1');

  assert.equal(first, repeated);
  assert.notEqual(first, otherUser);
  assert.match(first, /^preprint_job_[a-f0-9]{40}$/);
  assert.equal(
    preprintJobs.buildPreprintLabelDocumentId(first, 1),
    preprintJobs.buildPreprintLabelDocumentId(first, 1)
  );
  assert.notEqual(
    preprintJobs.buildPreprintLabelDocumentId(first, 1),
    preprintJobs.buildPreprintLabelDocumentId(first, 2)
  );
});

test('preprint job helper chunks label work and rejects non-ready consumption', () => {
  assert.ok(preprintJobs, 'expected shared preprint job helper');
  assert.deepEqual(preprintJobs.chunkPreprintItems(Array.from({ length: 45 }), 20).map(item => item.length), [20, 20, 5]);
  assert.doesNotThrow(() => preprintJobs.assertPreprintJobConsumable({ status: 'ready' }));
  assert.throws(() => preprintJobs.assertPreprintJobConsumable({ status: 'creating' }), /尚未生成完成/);
  assert.throws(() => preprintJobs.assertPreprintJobConsumable({ status: 'voiding' }), /正在作废/);
  assert.throws(() => preprintJobs.assertPreprintJobConsumable({ status: 'voided' }), /已作废/);
});

test('label export cloud function persists recoverable jobs and stable export files', () => {
  const source = read('cloudfunctions/exportLabelData/index.js');

  assert.match(source, /preprint_jobs/);
  assert.match(source, /buildPreprintJobId/);
  assert.match(source, /buildPreprintLabelDocumentId/);
  assert.match(source, /chunkPreprintItems\([^)]*,\s*20\)/);
  assert.match(source, /status:\s*'creating'/);
  assert.match(source, /status:\s*'ready'/);
  assert.match(source, /status:\s*'voiding'/);
  assert.match(source, /status:\s*'voided'/);
  assert.match(source, /export_status:\s*'pending'/);
  assert.match(source, /updatePreprintJobExportState\([^)]*'exported'/);
  assert.match(source, /updatePreprintJobExportState\([^)]*'failed'/);
  assert.match(source, /cloudPath:[^\n]*jobId|cloudPath:[^\n]*job_id/);
});

test('recent jobs and void actions operate on preprint_jobs by job id', () => {
  const cloudSource = read('cloudfunctions/exportLabelData/index.js');
  const pageSource = read('miniprogram/pages/admin/label-export/index.js');

  assert.match(cloudSource, /listRecentPreprintJobs[\s\S]*collection\('preprint_jobs'\)/);
  assert.match(cloudSource, /voidPreprintLabels[\s\S]*jobId/);
  assert.match(pageSource, /voidPreprintJob\(jobId/);
  assert.match(pageSource, /data:\s*\{\s*jobId\s*\}/);
  assert.doesNotMatch(pageSource, /voidPreprintIds\(ids/);
});

test('all preprinted-label stock-in paths gate and account against ready jobs', () => {
  for (const relativePath of [
    'cloudfunctions/addMaterial/index.js',
    'cloudfunctions/batchAddInventory/index.js',
    'cloudfunctions/importInventoryTemplate/index.js'
  ]) {
    const source = read(relativePath);
    assert.match(source, /preprint_jobs/);
    assert.match(source, /assertPreprintJobConsumable/);
    assert.match(source, /used_count/);
  }
});

test('multi-row stock-in aggregates preprint job usage before updating each job once', () => {
  for (const relativePath of [
    'cloudfunctions/batchAddInventory/index.js',
    'cloudfunctions/importInventoryTemplate/index.js'
  ]) {
    const source = read(relativePath);
    assert.match(source, /preprintJobUsageCounts\s*=\s*new Map\(\)/);
    assert.match(source, /for\s*\(const \[jobId, usedCount\] of preprintJobUsageCounts\.entries\(\)\)/);
    assert.match(source, /used_count:\s*_\.inc\(usedCount\)/);
  }
});
