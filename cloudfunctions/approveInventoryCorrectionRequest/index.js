// cloudfunctions/approveInventoryCorrectionRequest/index.js
// 库存纠错审批：管理员审批或驳回纠错申请
const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');
const {
  isQuantityAffectingLogType,
  resolveLogTimestamp,
  applyChemicalQuantityDelta,
  applyFilmQuantityDelta
} = require('./inventory-quantity');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .get();

  return res.data && res.data[0] ? res.data[0] : null;
}

async function loadAllInventoryLogs(transaction, inventoryId) {
  const rows = [];
  let skip = 0;

  while (true) {
    const res = await transaction.collection('inventory_log')
      .where({ inventory_id: inventoryId })
      .skip(skip)
      .limit(100)
      .get();

    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < 100) {
      break;
    }
    skip += 100;
  }

  return rows;
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

    const result = await db.runTransaction(async (transaction) => {
      const requestRef = transaction.collection('inventory_correction_requests').doc(request_id);
      const requestRes = await requestRef.get();
      const correctionRequest = requestRes.data;

      if (!correctionRequest) {
        return { success: false, msg: '纠错申请不存在' };
      }

      if (correctionRequest.status !== 'pending') {
        return { success: false, msg: '该申请已被处理过' };
      }

      if (action === 'reject') {
        await requestRef.update({
          data: {
            status: 'rejected',
            reject_reason: reject_reason || '',
            operator_id: OPENID,
            operator_name: (operator && operator.name) || 'Admin',
            updated_at: db.serverDate()
          }
        });

        return { success: true, msg: '已驳回' };
      }

      if (action !== 'approve') {
        return { success: false, msg: '未知操作类型' };
      }

      const sourceLogRes = await transaction.collection('inventory_log')
        .doc(correctionRequest.source_log_id)
        .get();
      const sourceLog = sourceLogRes.data;

      if (!sourceLog) {
        return { success: false, msg: '源入库日志不存在' };
      }

      const inventoryRes = await transaction.collection('inventory')
        .doc(correctionRequest.inventory_id)
        .get();
      const inventory = inventoryRes.data;

      if (!inventory) {
        return { success: false, msg: '关联库存记录不存在' };
      }

      const allLogs = await loadAllInventoryLogs(transaction, correctionRequest.inventory_id);
      const sourceTimestamp = resolveLogTimestamp(sourceLog);
      const hasLaterQuantityLogs = allLogs.some((log) => {
        if (!log || log._id === sourceLog._id) {
          return false;
        }

        const logTimestamp = resolveLogTimestamp(log);
        return logTimestamp > sourceTimestamp && isQuantityAffectingLogType(log.type);
      });

      if (hasLaterQuantityLogs) {
        return {
          success: false,
          msg: '该入库记录之后已有后续业务操作（领用/补料/调整），无法直接纠错，请手动处理'
        };
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
      await transaction.collection('inventory_log').add({
        data: {
          material_id: inventory.material_id || '',
          inventory_id: correctionRequest.inventory_id,
          material_name: inventory.material_name || '',
          category,
          product_code: correctionRequest.product_code || inventory.product_code || '',
          unique_code: correctionRequest.unique_code || inventory.unique_code || '',
          type: 'adjust',
          quantity_change: delta,
          spec_change_unit: unit,
          unit,
          action: '库存纠错',
          description: `库存纠错：原数量 ${correctionRequest.original_quantity} ${unit}，申请数量 ${correctionRequest.requested_quantity} ${unit}，差额 ${delta} ${unit}；原因：${correctionRequest.reason || '未填写'}`,
          operator: (operator && operator.name) || 'Admin',
          operator_id: OPENID,
          _openid: OPENID,
          correction_request_id: request_id,
          timestamp: db.serverDate()
        }
      });

      await requestRef.update({
        data: {
          status: 'approved',
          operator_id: OPENID,
          operator_name: (operator && operator.name) || 'Admin',
          updated_at: db.serverDate()
        }
      });

      return { success: true, msg: '纠错已通过，库存已更新' };
    });

    return result;
  } catch (err) {
    console.error('ApproveInventoryCorrectionRequest Error:', err);
    return { success: false, msg: '操作失败: ' + err.message };
  }
};
