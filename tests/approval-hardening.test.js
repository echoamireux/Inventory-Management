const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadModuleWithMocks(modulePath, mocks) {
  const resolvedModulePath = require.resolve(modulePath);
  delete require.cache[resolvedModulePath];
  const originalLoad = Module._load;
  Module._load = function patchedLoader(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolvedModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createUserDb(users) {
  const state = users.map(item => ({ ...item }));

  function matchesWhere(item, where = {}) {
    return Object.entries(where).every(([key, value]) => {
      if (value && Array.isArray(value.$in)) {
        return value.$in.includes(item[key]);
      }
      return item[key] === value;
    });
  }

  function collection(name) {
    if (name === 'audit_events') {
      return {
        async add() {
          return { _id: 'audit-test-id' };
        }
      };
    }
    assert.equal(name, 'users');
    return {
      where(where) {
        let limitValue = Infinity;
        let skipValue = 0;
        const query = {
          orderBy() {
            return query;
          },
          skip(value) {
            skipValue = Number(value) || 0;
            return query;
          },
          limit(value) {
            limitValue = Number(value) || 0;
            return query;
          },
          async get() {
            const matches = state.filter(item => matchesWhere(item, where));
            return {
              data: matches
                .slice(skipValue, skipValue + limitValue)
                .map(item => ({ ...item }))
            };
          },
          async count() {
            return {
              total: state.filter(item => matchesWhere(item, where)).length
            };
          }
        };
        return query;
      },
      doc(id) {
        return {
          async get() {
            return { data: state.find(item => item._id === id) || null };
          },
          async update({ data }) {
            const index = state.findIndex(item => item._id === id);
            if (index === -1) throw new Error('用户不存在');
            state[index] = { ...state[index], ...data };
          }
        };
      }
    };
  }

  const db = {
    command: {
      in(values) {
        return { $in: values };
      }
    },
    collection,
    serverDate() {
      return new Date('2026-07-10T08:00:00.000Z');
    },
    runTransaction(handler) {
      return handler({ collection });
    }
  };
  return { db, state };
}

function loadAdminUpdateUserStatus(db) {
  return loadModuleWithMocks('../cloudfunctions/adminUpdateUserStatus/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-super-1' };
      },
      database() {
        return db;
      }
    }
  });
}

test('approval mutations recheck pending status inside transactions', () => {
  const userSource = read('cloudfunctions/adminUpdateUserStatus/index.js');
  const materialSource = read('cloudfunctions/approveMaterialRequest/index.js');
  const correctionSource = read('cloudfunctions/approveInventoryCorrectionRequest/index.js');

  assert.match(userSource, /updatePendingUserStatus[\s\S]*db\.runTransaction/);
  assert.match(materialSource, /updatePendingMaterialRequestStatus[\s\S]*db\.runTransaction/);
  assert.match(correctionSource, /db\.runTransaction[\s\S]*status !== 'pending'/);
});

test('the last active super administrator cannot be demoted', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'updateRole', userId: 'super-1', role: 'user' });

  assert.equal(result.success, false);
  assert.match(result.msg, /至少保留一名激活的超级管理员/);
  assert.equal(state[0].role, 'super_admin');
});

// 目标必须是 super-2 而非 super-1：mock 的操作人 OPENID 是 openid-super-1，
// 选中 super-1 会命中「不能降低当前登录账号的权限」的自我保护，与本用例
// 「非最后一名超管可以被降级」的意图无关。
test('a super administrator can be demoted when another active super administrator remains', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    { _id: 'super-2', _openid: 'openid-super-2', role: 'super_admin', status: 'active' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'updateRole', userId: 'super-2', role: 'admin' });

  assert.equal(result.success, true);
  assert.equal(state.find(item => item._id === 'super-2').role, 'admin');
});

test('a super administrator cannot demote themselves even when another one remains', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    { _id: 'super-2', _openid: 'openid-super-2', role: 'super_admin', status: 'active' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'updateRole', userId: 'super-1', role: 'admin' });

  assert.equal(result.success, false);
  assert.match(result.msg, /不能降低当前登录账号的权限/);
  assert.equal(state.find(item => item._id === 'super-1').role, 'super_admin');
});

test('an active super administrator can promote another active user for a safe handover', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    { _id: 'admin-1', _openid: 'openid-admin-1', role: 'admin', status: 'active' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'updateRole', userId: 'admin-1', role: 'super_admin' });

  assert.equal(result.success, true);
  assert.equal(state.find(item => item._id === 'admin-1').role, 'super_admin');
});

test('user disabling is transactional and cannot disable the last active super administrator', async () => {
  const { db, state } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    { _id: 'user-1', _openid: 'openid-user-1', role: 'user', status: 'active' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const disabled = await mod.main({ action: 'updateStatus', userId: 'user-1', status: 'disabled' });
  assert.equal(disabled.success, true);
  assert.equal(state.find(item => item._id === 'user-1').status, 'disabled');

  const blocked = await mod.main({ action: 'updateStatus', userId: 'super-1', status: 'disabled' });
  assert.equal(blocked.success, false);
  assert.match(blocked.msg, /至少保留一名激活的超级管理员/);
  assert.equal(state.find(item => item._id === 'super-1').status, 'active');
});

test('super-admin user management includes disabled users and exposes role and status actions', async () => {
  const { db } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    { _id: 'user-disabled', _openid: 'openid-disabled', role: 'user', status: 'disabled' },
    { _id: 'user-pending', _openid: 'openid-pending', role: 'user', status: 'pending' }
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'listActiveUsers' });
  assert.equal(result.success, true);
  assert.equal(result.list.some(item => item._id === 'user-disabled'), true);
  assert.equal(result.list.some(item => item._id === 'user-pending'), false);

  const pageSource = read('miniprogram/pages/super-admin/user-manage/index.js');
  assert.match(pageSource, /role:\s*'super_admin'|super_admin[\s\S]*updateRole/);
  assert.match(pageSource, /action:\s*'updateStatus'/);
});

