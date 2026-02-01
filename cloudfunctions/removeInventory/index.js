const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { material_id, inventory_id, operator_name } = event;

  if (!material_id && !inventory_id) {
    return { success: false, msg: 'Missing material_id and inventory_id' };
  }

  try {
    const transactionResult = await db.runTransaction(async transaction => {
      // 0. Permission Check (Inside Transaction or Before)
      // Since transaction requires all ops to be inside, and we need to read 'users', let's do it inside.
      const userRes = await transaction.collection('users').where({ _openid: OPENID }).get();
      const currentUser = userRes.data[0];
      if (!currentUser || currentUser.role !== 'admin') {
          throw new Error('Permission denied: Admin only');
      }

      let materialName = 'Unknown Material';

      // 1. Try to get material info if material_id exists
      if (material_id) {
        const materialRes = await transaction.collection('materials').doc(material_id).get();
        if (materialRes.data) {
          materialName = materialRes.data.name;
          // Soft delete material
          await transaction.collection('materials').doc(material_id).update({
            data: { status: 'deleted', update_time: db.serverDate() }
          });
        }
      }

      // 2. Soft delete inventory (using inventory_id or material_id)
      // 修复: 先读取再更新，避免事务中先 update 后 get 的潜在问题
      if (inventory_id) {
        // 先获取 inventory 信息（在更新之前）
        if (materialName === 'Unknown Material') {
           const invRes = await transaction.collection('inventory').doc(inventory_id).get();
           if (invRes.data) materialName = invRes.data.material_name || materialName;
        }
        // 再执行软删除
        await transaction.collection('inventory').doc(inventory_id).update({
          data: { status: 'deleted', update_time: db.serverDate() }
        });
      } else if (material_id) {
        await transaction.collection('inventory').where({ material_id: material_id }).update({
          data: { status: 'deleted', update_time: db.serverDate() }
        });
      }

      // 3. Log
      await transaction.collection('inventory_log').add({
        data: {
          type: 'delete',
          material_id: material_id || 'N/A',
          inventory_id: inventory_id || 'N/A',
          material_name: materialName,
          quantity_change: 0,
          operator: operator_name || 'Admin',
          operator_id: OPENID,
          _openid: OPENID, // Ensure openid is recorded
          timestamp: db.serverDate(),
          description: '管理员删除物料' + (material_id ? '' : ' (仅库存)')
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
