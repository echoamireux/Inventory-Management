// cloudfunctions/submitInventoryCorrectionRequest/index.js
// 库存纠错申请：用户针对入库记录提交数量纠错
const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded,
  markOperationReceiptFailed
} = require('./operation-receipts');
const { writeAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function runWriteTransaction(handler) {
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(handler);
  }
  return handler(db);
}

function normalizeSourceLogId(value) {
  return String(value == null ? '' : value).trim();
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const source_log_id = normalizeSourceLogId(event.source_log_id);
  const { requested_quantity, reason } = event;

  if (!source_log_id || requested_quantity == null) {
    return { success: false, msg: '缺少必填参数' };
  }

  const normalizedRequestedQuantity = Number(requested_quantity);
  if (!Number.isFinite(normalizedRequestedQuantity) || normalizedRequestedQuantity <= 0) {
    return { success: false, msg: '申请数量必须为有效的正数' };
  }

  try {
    // 1. 鉴权：确认操作者是已激活用户
    const userRes = await db.collection('users')
      .where({ _openid: OPENID })
      .get();
    const operator = userRes.data[0];
    const authResult = assertActiveUserAccess(operator);
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    // 2. 查询源入库日志
    const logRes = await db.collection('inventory_log').doc(source_log_id).get();
    const sourceLog = logRes.data;

    if (!sourceLog) {
      return { success: false, msg: '源日志记录不存在' };
    }

    // 仅允许针对入库记录发起纠错
    if (sourceLog.type !== 'inbound') {
      return { success: false, msg: '仅支持对入库记录发起纠错申请' };
    }

    // 3. 查询关联的库存记录
    const invRes = await db.collection('inventory').doc(sourceLog.inventory_id).get();
    const inventory = invRes.data;

    if (!inventory) {
      return { success: false, msg: '关联库存记录不存在' };
    }

    const operationContext = event.operation_id
      ? buildOperationReceiptContext({
        openid: OPENID,
        operationId: event.operation_id,
        requestPayload: {
          source_log_id,
          requested_quantity: normalizedRequestedQuantity,
          reason: reason || ''
        }
      })
      : null;

    return await runWriteTransaction(async transaction => {
      if (operationContext) {
        const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
        if (operationReceipt.reused) {
          return operationReceipt.response;
        }
      }

      const currentLogRes = await transaction.collection('inventory_log').doc(source_log_id).get();
      const currentLog = currentLogRes.data;
      const currentInventoryRes = currentLog && currentLog.inventory_id
        ? await transaction.collection('inventory').doc(currentLog.inventory_id).get()
        : { data: null };
      const currentInventory = currentInventoryRes.data;
      if (!currentLog || currentLog.type !== 'inbound' || !currentInventory) {
        const response = { success: false, msg: '源入库日志或关联库存记录已变化，请刷新后重试' };
        if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const pendingRes = await transaction.collection('inventory_correction_requests')
        .where({ source_log_id, status: 'pending' })
        .limit(1)
        .get();
      if (pendingRes.data && pendingRes.data.length > 0) {
        const response = { success: false, msg: '该入库记录已有待审批纠错申请，请勿重复提交' };
        if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const correctionRequest = {
        status: 'pending',
        pending_key: source_log_id,
        source_log_id,
        inventory_id: currentLog.inventory_id,
        unique_code: currentLog.unique_code || currentInventory.unique_code || '',
        product_code: currentLog.product_code || currentInventory.product_code || '',
        category: currentLog.category || currentInventory.category || '',
        batch_number: currentLog.batch_number || currentInventory.batch_number || '',
        original_quantity: currentLog.quantity_change,
        requested_quantity: normalizedRequestedQuantity,
        unit: currentLog.unit || ((currentInventory.quantity && currentInventory.quantity.unit) || ''),
        reason: reason || '',
        applicant: OPENID,
        applicant_name: (operator && operator.name) || '',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      };

      let created;
      try {
        created = await transaction.collection('inventory_correction_requests').add({ data: correctionRequest });
      } catch (error) {
        if (/duplicate|unique|唯一|already exists|已存在/i.test(String(error && (error.errMsg || error.message) || ''))) {
          const response = { success: false, msg: '该入库记录已有待审批纠错申请，请勿重复提交' };
          if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
          return response;
        }
        throw error;
      }

      const response = { success: true, msg: '纠错申请已提交，请等待管理员审批', id: created._id };
      await writeAuditEvent(transaction, db, {
        domain: 'inventory_correction',
        action: 'create',
        operator: { _openid: OPENID, name: (operator && operator.name) || '' },
        operationId: operationContext && operationContext.operationId,
        target: { type: 'inventory_correction_request', id: created._id, label: correctionRequest.unique_code },
        after: correctionRequest
      });
      if (operationContext) {
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      }
      return response;
    });

  } catch (err) {
    if (/duplicate|unique|唯一|already exists|已存在/i.test(String(err && (err.errMsg || err.message) || ''))) {
      return { success: false, msg: '该入库记录已有待审批纠错申请，请勿重复提交' };
    }
    return handleCloudError(err, {
      scope: 'submitInventoryCorrectionRequest',
      operationId: event && event.operation_id,
      fallbackMessage: '提交纠错申请失败，请稍后重试'
    });
  }
};
