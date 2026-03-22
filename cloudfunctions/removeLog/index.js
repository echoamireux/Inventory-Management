// cloudfunctions/removeLog/index.js
const cloud = require('wx-server-sdk');
const { assertAdminAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const OPENID = wxContext.OPENID;

  // 1. Check Permissions (Must be Admin)
  // We can check against a predefined admin list or check the user role in 'users' collection
  // For now, let's query the 'users' collection to check role for safety
  try {
     const userRes = await db.collection('users').where({ _openid: OPENID }).get();
     const authResult = assertAdminAccess(userRes.data[0], 'Permission Denied: Admins only');
     if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
     }
  } catch (e) {
      return { success: false, msg: 'Auth Error' };
  }

  return {
    success: false,
    msg: '日志删除已停用，正式业务日志不可删除'
  };
};
