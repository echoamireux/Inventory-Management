function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const normalizedValue = stableNormalize(value[key]);
        if (normalizedValue !== undefined && typeof normalizedValue !== 'function') {
          acc[key] = normalizedValue;
        }
        return acc;
      }, {});
  }
  if (typeof value === 'function' || value === undefined) {
    return undefined;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value || {}));
}

function createOperationId(prefix = 'op') {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${now}_${random}`;
}

function getStorage() {
  if (typeof wx === 'undefined') {
    return null;
  }
  return wx;
}

function ensureOperationId(scope, payload, prefix = 'op') {
  const storage = getStorage();
  const storageKey = `operation_id:${scope}`;
  const signature = stableStringify(payload);
  if (storage && storage.getStorageSync && storage.setStorageSync) {
    const cached = storage.getStorageSync(storageKey);
    if (cached && cached.id && cached.signature === signature) {
      return cached.id;
    }
    const id = createOperationId(prefix);
    storage.setStorageSync(storageKey, { id, signature });
    return id;
  }
  return createOperationId(prefix);
}

function clearOperationId(scope) {
  const storage = getStorage();
  if (storage && storage.removeStorageSync) {
    storage.removeStorageSync(`operation_id:${scope}`);
  }
}

module.exports = {
  stableStringify,
  createOperationId,
  ensureOperationId,
  clearOperationId
};
