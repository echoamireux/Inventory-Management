const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { material_id, inventory_id } = event;

  if (!inventory_id) {
    return {
      success: false,
      msg: material_id
        ? '不再支持整物料删除，请通过盘点审批按库存标签纠错'
        : '仅支持按库存标签执行纠错'
    };
  }

  try {
    const preAuthRes = await db.collection('users').where({ _openid: OPENID }).get();
    const preAuthResult = assertAdminMutationAccess((preAuthRes.data || [])[0], 'Permission denied: Admin only');
    if (!preAuthResult.ok) {
      throw new Error(preAuthResult.msg);
    }

    const transactionResult = await db.runTransaction(async transaction => {
      const userRes = await transaction.collection('users').where({ _openid: OPENID }).get();
      const currentUser = userRes.data[0];
      const authResult = assertAdminMutationAccess(currentUser, 'Permission denied: Admin only');
      if (!authResult.ok) {
        throw new Error(authResult.msg);
      }

      const invRes = await transaction.collection('inventory').doc(inventory_id).get();
      if (!invRes.data) {
        throw new Error('库存标签不存在');
      }
      const inventory = invRes.data;
      const resolvedMaterialId = inventory.material_id || material_id || 'N/A';
      const materialName = inventory.material_name || 'Unknown Material';

      await transaction.collection('inventory').doc(inventory_id).update({
        data: { status: 'deleted', update_time: db.serverDate() }
      });

      await transaction.collection('inventory_log').add({
        data: {
          type: 'delete',
          material_id: resolvedMaterialId,
          inventory_id,
          material_name: materialName,
          quantity_change: 0,
          operator: currentUser.name || 'Admin',
          operator_id: OPENID,
          _openid: OPENID,
          affected_inventory_count: 1,
          timestamp: db.serverDate(),
          description: '管理员按库存标签执行纠错删除'
        }
      });

      return { success: true };
    });

    return transactionResult;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
