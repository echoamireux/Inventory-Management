const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function loadInventoryIdsByMaterialId(materialId, pageSize = 100) {
  if (!materialId) {
    return [];
  }

  const ids = [];
  let skip = 0;

  while (true) {
    const res = await db.collection('inventory')
      .where({ material_id: materialId })
      .skip(skip)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    ids.push(...batch.map(item => item._id).filter(Boolean));
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return ids;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { material_id, inventory_id, operator_name } = event;

  if (!material_id && !inventory_id) {
    return { success: false, msg: 'Missing material_id and inventory_id' };
  }

  try {
    const preAuthRes = await db.collection('users').where({ _openid: OPENID }).get();
    const preAuthResult = assertAdminMutationAccess((preAuthRes.data || [])[0], 'Permission denied: Admin only');
    if (!preAuthResult.ok) {
      throw new Error(preAuthResult.msg);
    }

    const inventoryIdsForMaterial = material_id && !inventory_id
      ? await loadInventoryIdsByMaterialId(material_id)
      : [];

    const transactionResult = await db.runTransaction(async transaction => {
      const userRes = await transaction.collection('users').where({ _openid: OPENID }).get();
      const currentUser = userRes.data[0];
      const authResult = assertAdminMutationAccess(currentUser, 'Permission denied: Admin only');
      if (!authResult.ok) {
        throw new Error(authResult.msg);
      }

      let materialName = 'Unknown Material';
      let affectedInventoryCount = 0;

      if (material_id) {
        const materialRes = await transaction.collection('materials').doc(material_id).get();
        if (materialRes.data) {
          materialName = materialRes.data.material_name || materialRes.data.name || materialName;
          await transaction.collection('materials').doc(material_id).update({
            data: { status: 'deleted', update_time: db.serverDate() }
          });
        }
      }

      if (inventory_id) {
        if (materialName === 'Unknown Material') {
          const invRes = await transaction.collection('inventory').doc(inventory_id).get();
          if (invRes.data) {
            materialName = invRes.data.material_name || materialName;
          }
        }
        await transaction.collection('inventory').doc(inventory_id).update({
          data: { status: 'deleted', update_time: db.serverDate() }
        });
        affectedInventoryCount = 1;
      } else if (material_id) {
        for (const id of inventoryIdsForMaterial) {
          await transaction.collection('inventory').doc(id).update({
            data: { status: 'deleted', update_time: db.serverDate() }
          });
        }
        affectedInventoryCount = inventoryIdsForMaterial.length;
      }

      await transaction.collection('inventory_log').add({
        data: {
          type: 'delete',
          material_id: material_id || 'N/A',
          inventory_id: inventory_id || 'N/A',
          material_name: materialName,
          quantity_change: 0,
          operator: operator_name || 'Admin',
          operator_id: OPENID,
          _openid: OPENID,
          affected_inventory_count: affectedInventoryCount,
          timestamp: db.serverDate(),
          description: material_id
            ? `管理员删除物料，影响库存标签 ${affectedInventoryCount} 个`
            : '管理员删除库存标签'
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
