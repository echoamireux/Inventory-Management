// cloudfunctions/getLogs/index.js
const cloud = require('wx-server-sdk');
const { getCstRange } = require('./cst-time');
const { buildLogSearchWhere } = require('./log-search');

const LOG_SEARCH_FIELD_NAMES = [
  'material_name',
  'product_code',
  'unique_code',
  'batch_number',
  'operator',
  'operator_name',
  'type',
  'description',
  'note'
];

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
      const collection = db.collection('inventory_log');
      const where = buildLogSearchWhere({
          db,
          _,
          queryCode,
          searchVal,
          dateFilter,
          typeFilter,
          operatorFilter,
          getCstRange
      });

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
