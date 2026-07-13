const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stableStringify,
  normalizeOperationId,
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded
} = require('../cloudfunctions/_shared/operation-receipts');

test('operation receipt signatures are stable across object key order', () => {
  assert.equal(
    stableStringify({ b: 2, a: { d: 4, c: 3 } }),
    stableStringify({ a: { c: 3, d: 4 }, b: 2 })
  );
});

test('operation receipt ids require a stable client operation id', () => {
  assert.equal(normalizeOperationId('stock-in_20260713'), 'stock-in_20260713');
  assert.throws(() => normalizeOperationId(''), /缺少操作编号/);
  assert.throws(() => normalizeOperationId('短'), /格式不正确/);
});

test('operation receipt context uses operator plus operation id and detects request changes', async () => {
  const context = buildOperationReceiptContext({
    openid: 'openid-1',
    operationId: 'op_20260713_0001',
    requestPayload: { unique_code: 'L000001', quantity: 1 }
  });
  const sameContext = buildOperationReceiptContext({
    openid: 'openid-1',
    operationId: 'op_20260713_0001',
    requestPayload: { quantity: 1, unique_code: 'L000001' }
  });
  const changedContext = buildOperationReceiptContext({
    openid: 'openid-1',
    operationId: 'op_20260713_0001',
    requestPayload: { unique_code: 'L000001', quantity: 2 }
  });

  assert.equal(context.receiptId, sameContext.receiptId);
  assert.equal(context.requestSignature, sameContext.requestSignature);
  assert.notEqual(context.requestSignature, changedContext.requestSignature);

  const receiptStore = new Map();
  const db = {
    serverDate() {
      return { $date: true };
    }
  };
  const transaction = {
    collection(name) {
      assert.equal(name, 'operation_receipts');
      return {
        doc(id) {
          return {
            async get() {
              return { data: receiptStore.get(id) || null };
            },
            async set({ data }) {
              receiptStore.set(id, { ...data });
            },
            async update({ data }) {
              receiptStore.set(id, { ...receiptStore.get(id), ...data });
            }
          };
        }
      };
    }
  };

  const first = await beginOperationReceipt(transaction, db, context);
  assert.equal(first.reused, false);

  const response = { success: true, inventoryId: 'inv-1' };
  await markOperationReceiptSucceeded(transaction, db, context, response);
  const repeated = await beginOperationReceipt(transaction, db, sameContext);
  assert.deepEqual(repeated, { reused: true, response });

  await assert.rejects(
    () => beginOperationReceipt(transaction, db, changedContext),
    /请求内容已变化/
  );
});
