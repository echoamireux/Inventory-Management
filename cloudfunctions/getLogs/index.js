// cloudfunctions/getLogs/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { queryCode, page = 1, limit = 50 } = event;
  const skip = (page - 1) * limit;

  try {
      let where = {};
      const collection = db.collection('inventory_log');

      // Filter Logic
      if (queryCode === 'today_in') {
          const today = new Date();
          today.setHours(0,0,0,0);
          // 'inbound' from updateInventory/addMaterial (standardized)
          // But addMaterial uses 'type: inbound'
          where = {
              type: _.in(['inbound', 'create', 'IN', 'CREATE']),
              timestamp: _.gte(today)
          };
      } else if (queryCode === 'today_out') {
          const today = new Date();
          today.setHours(0,0,0,0);
          where = {
              type: _.in(['outbound', 'OUT']),
              timestamp: _.gte(today)
          };
      } else if (queryCode) {
          // Specific Material (unique_code or inventory_id)
          // Try to match unique_code first
          where = _.or([
              { unique_code: queryCode },
              { inventory_id: queryCode }
          ]);
      } else {
          // No filter = All logs
      }

      // Query
      const totalRes = await collection.where(where).count();
      const dataRes = await collection.where(where)
          .orderBy('timestamp', 'desc')
          .orderBy('create_time', 'desc') // Fallback sort
          .skip(skip)
          .limit(limit)
          .get();

      return {
          success: true,
          list: dataRes.data,
          total: totalRes.total,
          page,
          limit
      };

  } catch (err) {
      console.error(err);
      return {
          success: false,
          msg: err.message
      };
  }
};