test('approval center backend and page keep independent paginated tab state', () => {
  const cloudSource = read('cloudfunctions/getApprovalCenterData/index.js');
  const pageSource = read('miniprogram/pages/admin/approval-center/index.js');

  assert.match(cloudSource, /pageSize[\s\S]*Math\.min\(100/);
  assert.match(cloudSource, /\.skip\(\(page - 1\) \* pageSize\)/);
  assert.match(cloudSource, /total[\s\S]*page[\s\S]*pageSize[\s\S]*isEnd/);
  assert.match(pageSource, /materialPage:/);
  assert.match(pageSource, /userPage:/);
  assert.match(pageSource, /correctionPage:/);
  assert.match(pageSource, /onReachBottom\(\)/);
  assert.match(pageSource, /onPullDownRefresh\(\)/);
});

test('pending-user API paginates beyond one hundred records', async () => {
  const pendingUsers = Array.from({ length: 125 }, (_, index) => ({
    _id: `pending-${index + 1}`,
    _openid: `openid-pending-${index + 1}`,
    role: 'user',
    status: 'pending',
    create_time: new Date(2026, 0, index + 1)
  }));
  const { db } = createUserDb([
    { _id: 'super-1', _openid: 'openid-super-1', role: 'super_admin', status: 'active' },
    ...pendingUsers
  ]);
  const mod = loadAdminUpdateUserStatus(db);

  const result = await mod.main({ action: 'listPendingUsers', page: 3, pageSize: 50 });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 25);
  assert.equal(result.total, 125);
  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 50);
  assert.equal(result.isEnd, true);
});

test('approval-center material tab paginates beyond one hundred records', async () => {
  const materialRequests = Array.from({ length: 125 }, (_, index) => ({
    _id: `request-${index + 1}`,
    status: 'pending',
    product_code: `J-${String(index + 1).padStart(3, '0')}`,
    created_at: new Date(2026, 0, index + 1)
  }));
  const operator = { _id: 'admin-1', _openid: 'openid-admin', role: 'admin', status: 'active' };

  function createQuery(rows, where = {}) {
    let skipValue = 0;
    let limitValue = Infinity;
    const query = {
      orderBy() { return query; },
      skip(value) { skipValue = Number(value) || 0; return query; },
      limit(value) { limitValue = Number(value) || 0; return query; },
      async get() {
        const matches = rows.filter(item => Object.entries(where).every(([key, value]) => item[key] === value));
        return { data: matches.slice(skipValue, skipValue + limitValue).map(item => ({ ...item })) };
      },
      async count() {
        return { total: rows.filter(item => Object.entries(where).every(([key, value]) => item[key] === value)).length };
      }
    };
    return query;
  }

  const db = {
    collection(name) {
      const rows = name === 'users' ? [operator] : materialRequests;
      return {
        where(where) {
          return createQuery(rows, where);
        }
      };
    }
  };
  const mod = loadModuleWithMocks('../cloudfunctions/getApprovalCenterData/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() { return { OPENID: 'openid-admin' }; },
      database() { return db; }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() { return []; },
      sortSubcategoryRecords(records) { return records; },
      buildSubcategoryMap() { return new Map(); },
      resolveSubcategoryDisplay() { return ''; }
    }
  });

  const result = await mod.main({ action: 'materials', page: 3, pageSize: 50 });

  assert.equal(result.success, true);
  assert.equal(result.materialList.length, 25);
  assert.equal(result.total, 125);
  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 50);
  assert.equal(result.isEnd, true);
});

// B4 回归：审批/驳回后曾用 _.remove() 删除 pending_key。但云开发唯一索引把
// 「字段不存在」视为 null，且官方文档明确「不允许存在两个或以上的该字段为空/
// 不存在该字段的记录」，而控制台并不提供 sparse 选项。于是第一条审批成功后，
// 第二条审批就会撞 duplicate key。改为写入以记录 _id 为基础的唯一占位值。
test('approval releases pending_key with a unique placeholder instead of removing it', () => {
  for (const relPath of [
    'cloudfunctions/approveMaterialRequest/index.js',
    'cloudfunctions/approveInventoryCorrectionRequest/index.js'
  ]) {
    const source = read(relPath);
    const fnBody = source.match(/function clearPendingKeyUpdate\([\s\S]*?\n\}/);

    assert.ok(fnBody, `${relPath} 应存在 clearPendingKeyUpdate`);
    // 退化一：改回删除字段
    assert.doesNotMatch(
      fnBody[0], /_\.remove\(\)/,
      `${relPath}：不得用 _.remove() 移除 pending_key，会让第二次审批撞唯一索引`
    );
    // 退化二：写了固定值而非唯一值（固定值同样会互撞）
    assert.match(
      fnBody[0], /pending_key:\s*`done:\$\{/,
      `${relPath}：应写入以记录 id 为基础的唯一占位值`
    );
    // 退化三：调用点忘记传 id —— 会写成 "done:undefined"，多条依旧冲突
    assert.doesNotMatch(
      source, /clearPendingKeyUpdate\(\s*\)/,
      `${relPath}：所有调用点都必须传入记录 id`
    );
  }
});
