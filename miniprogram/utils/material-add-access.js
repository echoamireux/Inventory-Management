const { canManageZones } = require('./move-page-access');

function registerZoneManagementAccess(app, onChange) {
  const emit = typeof onChange === 'function' ? onChange : () => {};
  const safeApp = app || {};
  const globalData = safeApp.globalData || {};

  if (globalData.user) {
    emit(canManageZones(globalData.user));
    return;
  }

  emit(false);
  const previousCallback = safeApp.userReadyCallback;

  safeApp.userReadyCallback = (user) => {
    if (typeof previousCallback === 'function') {
      previousCallback(user);
    }
    emit(canManageZones(user));
  };
}

module.exports = {
  registerZoneManagementAccess
};
