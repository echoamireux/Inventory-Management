const MAX_BATCH_CHUNK_SIZE = 10;
const BATCH_TASK_TTL_MS = 24 * 60 * 60 * 1000;

function getStorage() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
    return null;
  }
  return wx;
}

function getTaskStorageKey(scope) {
  return `batch_task:${String(scope || '').trim()}`;
}

function splitBatchItems(items = [], chunkSize = MAX_BATCH_CHUNK_SIZE) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const normalizedSize = Math.max(1, Number(chunkSize) || MAX_BATCH_CHUNK_SIZE);
  const chunks = [];

  for (let start = 0; start < items.length; start += normalizedSize) {
    const chunkItems = items.slice(start, start + normalizedSize);
    chunks.push({
      chunkIndex: chunks.length,
      items: chunkItems,
      rowIndexes: chunkItems.map((item, offset) => {
        const explicitIndex = Number(item && (item.rowIndex || item.row_index));
        return Number.isInteger(explicitIndex) && explicitIndex > 0
          ? explicitIndex
          : start + offset + 1;
      })
    });
  }

  return chunks;
}

function buildChunkOperationId(rootOperationId, chunkIndex) {
  const root = String(rootOperationId || '').trim();
  if (!root) {
    throw new Error('缺少批量任务操作号');
  }
  return `${root}:chunk:${Number(chunkIndex) || 0}`;
}

function getErrorMessage(error) {
  return String(error && error.message || error || '批次处理失败');
}

async function runChunkedBatchTask({
  items = [],
  rootOperationId,
  completedChunkIndexes = [],
  submitChunk,
  onProgress
} = {}) {
  if (typeof submitChunk !== 'function') {
    throw new TypeError('submitChunk 必须是函数');
  }

  const chunks = splitBatchItems(items);
  const completedSet = new Set(
    (Array.isArray(completedChunkIndexes) ? completedChunkIndexes : [])
      .map(index => Number(index))
      .filter(index => Number.isInteger(index) && index >= 0)
  );
  const results = [];
  let failed = [];
  let pending = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (completedSet.has(chunk.chunkIndex)) {
      results.push({
        chunk_index: chunk.chunkIndex,
        row_indexes: chunk.rowIndexes,
        status: 'completed',
        reused: true
      });
      continue;
    }

    try {
      const response = await submitChunk({
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunks.length,
        operationId: buildChunkOperationId(rootOperationId, chunk.chunkIndex),
        items: chunk.items,
        rowIndexes: chunk.rowIndexes
      });

      if (!response || response.success === false) {
        throw new Error(response && response.msg || '批次处理失败');
      }

      results.push({
        chunk_index: chunk.chunkIndex,
        row_indexes: chunk.rowIndexes,
        status: 'completed',
        response
      });
      if (typeof onProgress === 'function') {
        onProgress(results[results.length - 1]);
      }
    } catch (error) {
      failed = [{
        chunk_index: chunk.chunkIndex,
        row_indexes: chunk.rowIndexes,
        msg: getErrorMessage(error)
      }];
      pending = chunks.slice(index + 1).map(item => item.chunkIndex);
      results.push({
        chunk_index: chunk.chunkIndex,
        row_indexes: chunk.rowIndexes,
        status: 'failed',
        msg: failed[0].msg
      });
      if (typeof onProgress === 'function') {
        onProgress(results[results.length - 1]);
      }
      break;
    }
  }

  const succeeded = results
    .filter(item => item.status === 'completed')
    .reduce((total, item) => total + item.row_indexes.length, 0);
  const status = failed.length === 0 && pending.length === 0
    ? 'completed'
    : (succeeded > 0 ? 'partial' : 'failed');

  return {
    success: status === 'completed',
    status,
    total: chunks.reduce((total, chunk) => total + chunk.items.length, 0),
    succeeded,
    failed,
    pending,
    chunks: results
  };
}

function saveBatchTask(scope, task, now = Date.now()) {
  const storage = getStorage();
  const normalizedScope = String(scope || '').trim();
  if (!storage || !normalizedScope || !task || typeof task !== 'object') {
    return false;
  }

  const value = {
    ...task,
    savedAt: now,
    expiresAt: now + BATCH_TASK_TTL_MS
  };
  storage.setStorageSync(getTaskStorageKey(normalizedScope), value);
  return true;
}

function loadBatchTask(scope, now = Date.now()) {
  const storage = getStorage();
  const normalizedScope = String(scope || '').trim();
  if (!storage || !normalizedScope) {
    return null;
  }

  const key = getTaskStorageKey(normalizedScope);
  const value = storage.getStorageSync(key);
  if (!value || !value.expiresAt || value.expiresAt <= now) {
    if (value && typeof storage.removeStorageSync === 'function') {
      storage.removeStorageSync(key);
    }
    return null;
  }
  return value;
}

function clearBatchTask(scope) {
  const storage = getStorage();
  const normalizedScope = String(scope || '').trim();
  if (!storage || !normalizedScope || typeof storage.removeStorageSync !== 'function') {
    return false;
  }
  storage.removeStorageSync(getTaskStorageKey(normalizedScope));
  return true;
}

module.exports = {
  MAX_BATCH_CHUNK_SIZE,
  BATCH_TASK_TTL_MS,
  splitBatchItems,
  buildChunkOperationId,
  runChunkedBatchTask,
  saveBatchTask,
  loadBatchTask,
  clearBatchTask
};
