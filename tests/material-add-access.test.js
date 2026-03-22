const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerZoneManagementAccess
} = require('../miniprogram/utils/material-add-access');

test('material-add keeps zone management disabled until user info becomes ready', () => {
  const states = [];
  const app = {
    globalData: { user: null },
    userReadyCallback: null
  };

  registerZoneManagementAccess(app, (canManageZones) => {
    states.push(canManageZones);
  });

  assert.deepEqual(states, [false]);
  assert.equal(typeof app.userReadyCallback, 'function');

  app.userReadyCallback({ role: 'admin', status: 'active' });
  assert.deepEqual(states, [false, true]);
});

test('material-add keeps normal users without zone creation access after callback', () => {
  const states = [];
  const app = {
    globalData: { user: null },
    userReadyCallback: null
  };

  registerZoneManagementAccess(app, (canManageZones) => {
    states.push(canManageZones);
  });

  app.userReadyCallback({ role: 'user', status: 'active' });
  assert.deepEqual(states, [false, false]);
});

test('material-add immediately enables zone management when admin user is already loaded', () => {
  const states = [];
  const app = {
    globalData: { user: { role: 'super_admin', status: 'active' } },
    userReadyCallback: null
  };

  registerZoneManagementAccess(app, (canManageZones) => {
    states.push(canManageZones);
  });

  assert.deepEqual(states, [true]);
});
