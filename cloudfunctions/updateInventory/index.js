// cloudfunctions/updateInventory/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 浮点数精度阈值（用于库存量比较）
const EPSILON = 0.001;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { unique_code, product_code, batch_no, withdraw_amount, note } = event;

  // Validate Inputs
  if (!withdraw_amount || Number(withdraw_amount) <= 0) {
      return { success: false, msg: 'Invalid amount' };
  }
  const totalNeed = Number(withdraw_amount);

  try {
    const result = await db.runTransaction(async transaction => {
        let itemsToProcess = [];

        // --- Step 1: Query Items ---
        if (unique_code) {
             // Mode A: Single Item (Scan)
             const res = await transaction.collection('inventory').where({ unique_code }).get();
             if (res.data.length > 0) itemsToProcess.push(res.data[0]);
        } else if (product_code && batch_no) {
             // Mode B: Smart FIFO (Batch Select)
             const res = await transaction.collection('inventory').where({
                 product_code: product_code,
                 batch_number: batch_no
             }).get();

             // Filter for available stock
             itemsToProcess = res.data.filter(i => {
                 const stock = i.category === 'film'
                    ? (i.dynamic_attrs && i.dynamic_attrs.current_length_m)
                    : i.quantity.val;
                 return i.status !== 'used' && stock > 0;
             });

             // Sort: FIFO (Oldest Created First)
             // Optimization: If we had an 'opened' status, sort by that first.
             itemsToProcess.sort((a, b) => {
                 return new Date(a.created_at) - new Date(b.created_at);
             });
        }

        if (itemsToProcess.length === 0) {
            throw new Error('No available inventory found for this selection.');
        }

        // --- Step 2: Calculate & Deduct ---
        let remainingNeed = totalNeed;
        let logs = [];

        for (let item of itemsToProcess) {
            if (remainingNeed <= EPSILON) break;

            // Determine Item Type & Current Stock
            let currentStock = 0;
            let isFilm = item.category === 'film';

            if (isFilm) {
                currentStock = (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
            } else {
                currentStock = item.quantity.val;
            }

            // How much to take from this item?
            let deduct = Math.min(currentStock, remainingNeed);

            // If deduct is negligible (floating point), skip
            if (deduct <= 0) continue;

            let newStock = currentStock - deduct;
            remainingNeed -= deduct;

            // Prepared Update Data
            let updateData = { update_time: db.serverDate() };
            let newStatus = item.status;

            if (isFilm) {
                updateData['dynamic_attrs.current_length_m'] = newStock;
                if (newStock <= 0.1) newStatus = 'used';
            } else {
                updateData['quantity.val'] = newStock;
                if (item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
                    updateData['dynamic_attrs.weight_kg'] = newStock;
                }
                if (newStock <= 0.001) newStatus = 'used';
            }
            updateData.status = newStatus;

            // Execute Update
            await transaction.collection('inventory').doc(item._id).update({ data: updateData });

            // Prepare Log
            logs.push({
                material_id: item.material_id,
                inventory_id: item._id,
                material_name: item.material_name,
                category: item.category,
                product_code: item.product_code,
                unique_code: item.unique_code,
                type: 'outbound',
                quantity_change: -deduct,
                unit: item.quantity.unit || (isFilm ? 'm' : 'kg'),
                operator: event.operator_name || 'System',
                operator_id: OPENID,
                _openid: OPENID,
                timestamp: db.serverDate(),
                description: `${note || '领料'} (系统分配: ${item.unique_code.slice(-6)})`
            });
        }

        if (remainingNeed > EPSILON) {
            // Rollback (throw error rolls back transaction)
            throw new Error(`库存不足，总可用: ${(totalNeed - remainingNeed).toFixed(2)}，需求: ${totalNeed}`);
        }

        // --- Step 3: Write Logs ---
        for (let log of logs) {
            await transaction.collection('inventory_log').add({ data: log });
        }

        // --- Step 4: Calculate Total Remaining (聚合剩余量) ---
        let totalRemaining = 0;
        let unit = 'kg';
        for (let item of itemsToProcess) {
            let isFilm = item.category === 'film';
            let currentStock = 0;

            if (isFilm) {
                currentStock = (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
                unit = 'm';
            } else {
                currentStock = item.quantity.val;
                unit = item.quantity.unit || 'kg';
            }

            // Find the deduction we made for this item from logs
            const logForItem = logs.find(l => l.inventory_id === item._id);
            if (logForItem) {
                currentStock = currentStock + logForItem.quantity_change; // quantity_change is negative
            }

            totalRemaining += currentStock;
        }

        return { success: true, remaining: Number(totalRemaining.toFixed(2)), unit: unit };
    });

    return result;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
