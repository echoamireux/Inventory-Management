const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const MANAGEABLE_ROLES = new Set(['user', 'admin']);

function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

function isSuperAdminRole(role) {
  return role === 'super_admin';
}

function isAllowedManagedRole(role) {
  return MANAGEABLE_ROLES.has(role);
}

function isActiveUser(operator) {
  return !!(operator && operator.status === 'active');
}

function assertAdminAccess(operator, message = 'Permission denied') {
  if (!operator || !isAdminRole(operator.role)) {
    return { ok: false, msg: message };
  }
  return { ok: true };
}

function assertActiveUserAccess(operator, message = '仅已激活用户可执行该操作') {
  if (!isActiveUser(operator)) {
    return { ok: false, msg: message };
  }
  return { ok: true };
}

function assertSuperAdminAccess(operator, message = '越权操作：仅超级管理员可执行') {
  if (!operator || !isSuperAdminRole(operator.role)) {
    return { ok: false, msg: message };
  }
  return { ok: true };
}

module.exports = {
  ADMIN_ROLES,
  MANAGEABLE_ROLES,
  isAdminRole,
  isSuperAdminRole,
  isAllowedManagedRole,
  isActiveUser,
  assertActiveUserAccess,
  assertAdminAccess,
  assertSuperAdminAccess
};
