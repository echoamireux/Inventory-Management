const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const projectCodes = require('../cloudfunctions/_shared/project-codes');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
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

function createProjectDb({ users = [], projects = [] } = {}) {
  const state = {
    users: users.map(item => ({ ...item })),
    projects: projects.map(item => ({ ...item })),
    nextProjectId: projects.length + 1
  };

  function query(collectionName, rows, where = {}) {
    let filtered = rows;
    if (where && Object.keys(where).length > 0) {
      filtered = filtered.filter((row) => Object.entries(where).every(([key, expected]) => row[key] === expected));
    }
    return {
      _skip: 0,
      _limit: rows.length || 100,
      where(nextWhere) {
        return query(collectionName, rows, nextWhere);
      },
      orderBy() {
        return this;
      },
      skip(value) {
        this._skip = value;
        return this;
      },
      limit(value) {
        this._limit = value;
        return this;
      },
      async get() {
        return { data: filtered.slice(this._skip, this._skip + this._limit).map(item => ({ ...item })) };
      },
      async count() {
        return { total: filtered.length };
      }
    };
  }

  const db = {
    command: {},
    serverDate() {
      return { $date: true };
    },
    async createCollection(name) {
      assert.equal(name, 'project_codes');
      return {};
    },
    collection(name) {
      if (name === 'users') {
        return {
          where(where) {
            return query(name, state.users, where);
          }
        };
      }

      if (name === 'project_codes') {
        return {
          where(where) {
            return query(name, state.projects, where);
          },
          skip(skip) {
            return query(name, state.projects).skip(skip);
          },
          doc(id) {
            return {
              async update({ data }) {
                const index = state.projects.findIndex(item => item._id === id);
                if (index === -1) throw new Error(`missing project ${id}`);
                state.projects[index] = { ...state.projects[index], ...data };
              }
            };
          },
          async add({ data }) {
            const _id = `project-${state.nextProjectId++}`;
            state.projects.push({ _id, ...data });
            return { _id };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  return { db, state };
}

test('default 2026 project code seeds come from the requested C43-C84 range', () => {
  assert.equal(projectCodes.BUILTIN_PROJECT_CODE_SEEDS.length, 42);
  assert.deepEqual(projectCodes.BUILTIN_PROJECT_CODE_SEEDS.slice(0, 3).map(item => item.project_code), [
    'OR2026RD02001',
    'OR2026RD02002',
    'OR2026RD02003'
  ]);
  assert.equal(projectCodes.BUILTIN_PROJECT_CODE_SEEDS[0].project_name, 'OR2026RD02-复合双面胶带88D5');
  assert.equal(projectCodes.BUILTIN_PROJECT_CODE_SEEDS[41].project_code, 'OR2026RD05005');
  assert.match(projectCodes.BUILTIN_PROJECT_CODE_SEEDS[41].project_name, /低爬升硅胶保护膜/);
});

test('project code helpers normalize, sort, and build picker labels', () => {
  const normalized = projectCodes.normalizeProjectCodeRecord({
    _id: 'p1',
    project_code: ' or2026rd02001 ',
    project_name: ' 项目一 ',
    status: 'disabled',
    sort_order: '20'
  });

  assert.equal(normalized.project_code, 'OR2026RD02001');
  assert.equal(normalized.project_name, '项目一');
  assert.equal(normalized.status, 'disabled');
  assert.equal(projectCodes.buildProjectCodeLabel(normalized), 'OR2026RD02001 - 项目一');
  assert.deepEqual(
    projectCodes.buildProjectCodeActions([normalized]),
    [{ name: 'OR2026RD02001 - 项目一', project_code: 'OR2026RD02001', project_name: '项目一' }]
  );
});

test('ensureBuiltinProjectCodes preserves admin renamed and reordered builtin projects', async () => {
  const { db } = createProjectDb({
    projects: [
      {
        _id: 'p1',
        project_code: 'OR2026RD02001',
        project_name: '自定义项目一',
        status: 'active',
        is_builtin: true,
        sort_order: 20
      },
      {
        _id: 'p2',
        project_code: 'OR2026RD02002',
        project_name: '自定义项目二',
        status: 'active',
        is_builtin: true,
        sort_order: 10
      }
    ]
  });

  const synced = await projectCodes.ensureBuiltinProjectCodes(db);
  const syncedMap = new Map(synced.map(item => [item.project_code, item]));

  assert.equal(syncedMap.get('OR2026RD02001').project_name, '自定义项目一');
  assert.equal(syncedMap.get('OR2026RD02001').sort_order, 20);
  assert.equal(syncedMap.get('OR2026RD02002').project_name, '自定义项目二');
  assert.equal(syncedMap.get('OR2026RD02002').sort_order, 10);
  assert.equal(syncedMap.get('OR2026RD05005').project_name, 'OR2026RD05-低爬升硅胶保护膜 19502BL-E3');
});

test('manageProjectCode allows active users to list and rejects inactive users before seeding', async () => {
  let createCollectionCalled = false;
  const { db } = createProjectDb({
    users: [{ _openid: 'openid-pending', role: 'user', status: 'pending' }]
  });
  db.createCollection = async () => {
    createCollectionCalled = true;
  };

  const mod = loadModuleWithMocks('../cloudfunctions/manageProjectCode/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-pending' };
      },
      database() {
        return db;
      }
    }
  });

  const result = await mod.main({ action: 'list' }, {});

  assert.equal(result.success, false);
  assert.match(result.msg, /仅已激活用户可查看项目编码/);
  assert.equal(createCollectionCalled, false);
});

test('manageProjectCode initializes defaults for active users and gates writes to admins', async () => {
  const { db, state } = createProjectDb({
    users: [{ _openid: 'openid-user', role: 'user', status: 'active', name: '用户A' }]
  });

  const mod = loadModuleWithMocks('../cloudfunctions/manageProjectCode/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return db;
      }
    }
  });

  const listResult = await mod.main({ action: 'list' }, {});
  assert.equal(listResult.success, true);
  assert.equal(listResult.list.length, 42);
  assert.equal(state.projects.length, 42);

  const createResult = await mod.main({
    action: 'create',
    project_code: 'OR2026RD99999',
    project_name: '测试项目'
  }, {});
  assert.equal(createResult.success, false);
  assert.match(createResult.msg, /仅管理员可维护项目编码/);
});

