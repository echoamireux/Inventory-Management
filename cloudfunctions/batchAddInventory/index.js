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

      // 2. Batch Insert with Transaction (Atomic)
      const result = await db.runTransaction(async transaction => {
          const ids = [];

          for (const item of valid_items) {
              // 2.1 Check for duplicates (Atomicity Check)
              if (item.unique_code) {
                  const exist = await transaction.collection('inventory').where({
                      unique_code: item.unique_code
                  }).get();

                  if (exist.data.length > 0) {
                      throw new Error(`冲突：标签号 ${item.unique_code} 已存在，批量操作已回滚`);
                  }
              }

              // 2.2 Insert Inventory
              const res = await transaction.collection('inventory').add({
                  data: item
              });

              // 2.3 Insert Log
              await transaction.collection('inventory_log').add({
                  data: {
                      inventory_id: res._id,
                      unique_code: item.unique_code,
                      material_name: item.material_name,
                      type: 'inbound',
                      quantity_change: item.quantity.val,
                      operator: operator_name || 'Admin',
                      timestamp: new Date(),
                      note: '批量入库'
                  }
              });

              ids.push(res._id);
          }

          return {
              success: true,
              total: ids.length,
              ids: ids
          };
      });

      return result;

  } catch (err) {
      console.error(err);
      return { success: false, msg: err.message };
  }
};
