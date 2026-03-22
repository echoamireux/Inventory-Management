const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMovePageAccessState,
  canManageZones
} = require('../miniprogram/utils/move-page-access');

test('move page waits when user info is not ready yet', () => {
  assert.equal(getMovePageAccessState(null), 'wait');
  assert.equal(getMovePageAccessState(undefined), 'wait');
});

test('move page only allows active users after user info is ready', () => {
  assert.equal(getMovePageAccessState({ role: 'user', status: 'active' }), 'allow');
  assert.equal(getMovePageAccessState({ role: 'admin', status: 'active' }), 'allow');
  assert.equal(getMovePageAccessState({ role: 'user', status: 'pending' }), 'deny');
  assert.equal(getMovePageAccessState({ role: 'user', status: 'disabled' }), 'deny');
});

test('zone management stays admin-only', () => {
  assert.equal(canManageZones({ role: 'user', status: 'active' }), false);
  assert.equal(canManageZones({ role: 'admin', status: 'active' }), true);
  assert.equal(canManageZones({ role: 'super_admin', status: 'active' }), true);
});
