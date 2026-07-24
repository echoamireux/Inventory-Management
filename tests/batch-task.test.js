const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_BATCH_CHUNK_SIZE,
  BATCH_TASK_TTL_MS,
  splitBatchItems,
  buildChunkOperationId,
  runChunkedBatchTask,
  saveBatchTask,
  loadBatchTask,
  clearBatchTask
} = require('../miniprogram/utils/batch-task');

test('splits at most 100 items into ordered ten-row chunks', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ rowIndex: index + 1 }));
  const chunks = splitBatchItems(items);

  assert.equal(MAX_BATCH_CHUNK_SIZE, 10);
  assert.deepEqual(chunks.map(chunk => chunk.items.length), [10, 10, 5]);
  assert.deepEqual(chunks.map(chunk => chunk.rowIndexes), [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    [21, 22, 23, 24, 25]
  ]);
});

test('builds stable operation ids for individual chunks', () => {
  assert.equal(buildChunkOperationId('batchin_root', 0), 'batchin_root:chunk:0');
  assert.equal(buildChunkOperationId('batchin_root', 2), 'batchin_root:chunk:2');
});

test('stops after a failed chunk and aggregates partial progress', async () => {
  const calls = [];
  const items = Array.from({ length: 25 }, (_, index) => ({ rowIndex: index + 1 }));
  const result = await runChunkedBatchTask({
    items,
    rootOperationId: 'root-1',
    submitChunk: async ({ chunkIndex, operationId, items: chunkItems }) => {
      calls.push({ chunkIndex, operationId, size: chunkItems.length });
      if (chunkIndex === 1) {
        throw new Error('第 2 批失败');
      }
      return { success: true, total: chunkItems.length };
    }
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.succeeded, 10);
  assert.deepEqual(result.failed, [{
    chunk_index: 1,
    row_indexes: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    msg: '第 2 批失败'
  }]);
  assert.deepEqual(result.pending, [2]);
  assert.deepEqual(calls, [
    { chunkIndex: 0, operationId: 'root-1:chunk:0', size: 10 },
    { chunkIndex: 1, operationId: 'root-1:chunk:1', size: 10 }
  ]);
});

test('resumes only unfinished chunks without re-submitting completed chunks', async () => {
  const calls = [];
  const items = Array.from({ length: 25 }, (_, index) => ({ rowIndex: index + 1 }));
  const result = await runChunkedBatchTask({
    items,
    rootOperationId: 'root-2',
    completedChunkIndexes: [0, 1],
    submitChunk: async ({ chunkIndex, operationId, items: chunkItems }) => {
      calls.push({ chunkIndex, operationId, size: chunkItems.length });
      return { success: true, total: chunkItems.length };
    }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.succeeded, 25);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(calls, [
    { chunkIndex: 2, operationId: 'root-2:chunk:2', size: 5 }
  ]);
});

test('persists resumable task state for twenty-four hours and clears expired state', () => {
  const storage = new Map();
  global.wx = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      storage.delete(key);
    }
  };

  const now = 1000;
  const task = {
    rootOperationId: 'root-3',
    items: [{ rowIndex: 1 }],
    completedChunkIndexes: [0]
  };
  saveBatchTask('template-import', task, now);

  assert.equal(BATCH_TASK_TTL_MS, 24 * 60 * 60 * 1000);
  assert.deepEqual(loadBatchTask('template-import', now + BATCH_TASK_TTL_MS - 1), {
    ...task,
    savedAt: now,
    expiresAt: now + BATCH_TASK_TTL_MS
  });
  assert.equal(loadBatchTask('template-import', now + BATCH_TASK_TTL_MS), null);

  saveBatchTask('template-import', task, now);
  clearBatchTask('template-import');
  assert.equal(loadBatchTask('template-import', now), null);

  delete global.wx;
});
