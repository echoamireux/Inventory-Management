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

function normalizePagination(event = {}) {
  return {
    page: Math.max(1, Number(event.page) || 1),
    pageSize: Math.max(1, Math.min(100, Number(event.pageSize) || 20))
  };
}

async function listPendingUsers(page = 1, pageSize = 20) {
  const where = { status: 'pending' };
  const [countRes, res] = await Promise.all([
    db.collection('users').where(where).count(),
    db.collection('users')
      .where(where)
      .orderBy('create_time', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ]);
  const total = Number(countRes.total) || 0;

  return {
    list: (res.data || []).map(item => ({
      ...item,
      _timeStr: formatUserTime(item.create_time || item.created_at)
    })),
    total,
    page,
    pageSize,
    isEnd: page * pageSize >= total
  };
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

async function updatePendingUserStatus({ userId, status, rejectReason = '' }) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return { success: false, msg: '缺少用户 ID' };
  }

  if (status === 'rejected' && !String(rejectReason || '').trim()) {
    return { success: false, msg: '请填写驳回原因' };
  }

  return db.runTransaction(async (transaction) => {
    const targetRef = transaction.collection('users').doc(normalizedUserId);
    const targetRes = await targetRef.get();
    const targetUser = targetRes.data;
    if (!targetUser) {
      return { success: false, msg: '用户不存在' };
    }
    if (targetUser.status !== 'pending') {
      return { success: false, msg: '只能审批待处理用户申请' };
    }

    await targetRef.update({
      data: {
        status,
        reject_reason: status === 'rejected' ? String(rejectReason).trim() : '',
        update_time: db.serverDate()
      }
    });
    return { success: true };
  });
}

async function updateUserRole(userId, role) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return { success: false, msg: '缺少用户 ID' };
  }

  return db.runTransaction(async (transaction) => {
    const targetRef = transaction.collection('users').doc(normalizedUserId);
    const targetRes = await targetRef.get();
    const targetUser = targetRes.data;
    if (!targetUser) {
      return { success: false, msg: '用户不存在' };
    }

    if (targetUser.role === 'super_admin' && targetUser.status === 'active' && role !== 'super_admin') {
      const activeSuperAdminRes = await transaction.collection('users')
        .where({ role: 'super_admin', status: 'active' })
        .limit(2)
        .get();
      if ((activeSuperAdminRes.data || []).length <= 1) {
        return { success: false, msg: '系统必须至少保留一名激活的超级管理员' };
      }
    }

    await targetRef.update({
      data: {
        role,
        update_time: db.serverDate()
      }
    });
    return { success: true };
  });
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, userId, role } = event;

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
      const pagination = normalizePagination(event);
      const result = await listPendingUsers(pagination.page, pagination.pageSize);
      return { success: true, ...result };
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
      return await updateUserRole(userId, role);
    }

    if (action === 'approveUser' || action === 'rejectUser') {
      const authResult = assertAdminMutationAccess(operator, 'Permission denied');
      if (!authResult.ok) {
        return { success: false, msg: authResult.msg };
      }
      return await updatePendingUserStatus({
        userId,
        status: action === 'approveUser' ? 'active' : 'rejected',
        rejectReason: event.rejectReason || ''
      });
    }

    return { success: false, msg: `不支持的操作: ${action || '未指定'}` };
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
