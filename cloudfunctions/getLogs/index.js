// cloudfunctions/getLogs/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const {
    queryCode,
    searchVal,
    dateFilter,
    typeFilter,
    operatorFilter,
    page = 1,
    limit = 50
  } = event;
  const skip = (page - 1) * limit;

  try {
      let conditions = [];
      const collection = db.collection('inventory_log');

      // 1. queryCode 筛选（特殊筛选，如今日入库）
      if (queryCode === 'today_in') {
          const today = new Date();
          today.setHours(0,0,0,0);
          conditions.push({ type: _.in(['inbound', 'create', 'IN', 'CREATE']) });
          conditions.push({ timestamp: _.gte(today) });
      } else if (queryCode === 'today_out') {
          const today = new Date();
          today.setHours(0,0,0,0);
          conditions.push({ type: _.in(['outbound', 'OUT']) });
          conditions.push({ timestamp: _.gte(today) });
      } else if (queryCode) {
          conditions.push(_.or([
              { unique_code: queryCode },
              { inventory_id: queryCode }
          ]));
      }

      // 2. 搜索关键词（物料名称、产品代码、操作人）
      if (searchVal && searchVal.trim()) {
          const regex = db.RegExp({
              regexp: searchVal.trim(),
              options: 'i'
          });
          conditions.push(_.or([
              { material_name: regex },
              { product_code: regex },
              { operator: regex },
              { operator_name: regex }
          ]));
      }

      // 3. 日期筛选
      if (dateFilter && dateFilter !== 'all') {
          const now = new Date();
          let startDate;

          if (dateFilter === 'today') {
              startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          } else if (dateFilter === 'week') {
              const dayOfWeek = now.getDay();
              startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          } else if (dateFilter === 'month') {
              startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          }

          if (startDate) {
              conditions.push({ timestamp: _.gte(startDate) });
          }
      }

      // 4. 类型筛选
      if (typeFilter && typeFilter !== 'all') {
          if (typeFilter === 'inbound') {
              conditions.push({ type: _.in(['inbound', 'create']) });
          } else {
              conditions.push({ type: typeFilter });
          }
      }

      // 5. 操作人筛选
      if (operatorFilter && operatorFilter !== 'all') {
          conditions.push(_.or([
              { operator: operatorFilter },
              { operator_name: operatorFilter }
          ]));
      }

      // 组合条件
      const where = conditions.length > 0 ? _.and(conditions) : {};

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
