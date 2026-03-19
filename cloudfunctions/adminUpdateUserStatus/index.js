const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, userId, status, role } = event;

  // 1. 获取操作人信息
  const operatorRes = await db.collection('users').where({
    _openid: OPENID
  }).get();

  if (operatorRes.data.length === 0) {
    return { success: false, msg: 'Permission denied' };
  }

  const operatorRole = operatorRes.data[0].role;
  const isSuperAdmin = operatorRole === 'super_admin';
  const isAdmin = operatorRole === 'admin' || isSuperAdmin;

  try {
    if (action === 'updateRole') {
       // 超管专属：修改角色
       if (!isSuperAdmin) {
           return { success: false, msg: '越权操作：仅超级管理员可修改权限' };
       }
       await db.collection('users').doc(userId).update({
           data: {
               role: role,
               update_time: db.serverDate()
           }
       });
       return { success: true };
    } else {
       // 默认行为：修改用户状态 (管理员及以上)
       if (!isAdmin) {
         return { success: false, msg: 'Permission denied' };
       }
       await db.collection('users').doc(userId).update({
         data: {
           status: status,
           reject_reason: event.rejectReason || '',
           update_time: db.serverDate()
         }
       });
       return { success: true };
    }
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
