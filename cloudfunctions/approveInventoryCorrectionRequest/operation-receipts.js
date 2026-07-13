const crypto = require('node:crypto');

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const normalizedValue = stableNormalize(value[key]);
        if (normalizedValue !== undefined) {
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
  return JSON.stringify(stableNormalize(value));
}

function hashText(text, length = 64) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, length);
}

function normalizeOperationId(operationId) {
  const normalized = normalizeText(operationId);
  if (!normalized) {
    throw new Error('缺少操作编号，请刷新页面后重试');
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) {
    throw new Error('操作编号格式不正确，请刷新页面后重试');
  }
  return normalized;
}

function buildOperationReceiptContext({ openid, operationId, requestPayload }) {
  const operatorId = normalizeText(openid);
  if (!operatorId) {
    throw new Error('缺少操作者身份，请重新登录');
  }
  const normalizedOperationId = normalizeOperationId(operationId);
  const requestSignature = hashText(stableStringify(requestPayload || {}));
  const receiptId = hashText(`${operatorId}:${normalizedOperationId}`);

  return {
    receiptId,
    operationId: normalizedOperationId,
    operatorId,
    requestSignature
  };
}

function createRequestChangedError() {
  const error = new Error('同一操作编号的请求内容已变化，请刷新页面后重新提交');
  error.code = 'OPERATION_REQUEST_CHANGED';
  return error;
}

async function beginOperationReceipt(transaction, db, context) {
  const receiptRef = transaction.collection('operation_receipts').doc(context.receiptId);
  let receipt = null;
  try {
    const receiptRes = await receiptRef.get();
    receipt = receiptRes && receiptRes.data ? receiptRes.data : null;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!/not\s*found|document.*not.*exist|不存在/i.test(message)) {
      throw error;
    }
  }

  if (receipt) {
    if (receipt.request_signature !== context.requestSignature) {
      throw createRequestChangedError();
    }
    if (receipt.status === 'succeeded' && receipt.response) {
      return {
        reused: true,
        response: receipt.response
      };
    }
    throw new Error('该操作正在处理中，请稍后重试');
  }

  await receiptRef.set({
    data: {
      _id: context.receiptId,
      operation_id: context.operationId,
      operator_id: context.operatorId,
      request_signature: context.requestSignature,
      status: 'processing',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    reused: false,
    response: null
  };
}

async function markOperationReceiptSucceeded(transaction, db, context, response) {
  await transaction.collection('operation_receipts').doc(context.receiptId).update({
    data: {
      status: 'succeeded',
      response,
      updated_at: db.serverDate()
    }
  });
}

module.exports = {
  stableStringify,
  normalizeOperationId,
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded
};
