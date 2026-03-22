// cloudfunctions/removeLog/index.js
const cloud = require('wx-server-sdk');
const { assertAdminAccess } = require('./auth');

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
     const authResult = assertAdminAccess(userRes.data[0], 'Permission Denied: Admins only');
     if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
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
