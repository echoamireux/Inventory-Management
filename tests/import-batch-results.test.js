const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createImportResultTracker
} = require('../cloudfunctions/_shared/import-batch-results');

test('import result tracker records created, skipped, and failed rows with summary counts', () => {
  const tracker = createImportResultTracker();

  tracker.recordCreated(2, 'J-001');
  tracker.recordSkipped(3, 'J-002', '产品代码已存在');
  tracker.recordError(4, 'J-003', '子类别无效');

  assert.deepEqual(tracker.toResponse(), {
    created: 1,
    skipped: 1,
    errors: 1,
    results: [
      { rowIndex: 2, product_code: 'J-001', status: 'created', reason: '创建成功' },
      { rowIndex: 3, product_code: 'J-002', status: 'skipped', reason: '产品代码已存在' },
      { rowIndex: 4, product_code: 'J-003', status: 'error', reason: '子类别无效' }
    ]
  });
});
