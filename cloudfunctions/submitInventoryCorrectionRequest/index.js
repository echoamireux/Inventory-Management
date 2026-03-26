// cloudfunctions/submitInventoryCorrectionRequest/index.js
// 库存纠错申请：用户针对入库记录提交数量纠错
const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { source_log_id, requested_quantity, reason } = event;

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

    // 4. 写入纠错申请
    const correctionRequest = {
      status: 'pending',
      source_log_id: source_log_id,
      inventory_id: sourceLog.inventory_id,
      unique_code: sourceLog.unique_code || inventory.unique_code || '',
      product_code: sourceLog.product_code || inventory.product_code || '',
      category: sourceLog.category || inventory.category || '',
      batch_number: sourceLog.batch_number || inventory.batch_number || '',
      original_quantity: sourceLog.quantity_change,
      requested_quantity: normalizedRequestedQuantity,
      unit: sourceLog.unit || ((inventory.quantity && inventory.quantity.unit) || ''),
      reason: reason || '',
      applicant: OPENID,
      applicant_name: (operator && operator.name) || '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };

    await db.collection('inventory_correction_requests').add({
      data: correctionRequest
    });

    return { success: true, msg: '纠错申请已提交，请等待管理员审批' };

  } catch (err) {
    console.error('SubmitInventoryCorrectionRequest Error:', err);
    return { success: false, msg: '提交失败: ' + err.message };
  }
};
