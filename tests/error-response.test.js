const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCloudErrorResponse,
  isPublicBusinessMessage
} = require('../cloudfunctions/_shared/error-response');

test('cloud error responses preserve known business messages with a stable operation id', () => {
  const error = new Error('库存不足，请刷新后重试');
  const response = buildCloudErrorResponse(error, {
    operationId: 'withdraw_op_001',
    fallbackMessage: '领用失败，请稍后重试'
  });

  assert.equal(isPublicBusinessMessage(error.message), true);
  assert.deepEqual(response, {
    success: false,
    code: 'BUSINESS_ERROR',
    msg: '库存不足，请刷新后重试',
    request_id: 'withdraw_op_001'
  });
});

test('cloud error responses preserve row-scoped batch validation messages', () => {
  const error = new Error('第3条标签编号格式不正确，应为 L + 6位数字');
  const response = buildCloudErrorResponse(error, {
    operationId: 'batchin_op_003',
    fallbackMessage: '批量入库失败，请稍后重试'
  });

  assert.equal(isPublicBusinessMessage(error.message), true);
  assert.equal(response.code, 'BUSINESS_ERROR');
  assert.equal(response.msg, error.message);
  assert.equal(response.request_id, 'batchin_op_003');
});

test('cloud error responses hide technical details and generate a request id', () => {
  const error = new Error('MongoError duplicate key collection inventory index unique_code');
  const response = buildCloudErrorResponse(error, {
    fallbackMessage: '库存操作失败，请稍后重试',
    now: 123456,
    random: () => 0.25
  });

  assert.equal(isPublicBusinessMessage(error.message), false);
  assert.equal(response.success, false);
  assert.equal(response.code, 'INTERNAL_ERROR');
  assert.equal(response.msg, '库存操作失败，请稍后重试');
  assert.match(response.request_id, /^req_/);
  assert.doesNotMatch(JSON.stringify(response), /MongoError|inventory|unique_code/);
});

test('explicit public errors keep their code without relying on message heuristics', () => {
  const error = new Error('custom safe response');
  error.code = 'OPERATION_REQUEST_CHANGED';
  error.expose = true;

  assert.deepEqual(buildCloudErrorResponse(error, { operationId: 'request_op_002' }), {
    success: false,
    code: 'OPERATION_REQUEST_CHANGED',
    msg: 'custom safe response',
    request_id: 'request_op_002'
  });
});
