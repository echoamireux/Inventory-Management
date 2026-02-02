// cloudfunctions/updateInventory/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 浮点数精度阈值（用于库存量比较）
const EPSILON = 0.001;
const PRECISION = 1000; // 3 decimal places for calculation safety

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
             // FIX: used 'created_at' which is undefined. Changed to 'create_time'.
             itemsToProcess.sort((a, b) => {
                 // Handle serverDate() or Date object or timestamp
                 const dateA = a.create_time instanceof Date ? a.create_time : new Date(a.create_time);
                 const dateB = b.create_time instanceof Date ? b.create_time : new Date(b.create_time);
                 return dateA - dateB;
             });
        }

        if (itemsToProcess.length === 0) {
            throw new Error('No available inventory found for this selection.');
        }

        // --- Step 2: Calculate & Deduct ---
        let remainingNeed = totalNeed;
        let logs = [];
        // 修复: 记录每个 item 扣减后的新库存值，用于步骤4计算
        let newStockMap = new Map();

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

            // Fix Floating Point: Round to avoid 0.00000001 issues
            deduct = Math.floor(deduct * PRECISION) / PRECISION;

            // If deduct is negligible (floating point), skip
            if (deduct <= 0) continue;

            let newStock = currentStock - deduct;
            // Fix: Clean up newStock precision
            newStock = Math.round(newStock * PRECISION) / PRECISION;

            remainingNeed -= deduct;
            // Fix: Clean up remainingNeed precision to prevent loop sticking
            remainingNeed = Math.round(remainingNeed * PRECISION) / PRECISION;

            // 修复: 存储新库存值
            newStockMap.set(item._id, { newStock, isFilm, unit: item.quantity.unit });

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
        // 修复: 直接使用 newStockMap 中存储的新库存值，而非从原始 item 重新计算
        let totalRemaining = 0;
        let unit = 'kg';

        for (let item of itemsToProcess) {
            const stockInfo = newStockMap.get(item._id);
            if (stockInfo) {
                // 已处理的 item，使用新库存值
                totalRemaining += stockInfo.newStock;
                unit = stockInfo.isFilm ? 'm' : (stockInfo.unit || 'kg');
            } else {
                // 未处理的 item（库存充足时提前退出循环），使用原始值
                let isFilm = item.category === 'film';
                if (isFilm) {
                    totalRemaining += (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
                    unit = 'm';
                } else {
                    totalRemaining += item.quantity.val;
                    unit = item.quantity.unit || 'kg';
                }
            }
        }

        return { success: true, remaining: Number(totalRemaining.toFixed(2)), unit: unit };
    });

    return result;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
