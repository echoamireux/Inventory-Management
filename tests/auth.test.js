const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAdminRole,
  isSuperAdminRole,
  isAllowedManagedRole,
  assertActiveUserAccess,
  assertAdminAccess,
  assertSuperAdminAccess
} = require('../cloudfunctions/_shared/auth');

test('admin and super_admin both satisfy admin access', () => {
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('super_admin'), true);
  assert.deepEqual(assertAdminAccess({ role: 'admin' }), { ok: true });
  assert.deepEqual(assertAdminAccess({ role: 'super_admin' }), { ok: true });
});

test('only super_admin can pass super admin gate', () => {
  assert.equal(isSuperAdminRole('super_admin'), true);
  assert.equal(isSuperAdminRole('admin'), false);
  assert.deepEqual(assertSuperAdminAccess({ role: 'super_admin' }), { ok: true });
  assert.deepEqual(assertSuperAdminAccess({ role: 'admin' }), {
    ok: false,
    msg: '越权操作：仅超级管理员可执行'
  });
});

test('managed roles are restricted to user and admin', () => {
  assert.equal(isAllowedManagedRole('user'), true);
  assert.equal(isAllowedManagedRole('admin'), true);
  assert.equal(isAllowedManagedRole('super_admin'), false);
  assert.equal(isAllowedManagedRole('guest'), false);
});

test('only active users can pass the general business-operation gate', () => {
  assert.deepEqual(assertActiveUserAccess({ role: 'user', status: 'active' }), { ok: true });
  assert.deepEqual(assertActiveUserAccess({ role: 'admin', status: 'active' }), { ok: true });
  assert.deepEqual(assertActiveUserAccess({ role: 'user', status: 'pending' }), {
    ok: false,
    msg: '仅已激活用户可执行该操作'
  });
  assert.deepEqual(assertActiveUserAccess({ role: 'user', status: 'disabled' }), {
    ok: false,
    msg: '仅已激活用户可执行该操作'
  });
});

test('non-admin active users still cannot pass admin-only gate', () => {
  assert.deepEqual(assertAdminAccess({ role: 'user', status: 'active' }), {
    ok: false,
    msg: 'Permission denied'
  });
});
