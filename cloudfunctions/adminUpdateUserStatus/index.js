const cloud = require('wx-server-sdk');
const {
  assertAdminAccess,
  assertSuperAdminAccess,
  isAllowedManagedRole
} = require('./auth');

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

  const operator = operatorRes.data[0];

  try {
    if (action === 'updateRole') {
       const authResult = assertSuperAdminAccess(operator, '越权操作：仅超级管理员可修改权限');
       if (!authResult.ok) {
           return { success: false, msg: authResult.msg };
       }
       if (!isAllowedManagedRole(role)) {
           return { success: false, msg: '非法角色：仅允许设置为 user 或 admin' };
       }
       await db.collection('users').doc(userId).update({
           data: {
               role: role,
               update_time: db.serverDate()
           }
       });
       return { success: true };
    } else {
       const authResult = assertAdminAccess(operator, 'Permission denied');
       if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
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
