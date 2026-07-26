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

// 操作编号的复用时效。
//
// 编号缓存在持久化 storage 里，刷新页面或重启小程序都不会清除。业务失败时前端会
// 主动清掉编号，但存在一个够不着的场景：后端已写入失败回执，响应却因网络断开没能
// 送达客户端 —— 此时前端走的是「网络异常」分支，按设计不清除编号（因为请求也可能
// 是成功的，保留编号才能靠幂等回执取回首次结果）。于是用户重试时仍用同一个编号，
// 后端把那条 failed 回执当作幂等结果返回，除非改内容或清缓存，否则一直卡在旧失败上。
//
// 加一个时效即可自愈：短时间内的重试继续复用编号，幂等保护不受影响；超过时效说明
// 用户是隔了一段时间重新发起，此时更可能是想重新提交而非期待幂等结果。
// 30 分钟远长于「响应丢失后立即重试」的窗口，不会削弱正常的幂等保护。
const OPERATION_ID_TTL_MS = 30 * 60 * 1000;

function ensureOperationId(scope, payload, prefix = 'op') {
  const storage = getStorage();
  const storageKey = `operation_id:${scope}`;
  const signature = stableStringify(payload);
  if (storage && storage.getStorageSync && storage.setStorageSync) {
    const cached = storage.getStorageSync(storageKey);
    const now = Date.now();
    if (cached && cached.id && cached.signature === signature) {
      const createdAt = Number(cached.createdAt);
      if (!Number.isFinite(createdAt)) {
        // 早期版本写入的缓存没有时间戳。补上后继续沿用，不立即作废 ——
        // 否则升级瞬间正在进行中的操作会丢掉幂等保护。
        storage.setStorageSync(storageKey, { ...cached, createdAt: now });
        return cached.id;
      }
      if (now - createdAt < OPERATION_ID_TTL_MS) {
        return cached.id;
      }
      // 已超时：落到下面重新生成，使卡在旧失败回执上的重试得以自愈
    }
    const id = createOperationId(prefix);
    storage.setStorageSync(storageKey, { id, signature, createdAt: now });
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
