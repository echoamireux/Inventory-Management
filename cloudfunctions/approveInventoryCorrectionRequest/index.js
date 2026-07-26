// cloudfunctions/approveInventoryCorrectionRequest/index.js
// 库存纠错审批：管理员审批或驳回纠错申请
const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');
const {
  isQuantityAffectingLogType,
  resolveLogTimestamp,
  applyChemicalQuantityDelta,
  applyFilmQuantityDelta,
  buildInventoryLogIdentityFields
} = require('./inventory-quantity');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded,
  markOperationReceiptFailed
} = require('./operation-receipts');
const { writeAuditEvent, writeInventoryAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const _ = db.command;

// 审批/驳回后释放 pending 语义。
// 不能用 _.remove() 删除字段：云开发唯一索引把「字段不存在」视为 null，且明确
// 「不允许存在两个或以上的该字段为空/不存在该字段的记录」，而控制台并不提供
// sparse 选项。若移除字段，第二条被处理的申请就会撞 duplicate key 导致审批失败。
// 改为写入以记录 _id 为基础的唯一占位值，既解除 pending 占位又维持索引唯一性。
function clearPendingKeyUpdate(requestId) {
  return { pending_key: `done:${requestId}` };
}

function applyStableOrder(query, sorts = []) {
  return sorts.reduce((current, [field, direction]) => (
    current && typeof current.orderBy === 'function'
      ? current.orderBy(field, direction)
      : current
  ), query);
}

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .get();

  return res.data && res.data[0] ? res.data[0] : null;
}

const LATER_LOG_PAGE_SIZE = 100;
// 事务内持锁期间的分页上限。达到上限说明该库存的数量变更日志异常多，
// 此时保守判定为"存在后续操作"并拒绝自动纠错，而不是继续扩大事务范围。
const LATER_LOG_MAX_PAGES = 20;

/**
 * 判断源入库日志之后是否还有影响数量的业务操作。
 *
 * 只做存在性判断，因此逐页扫描、命中即返回，不再把该库存的全部日志
 * 累积进内存后再统一判断，缩短事务持锁时间。
 *
 * 判定本身仍走 resolveLogTimestamp / isQuantityAffectingLogType，
 * 保留其对缺失时间戳（回退 create_time）和日志类型大小写的归一化语义 ——
 * 这两者无法用数据库查询等价表达，故不下推到 where 条件。
 */
