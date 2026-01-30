const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { inventory_id, updates } = event;

  if (!inventory_id || !updates) {
    return { success: false, msg: 'Missing parameters' };
  }

  try {
     const result = await db.runTransaction(async transaction => {
        // 1. Get current item
        const invRes = await transaction.collection('inventory').doc(inventory_id).get();
        if (!invRes.data) throw new Error('Inventory not found');

        const item = invRes.data;

        // 2. Prepare Update & Diff
        const updateData = {
            ...updates,
            update_time: db.serverDate()
        };

        const logsToAdd = [];

        // --- Diff Logic start ---

        // A. Location Transfer
        if (updates.location && updates.location !== item.location) {
             const oldLoc = item.location || '未知';
             const newLoc = updates.location;
             logsToAdd.push({
                type: 'transfer',
                action: '移库',
                desc: `位置由 [${oldLoc}] 变更为 [${newLoc}]`
             });
        }

        // B. Name Change
        const newName = updates.material_name || updates.internal_standard_name;
        const oldName = item.material_name || item.internal_standard_name;
        if (newName && newName !== oldName) {
             logsToAdd.push({
                 type: 'edit',
                 action: '改名',
                 desc: `名称由 [${oldName}] 变更为 [${newName}]`
             });
        }

        // C. Expiry Change
        // Compare dates string usually or timestamp? Usually string YYYY-MM-DD
        // Assuming updates.expiry_date matches item.expiry_date format
        if (updates.expiry_date && updates.expiry_date !== item.expiry_date) {
             logsToAdd.push({
                 type: 'edit',
                 action: '效期调整',
                 desc: `效期由 [${item.expiry_date || '无'}] 变更为 [${updates.expiry_date}]`
             });
        }

        // D. Production Batch Change
        if (updates.batch_number && updates.batch_number !== item.batch_number) {
             logsToAdd.push({
                 type: 'edit',
                 action: '批号调整',
                 desc: `批号由 [${item.batch_number || '无'}] 变更为 [${updates.batch_number}]`
             });
        }

        // Fallback: Generic edit if no specific logs but updates exist
        if (logsToAdd.length === 0) {
             logsToAdd.push({
                 type: 'edit',
                 action: '编辑',
                 desc: '编辑物料基础信息'
             });
        }

        // --- Diff Logic end ---

        // 3. Update
        await transaction.collection('inventory').doc(inventory_id).update({
            data: updateData
        });

        // 4. Log Batch Insert
        for (let log of logsToAdd) {
             await transaction.collection('inventory_log').add({
                data: {
                    material_id: item.material_id,
                    inventory_id: inventory_id,
                    material_name: item.material_name,
                    category: item.category,
                    product_code: item.product_code,
                    unique_code: item.unique_code,

                    type: log.type,
                    quantity_change: 0,

                    // Fields for display
                    action: log.action, // Custom field, display logic might need update to show this
                    description: log.desc,

                    operator: event.operator_name || 'System',
                    operator_id: OPENID,
                    _openid: OPENID,
                    timestamp: db.serverDate()
                }
            });
        }

        return { success: true };
     });

     return result;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
