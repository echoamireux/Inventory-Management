const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

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

function createGetLogsDatabase() {
  const collections = {
    users: [
      { _id: 'admin-1', _openid: 'openid-admin', name: '管理员', role: 'admin', status: 'active' },
      { _id: 'user-1', _openid: 'openid-user', name: '普通用户', role: 'user', status: 'active' }
    ],
    inventory_log: [
      {
        _id: 'inv-log-1',
        type: 'inbound',
        product_code: 'J-001',
        material_name: '库存流水物料',
        operator: '库管员',
        timestamp: new Date('2026-07-10T01:00:00.000Z')
      }
    ],
    audit_events: [
      {
        _id: 'audit-1',
        domain: 'preprint',
        action: 'create',
        actor_name: '管理员',
        target_label: 'J-001',
        search_text: 'preprint create 管理员 J-001 标签预打印',
        timestamp: new Date('2026-07-10T02:00:00.000Z')
      }
    ]
  };
  const queriedCollections = [];

  function matches(record, where = {}) {
    if (!where || Object.keys(where).length === 0) {
      return true;
    }
    if (where.$and) {
      return where.$and.every(item => matches(record, item));
    }
    if (where.$or) {
      return where.$or.some(item => matches(record, item));
    }
    return Object.entries(where).every(([key, expected]) => {
      const actual = key === '_id' ? record._id : record[key];
      if (expected && expected.$in) {
        return expected.$in.includes(actual);
      }
      if (expected && expected.$gte) {
        return new Date(actual).getTime() >= new Date(expected.$gte).getTime();
      }
      if (expected instanceof RegExp) {
        return expected.test(String(actual || ''));
      }
      return actual === expected;
    });
  }

  function createQuery(name, where = {}) {
    let skipValue = 0;
    let limitValue = Infinity;
    const orderBys = [];
    const query = {
      orderBy(field, direction) {
        orderBys.push({ field, direction });
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
        queriedCollections.push(name);
        const source = collections[name] || [];
        const rows = source.filter(item => matches(item, where));
        rows.sort((left, right) => {
          for (const order of orderBys) {
            const leftValue = left[order.field] instanceof Date ? left[order.field].getTime() : left[order.field];
            const rightValue = right[order.field] instanceof Date ? right[order.field].getTime() : right[order.field];
            if (leftValue === rightValue) continue;
            return order.direction === 'desc'
              ? (rightValue > leftValue ? 1 : -1)
              : (leftValue > rightValue ? 1 : -1);
          }
          return 0;
        });
        return { data: rows.slice(skipValue, skipValue + limitValue) };
      },
      async count() {
        const rows = (collections[name] || []).filter(item => matches(item, where));
        return { total: rows.length };
      }
    };
    return query;
  }

  const db = {
    command: {
      in(values) {
        return { $in: values };
      },
      gte(value) {
        return { $gte: value };
      },
      and(values) {
        return { $and: values };
      },
      or(values) {
        return { $or: values };
      }
    },
    RegExp({ regexp, options }) {
      return new RegExp(regexp, options);
    },
    collection(name) {
      return {
        where(where) {
          return createQuery(name, where);
        }
      };
    }
  };

  return { db, queriedCollections };
}

function loadGetLogs(memory, openid = 'openid-admin') {
  return loadModuleWithMocks('../cloudfunctions/getLogs/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: openid };
      },
      database() {
        return memory.db;
      }
    }
  });
}

test('audit event helper builds normalized searchable admin audit records', () => {
  const { buildAuditEventData } = require('../cloudfunctions/_shared/audit-events');
  const serverNow = new Date('2026-07-10T08:00:00.000Z');
  const db = {
    serverDate() {
      return serverNow;
    }
  };

  const event = buildAuditEventData(db, {
    domain: 'preprint',
    action: 'create',
    operator: { _openid: 'openid-admin', name: '管理员' },
    target: { type: 'preprint_job', id: 'job-1', label: 'J-001' },
    operationId: 'op-1',
    before: { status: 'pending' },
    after: { status: 'ready' },
    detail: { count: 5, note: '标签预打印' }
  });

  assert.equal(event.domain, 'preprint');
  assert.equal(event.action, 'create');
  assert.equal(event.actor_id, 'openid-admin');
  assert.equal(event.actor_name, '管理员');
  assert.equal(event.target_type, 'preprint_job');
  assert.equal(event.target_id, 'job-1');
  assert.equal(event.target_label, 'J-001');
  assert.equal(event.operation_id, 'op-1');
  assert.deepEqual(event.before, { status: 'pending' });
  assert.deepEqual(event.after, { status: 'ready' });
  assert.equal(event.timestamp, serverNow);
  assert.match(event.search_text, /preprint/);
  assert.match(event.search_text, /管理员/);
  assert.match(event.search_text, /J-001/);
  assert.match(event.search_text, /标签预打印/);
});

test('getLogs reads inventory流水 and caps page size for normal log scope', async () => {
  const memory = createGetLogsDatabase();
  const mod = loadGetLogs(memory, 'openid-user');

  const result = await mod.main({ logScope: 'inventory', limit: 999 });

  assert.equal(result.success, true);
  assert.equal(result.limit, 100);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0]._id, 'inv-log-1');
  assert(memory.queriedCollections.includes('inventory_log'));
  assert(!memory.queriedCollections.includes('audit_events'));
});

test('getLogs reads audit_events for admin audit scope and searches search_text', async () => {
  const memory = createGetLogsDatabase();
  const mod = loadGetLogs(memory, 'openid-admin');

  const result = await mod.main({
    logScope: 'audit',
    searchVal: '标签预打印',
    typeFilter: 'create',
    operatorFilter: '管理员'
  });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0]._id, 'audit-1');
  assert(memory.queriedCollections.includes('audit_events'));
});

test('critical write cloud functions emit unified audit events', () => {
  const inventoryWriters = [
    'cloudfunctions/addMaterial/index.js',
    'cloudfunctions/batchAddInventory/index.js',
    'cloudfunctions/importInventoryTemplate/index.js',
    'cloudfunctions/updateInventory/index.js',
    'cloudfunctions/editInventory/index.js',
    'cloudfunctions/approveInventoryCorrectionRequest/index.js'
  ];
  for (const relPath of inventoryWriters) {
    const source = read(relPath);
    assert.match(source, /audit-events/);
    assert.match(source, /writeInventoryAuditEvent/);
  }

  const managementWriters = [
    'cloudfunctions/manageMaterial/index.js',
    'cloudfunctions/manageProductCodePrefix/index.js',
    'cloudfunctions/manageProjectCode/index.js',
    'cloudfunctions/manageSubcategory/index.js',
    'cloudfunctions/addWarehouseZone/index.js',
    'cloudfunctions/adminUpdateUserStatus/index.js',
    'cloudfunctions/approveMaterialRequest/index.js',
    'cloudfunctions/exportLabelData/index.js'
  ];
  for (const relPath of managementWriters) {
    const source = read(relPath);
    assert.match(source, /audit-events/);
    assert.match(source, /writeAuditEvent|writePreprintAudit/);
  }
});