async function hasLaterQuantityAffectingLog(transaction, inventoryId, sourceLog, sourceTimestamp) {
  let skip = 0;

  for (let page = 0; page < LATER_LOG_MAX_PAGES; page += 1) {
    const query = transaction.collection('inventory_log')
      .where({ inventory_id: inventoryId });
    const res = await applyStableOrder(query, [
      ['timestamp', 'asc'],
      ['_id', 'asc']
    ])
      .skip(skip)
      .limit(LATER_LOG_PAGE_SIZE)
      .get();

    const batch = res.data || [];
    const hit = batch.some((log) => {
      if (!log || log._id === sourceLog._id) {
        return false;
      }
      return resolveLogTimestamp(log) > sourceTimestamp && isQuantityAffectingLogType(log.type);
    });
    if (hit) {
      return true;
    }
    if (batch.length < LATER_LOG_PAGE_SIZE) {
      return false;
    }
    skip += LATER_LOG_PAGE_SIZE;
  }

  return true;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { request_id, action, reject_reason } = event;

  if (!request_id || !action) {
    return { success: false, msg: '缺少必填参数' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertAdminMutationAccess(operator, '仅管理员可审批库存纠错');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }
    if (!['approve', 'reject'].includes(action)) {
      return { success: false, msg: '未知操作类型' };
    }

    const result = await db.runTransaction(async (transaction) => {
      const requestRef = transaction.collection('inventory_correction_requests').doc(request_id);
      const requestRes = await requestRef.get();
      const correctionRequest = requestRes.data;

      if (!correctionRequest) {
        return { success: false, msg: '纠错申请不存在' };
      }

      const operationContext = buildOperationReceiptContext({
        openid: OPENID,
        operationId: event.operation_id,
        requestPayload: {
          request_id,
          action,
          reject_reason: reject_reason || ''
        }
      });
      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      if (correctionRequest.status !== 'pending') {
        const response = { success: false, msg: '该申请已被处理过' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      if (action === 'reject') {
        await requestRef.update({
          data: {
            status: 'rejected',
            ...clearPendingKeyUpdate(request_id),
            reject_reason: reject_reason || '',
            operator_id: OPENID,
            operator_name: (operator && operator.name) || 'Admin',
            updated_at: db.serverDate()
          }
        });
        await writeAuditEvent(transaction, db, {
          domain: 'inventory_correction',
          action: 'reject',
          operator: Object.assign({}, operator || {}, { _openid: OPENID }),
          operationId: operationContext.operationId,
          target: {
            type: 'inventory_correction_request',
            id: request_id,
            label: correctionRequest.unique_code || correctionRequest.inventory_id || ''
          },
          detail: {
            inventory_id: correctionRequest.inventory_id,
            product_code: correctionRequest.product_code || '',
            unique_code: correctionRequest.unique_code || '',
            reject_reason: reject_reason || ''
          }
        });

        const response = { success: true, msg: '已驳回' };
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
        return response;
      }

      const sourceLogRes = await transaction.collection('inventory_log')
        .doc(correctionRequest.source_log_id)
        .get();
      const sourceLog = sourceLogRes.data;

      if (!sourceLog) {
        const response = { success: false, msg: '源入库日志不存在' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const inventoryRes = await transaction.collection('inventory')
        .doc(correctionRequest.inventory_id)
        .get();
      const inventory = inventoryRes.data;

      if (!inventory) {
        const response = { success: false, msg: '关联库存记录不存在' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }
      if (inventory.status !== 'in_stock') {
        const response = { success: false, msg: '仅在库库存允许审批纠错' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const sourceTimestamp = resolveLogTimestamp(sourceLog);
      const hasLaterQuantityLogs = await hasLaterQuantityAffectingLog(
        transaction,
        correctionRequest.inventory_id,
        sourceLog,
        sourceTimestamp
      );

      if (hasLaterQuantityLogs) {
        const response = {
          success: false,
          msg: '该入库记录之后已有后续业务操作（领用/补料/调整），无法直接纠错，请手动处理'
        };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const originalQuantity = Number(correctionRequest.original_quantity);
      const requestedQuantity = Number(correctionRequest.requested_quantity);
      const delta = requestedQuantity - originalQuantity;
      const category = correctionRequest.category || inventory.category;
      let updateData;

      if (category === 'film') {
        updateData = applyFilmQuantityDelta(inventory, delta).updateData;
      } else {
        updateData = applyChemicalQuantityDelta(inventory, delta).updateData;
      }

      await transaction.collection('inventory').doc(correctionRequest.inventory_id).update({
        data: {
          ...updateData,
          update_time: db.serverDate()
        }
      });

      const unit = correctionRequest.unit || '';
      const correctionLog = {
          material_id: inventory.material_id || '',
          inventory_id: correctionRequest.inventory_id,
          material_name: inventory.material_name || '',
          category,
          product_code: correctionRequest.product_code || inventory.product_code || '',
          unique_code: correctionRequest.unique_code || inventory.unique_code || '',
          ...buildInventoryLogIdentityFields(inventory),
          type: 'adjust',
          quantity_change: delta,
          spec_change_unit: unit,
          unit,
          action: 'inventory_correction',
          description: `库存纠错：原数量 ${correctionRequest.original_quantity} ${unit}，申请数量 ${correctionRequest.requested_quantity} ${unit}，差额 ${delta} ${unit}；原因：${correctionRequest.reason || '未填写'}`,
          operator: (operator && operator.name) || 'Admin',
          operator_id: OPENID,
          _openid: OPENID,
          correction_request_id: request_id,
          timestamp: db.serverDate()
      };
      await transaction.collection('inventory_log').add({ data: correctionLog });
      await writeInventoryAuditEvent(transaction, db, correctionLog, {
        operationId: operationContext.operationId
      });

      await requestRef.update({
        data: {
          status: 'approved',
          ...clearPendingKeyUpdate(request_id),
          operator_id: OPENID,
          operator_name: (operator && operator.name) || 'Admin',
          updated_at: db.serverDate()
        }
      });
      await writeAuditEvent(transaction, db, {
        domain: 'inventory_correction',
        action: 'approve',
        operator: Object.assign({}, operator || {}, { _openid: OPENID }),
        operationId: operationContext.operationId,
        target: {
          type: 'inventory_correction_request',
          id: request_id,
          label: correctionRequest.unique_code || correctionRequest.inventory_id || ''
        },
        detail: {
          inventory_id: correctionRequest.inventory_id,
          product_code: correctionRequest.product_code || inventory.product_code || '',
          unique_code: correctionRequest.unique_code || inventory.unique_code || '',
          original_quantity: correctionRequest.original_quantity,
          requested_quantity: correctionRequest.requested_quantity,
          unit,
          reason: correctionRequest.reason || ''
        }
      });

      const response = { success: true, msg: '纠错已通过，库存已更新' };
      await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      return response;
    });

    return result;
  } catch (err) {
    return handleCloudError(err, {
      scope: 'approveInventoryCorrectionRequest',
      operationId: event && event.operation_id,
      fallbackMessage: '审批库存纠错失败，请稍后重试'
    });
  }
};
