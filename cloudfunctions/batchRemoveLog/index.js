// cloudfunctions/removeLog/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { log_ids } = event;
  const wxContext = cloud.getWXContext();
  const OPENID = wxContext.OPENID;

  // 1. Check Permissions (Must be Admin)
  try {
     const userRes = await db.collection('users').where({ _openid: OPENID }).get();
     if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
         return { success: false, msg: 'Permission Denied: Admins only' };
     }
  } catch (e) {
      return { success: false, msg: 'Auth Error' };
  }

  try {
    if (!log_ids || !Array.isArray(log_ids) || log_ids.length === 0) {
      return { success: false, msg: 'No log IDs provided' };
    }

    // 2. Perform Batch Delete
    const _ = db.command;
    const res = await db.collection('inventory_log').where({
      _id: _.in(log_ids)
    }).remove();

    return {
      success: true,
      msg: 'Logs deleted',
      stats: res.stats
    };

  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
