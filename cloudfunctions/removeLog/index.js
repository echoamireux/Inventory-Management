// cloudfunctions/removeLog/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { log_id, operator_name } = event;
  const wxContext = cloud.getWXContext();
  const OPENID = wxContext.OPENID;

  // 1. Check Permissions (Must be Admin)
  // We can check against a predefined admin list or check the user role in 'users' collection
  // For now, let's query the 'users' collection to check role for safety
  try {
     const userRes = await db.collection('users').where({ _openid: OPENID }).get();
     if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
         return { success: false, msg: 'Permission Denied: Admins only' };
     }
  } catch (e) {
      return { success: false, msg: 'Auth Error' };
  }

  try {
    // 2. Perform Delete
    await db.collection('inventory_log').doc(log_id).remove();

    return {
      success: true,
      msg: 'Log deleted'
    };

  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