test('manageProjectCode lets active admins create, update, disable, and reorder project codes', async () => {
  const { db, state } = createProjectDb({
    users: [{ _openid: 'openid-admin', role: 'admin', status: 'active', name: '管理员' }],
    projects: [
      { _id: 'p1', project_code: 'OR2026RD02001', project_name: '项目一', status: 'active', sort_order: 10 },
      { _id: 'p2', project_code: 'OR2026RD02002', project_name: '项目二', status: 'active', sort_order: 20 }
    ]
  });

  const mod = loadModuleWithMocks('../cloudfunctions/manageProjectCode/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-admin' };
      },
      database() {
        return db;
      }
    }
  });

  const duplicate = await mod.main({ action: 'create', project_code: 'or2026rd02001', project_name: '重复' }, {});
  assert.equal(duplicate.success, false);
  assert.match(duplicate.msg, /项目编码已存在/);

  const created = await mod.main({ action: 'create', project_code: 'OR2026RD99999', project_name: '新增项目' }, {});
  assert.equal(created.success, true);

  const renamed = await mod.main({ action: 'update', project_code: 'OR2026RD99999', project_name: '新增项目-改名' }, {});
  assert.equal(renamed.success, true);

  const disabled = await mod.main({ action: 'setStatus', project_code: 'OR2026RD99999', status: 'disabled' }, {});
  assert.equal(disabled.success, true);

  const reordered = await mod.main({
    action: 'reorder',
    project_codes: ['OR2026RD02002', 'OR2026RD02001']
  }, {});
  assert.equal(reordered.success, true);

  const createdRow = state.projects.find(item => item.project_code === 'OR2026RD99999');
  assert.equal(createdRow.project_name, '新增项目-改名');
  assert.equal(createdRow.status, 'disabled');
  assert.equal(state.projects.find(item => item.project_code === 'OR2026RD02002').sort_order, 10);
});

test('frontend project code service calls manageProjectCode with business actions', async () => {
  const calls = [];
  global.wx = {
    cloud: {
      callFunction: async (payload) => {
        calls.push(payload);
        return { result: { success: true, list: [] } };
      }
    }
  };
  delete require.cache[require.resolve('../miniprogram/utils/project-code-service')];
  const service = require('../miniprogram/utils/project-code-service');

  await service.listProjectCodes();
  await service.createProjectCode('OR2026RD99999', '新增项目');
  await service.updateProjectCode('OR2026RD99999', '改名项目');
  await service.setProjectCodeStatus('OR2026RD99999', 'disabled');
  await service.reorderProjectCodes(['OR2026RD02002', 'OR2026RD02001']);

  assert.deepEqual(calls.map(call => call.data.action), ['list', 'create', 'update', 'setStatus', 'reorder']);
  assert.equal(calls[0].name, 'manageProjectCode');
  assert.equal(calls[1].data.project_code, 'OR2026RD99999');
  assert.equal(calls[2].data.project_name, '改名项目');
});

test('project code management page uses structured forms and clear loading states', () => {
  const pageJs = read('miniprogram/pages/admin/project-code-manage/index.js');
  const pageWxml = read('miniprogram/pages/admin/project-code-manage/index.wxml');
  const pageJson = read('miniprogram/pages/admin/project-code-manage/index.json');

  assert.doesNotMatch(pageJs, /wx\.showModal\(\{\s*title:\s*['"]新建项目编码['"]/);
  assert.doesNotMatch(pageJs, /placeholderText:\s*['"]输入格式：项目编码 项目名称['"]/);
  assert.match(pageJs, /projectFormVisible/);
  assert.match(pageJs, /projectFormMode/);
  assert.match(pageJs, /onProjectCodeInput/);
  assert.match(pageJs, /onProjectNameInput/);
  assert.match(pageJs, /请输入项目编码/);
  assert.match(pageJs, /请输入项目名称/);
  assert.match(pageJs, /OR2026RD99999/);

  assert.match(pageWxml, /van-popup/);
  assert.match(pageWxml, /项目编码/);
  assert.match(pageWxml, /项目名称/);
  assert.match(pageWxml, /OR2026RD99999/);
  assert.match(pageWxml, /OR2026RD99-新增项目名称/);
  assert.match(pageWxml, /重新加载/);
  assert.match(pageWxml, /暂无项目编码/);
  assert.doesNotMatch(pageWxml, /zone-toolbar__title/);
  assert.match(pageWxml, /领料时使用启用状态的项目编码/);
  assert.match(pageWxml, /共 \{\{ projects\.length \}\} 个项目编码/);

  assert.match(pageJson, /"van-field"/);
  assert.match(pageJson, /"van-popup"/);
});
