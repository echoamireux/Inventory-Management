const cloud = require('wx-server-sdk');
const {
  assertAdminMutationAccess,
  assertSuperAdminMutationAccess,
  isAllowedManagedRole
} = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function formatUserTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function listPendingUsers() {
  const res = await db.collection('users')
    .where({ status: 'pending' })
    .orderBy('create_time', 'desc')
    .limit(100)
    .get();

  return (res.data || []).map(item => ({
    ...item,
    _timeStr: formatUserTime(item.create_time || item.created_at)
  }));
}

async function listActiveUsers() {
  const pageSize = 100;
  let skip = 0;
  let rows = [];

  while (true) {
    const res = await db.collection('users')
      .where({ status: 'active' })
      .orderBy('create_time', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return rows.map(item => ({
    ...item,
    _timeStr: formatUserTime(item.create_time || item.created_at)
  }));
}

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
    if (action === 'listPendingUsers') {
       const authResult = assertAdminMutationAccess(operator, '仅已激活管理员可查看待审批用户');
       if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
       }
       return {
         success: true,
         list: await listPendingUsers()
       };
    }

    if (action === 'listActiveUsers') {
       const authResult = assertSuperAdminMutationAccess(operator, '仅已激活超级管理员可查看人员权限列表');
       if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
       }
       return {
         success: true,
         list: await listActiveUsers()
       };
    }

    if (action === 'updateRole') {
       const authResult = assertSuperAdminMutationAccess(operator, '越权操作：仅超级管理员可修改权限');
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
       const authResult = assertAdminMutationAccess(operator, 'Permission denied');
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
