function getMovePageAccessState(user) {
  if (!user) {
    return 'wait';
  }

  return user.status === 'active' ? 'allow' : 'deny';
}

function canManageZones(user) {
  return !!(user && (user.role === 'admin' || user.role === 'super_admin'));
}

module.exports = {
  getMovePageAccessState,
  canManageZones
};
