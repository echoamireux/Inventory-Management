// cloudfunctions/batchAddInventory/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { items, operator_name } = event;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, msg: 'No items provided' };
  }

  const results = [];
  const errors = [];
  const valid_items = [];

  try {
      // 1. Prepare items
      const createTime = new Date();

      for (let item of items) {
          // Basic validation
          if (!item.material_id || !item.material_name) {
              errors.push({ item, msg: 'Missing material info' });
              continue;
          }

          valid_items.push({
              ...item,
              create_time: createTime,
              update_time: createTime,
              status: 'in_stock',
              // Ensure numeric types
              quantity: {
                  val: Number(item.quantity.val),
                  unit: item.quantity.unit
              },
              // Logs entry (optional, maybe handle in trigger or separate log collection)
          });
      }

      // 2. Batch Insert (Limit 1000 in separate calls if needed, but here likely small batches < 20)
      // Cloud DB add() is single item, unlikely supports bulk add for collections in standard SDK easily?
      // Actually standard SDK `collection.add` only supports single item?
      // Wait, server SDK `collection.add` MIGHT support array?
      // Documentation says: `add` takes `data` which can be an object.
      // `collection.add` does NOT support array of objects in wx-server-sdk typically.
      // We must loop or use `Promise.all`.

      const tasks = valid_items.map(item => {
          return db.collection('inventory').add({
              data: item
          }).then(res => {
              // Add log
              return db.collection('inventory_log').add({
                  data: {
                      inventory_id: res._id,
                      unique_code: item.unique_code,
                      material_name: item.material_name,
                      type: 'inbound', // 修复: 使用 type 而非 action，与其他云函数保持一致
                      quantity_change: item.quantity.val,
                      operator: operator_name || 'Admin',
                      timestamp: new Date(),
                      note: '批量入库'
                  }
              }).then(() => res._id);
          }).catch(err => {
              console.error('Add failed', err);
              throw err;
          });
      });

      const ids = await Promise.all(tasks);

      return {
          success: true,
          total: ids.length,
          ids: ids
      };

  } catch (err) {
      console.error(err);
      return { success: false, msg: err.message };
  }
};
