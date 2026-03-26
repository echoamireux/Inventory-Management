function isActiveUser(operator) {
  return !!(operator && operator.status === 'active');
}

function assertActiveUserAccess(operator, message = '仅已激活用户可执行该操作') {
  if (!isActiveUser(operator)) {
    return { ok: false, msg: message };
  }
  return { ok: true };
}

module.exports = {
  isActiveUser,
  assertActiveUserAccess
};
