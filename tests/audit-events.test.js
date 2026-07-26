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
      if (expected && expected.$lte) {
        return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
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
      lte(value) {
        return { $lte: value };
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
      const baseQuery = createQuery(name, {});
      return {
        orderBy: baseQuery.orderBy,
        skip: baseQuery.skip,
        limit: baseQuery.limit,
        get: baseQuery.get,
        count: baseQuery.count,
        where(where) {
          return createQuery(name, where);
        }
      };
    }
  };

  return { db, queriedCollections, collections };
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

function loadGetOperators(memory, openid = 'openid-admin') {
  return loadModuleWithMocks('../cloudfunctions/getOperators/index.js', {
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

test('getLogs audit scope does not build an empty search regexp when search is blank', async () => {
  const memory = createGetLogsDatabase();
  memory.db.RegExp = ({ regexp, options }) => {
    if (!regexp) {
      throw new Error('regexp must be a string');
    }
    return new RegExp(regexp, options);
  };
  const mod = loadGetLogs(memory, 'openid-admin');

  const result = await mod.main({
    logScope: 'audit',
    searchVal: ''
  });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0]._id, 'audit-1');
});

test('getLogs supports explicit custom date ranges for inventory and audit scopes', async () => {
  const memory = createGetLogsDatabase();
  memory.collections.inventory_log.push({
    _id: 'inv-log-old',
    type: 'inbound',
    product_code: 'J-OLD',
    material_name: '旧库存流水',
    operator: '库管员',
    timestamp: new Date('2026-07-08T01:00:00.000Z')
  });
  memory.collections.audit_events.push({
    _id: 'audit-later',
    domain: 'material',
    action: 'update',
    actor_name: '管理员',
    target_label: 'J-LATER',
    search_text: 'material update 管理员 J-LATER',
    timestamp: new Date('2026-07-12T02:00:00.000Z')
  });
  const mod = loadGetLogs(memory, 'openid-admin');

  const inventoryResult = await mod.main({
    logScope: 'inventory',
    dateFilter: 'custom',
    startDate: '2026-07-10',
    endDate: '2026-07-10'
  });
  const auditResult = await mod.main({
    logScope: 'audit',
    dateFilter: 'custom',
    startDate: '2026-07-10',
    endDate: '2026-07-10'
  });

  assert.equal(inventoryResult.success, true);
  assert.deepEqual(inventoryResult.list.map(item => item._id), ['inv-log-1']);
  assert.equal(auditResult.success, true);
  assert.deepEqual(auditResult.list.map(item => item._id), ['audit-1']);
});

test('getLogs enriches id-only operator rows and filters by visible operator name', async () => {
  const memory = createGetLogsDatabase();
  memory.collections.inventory_log.push({
    _id: 'inv-log-id-only',
    type: 'outbound',
    product_code: 'J-002',
    material_name: '旧领用流水',
    operator: 'System',
    operator_id: 'openid-user',
    timestamp: new Date('2026-07-11T01:00:00.000Z')
  });
  memory.collections.audit_events.push({
    _id: 'audit-id-only',
    domain: 'test_material_identity',
    action: 'create',
    actor_id: 'openid-user',
    actor_name: 'System',
    target_type: 'test_material_identity',
    target_label: 'J-999 / 75TI',
    search_text: 'test_material_identity create openid-user J-999 75TI',
    timestamp: new Date('2026-07-11T02:00:00.000Z')
  });
  const mod = loadGetLogs(memory, 'openid-admin');

  const inventoryResult = await mod.main({
    logScope: 'inventory',
    operatorFilter: '普通用户'
  });
  const auditResult = await mod.main({
    logScope: 'audit',
    operatorFilter: '普通用户'
  });

  assert.equal(inventoryResult.success, true);
  assert.deepEqual(inventoryResult.list.map(item => item._id), ['inv-log-id-only']);
  assert.equal(inventoryResult.list[0].operator, '普通用户');
  assert.equal(inventoryResult.list[0].operator_name, '普通用户');
  assert.equal(auditResult.success, true);
  assert.deepEqual(auditResult.list.map(item => item._id), ['audit-id-only']);
  assert.equal(auditResult.list[0].actor_name, '普通用户');
});

test('getOperators resolves visible names from id-only log rows', async () => {
  const memory = createGetLogsDatabase();
  memory.collections.inventory_log.push({
    _id: 'inv-log-id-only-operator',
    type: 'outbound',
    product_code: 'J-002',
    material_name: '旧领用流水',
    operator: 'System',
    operator_id: 'openid-user',
    timestamp: new Date('2026-07-11T01:00:00.000Z')
  });
  memory.collections.audit_events.push({
    _id: 'audit-id-only-operator',
    domain: 'test_material_identity',
    action: 'create',
    actor_id: 'openid-user',
    actor_name: 'System',
    target_label: 'J-999 / 75TI',
    timestamp: new Date('2026-07-11T02:00:00.000Z')
  });
  const mod = loadGetOperators(memory, 'openid-admin');

  const inventoryResult = await mod.main({ logScope: 'inventory' });
  const auditResult = await mod.main({ logScope: 'audit' });

  assert.equal(inventoryResult.success, true);
  assert(inventoryResult.list.includes('普通用户'));
  assert(!inventoryResult.list.includes('System'));
  assert(!inventoryResult.list.includes('openid-user'));
  assert.equal(auditResult.success, true);
  assert(auditResult.list.includes('普通用户'));
  assert(!auditResult.list.includes('System'));
  assert(!auditResult.list.includes('openid-user'));
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

test('all governed master-data mutations write business changes and audit events through the same transaction', () => {
  const masterWriters = [
    'cloudfunctions/manageProjectCode/index.js',
    'cloudfunctions/manageSubcategory/index.js',
    'cloudfunctions/addWarehouseZone/index.js',
    'cloudfunctions/manageTestMaterialIdentity/index.js',
    'cloudfunctions/manageProductCodePrefix/index.js'
  ];

  for (const relPath of masterWriters) {
    const source = read(relPath);
    assert.match(source, /runTransaction/);
    assert.match(source, /write(?:Project|Subcategory|Warehouse|Identity|Prefix)Audit\([^\n]*transaction|writeAuditEvent\(transaction/);
    assert.equal(
      source.includes("normalized === 'active' || normalized === 'disabled'"),
      true
    );
  }
});

// F1 回归：四个入库写入点中，addMaterial 的 inboundLog 曾唯独漏写 unique_code。
// 后果是 log-search 按 _.or([{unique_code}, {inventory_id}]) 检索时两个字段都对不上，
// 标签详情页的操作历史里永远没有「初始录入」，挂在 type==='inbound' 上的
// 「发起纠错申请」入口也随之在标签维度不可达。
test('single stock-in log carries unique_code like every other inbound path', () => {
  const source = read('cloudfunctions/addMaterial/index.js');
  const inboundLog = source.match(/const inboundLog = \{[\s\S]*?\n {6}\};/);

  assert.ok(inboundLog, 'addMaterial 应存在 inboundLog');
  assert.match(inboundLog[0], /unique_code:/, 'inboundLog 必须写入 unique_code');
});

// F2 回归：inventory_log 的 10 个写入点此前从未写入 supplier_model /
// supplier_model_key / batch_number，而 getLogs 的搜索字段清单、
// getProjectUsageReport 的分组键、exportProjectUsageReport 的导出列都依赖它们 ——
// 结果是这三个维度的日志搜索恒为空，且项目用料汇总把同一产品代码下不同原厂型号
// 的测试料合并成一行，直接抵消测试料身份治理的意义。
test('shared helper builds the inventory log identity fields', () => {
  const { buildInventoryLogIdentityFields } = require('../cloudfunctions/_shared/inventory-quantity.js');

  assert.deepEqual(
    buildInventoryLogIdentityFields(),
    { supplier_model: '', supplier_model_key: '', batch_number: '' },
    '缺失来源时应返回空串而非 undefined，避免写入 undefined 字段'
  );
  assert.deepEqual(
    buildInventoryLogIdentityFields({
      supplier_model: ' AB-100 ',
      supplier_model_key: 'ab-100',
      batch_number: 'B001',
      irrelevant: 'x'
    }),
    { supplier_model: 'AB-100', supplier_model_key: 'ab-100', batch_number: 'B001' },
    '应规范化文本并只取这三个字段'
  );
});

test('every inventory_log write point carries the identity and batch fields', () => {
  // 直接构造日志对象的写入点：必须显式带上三个字段（或经共享 helper 展开）
  const directWriters = [
    ['cloudfunctions/addMaterial/index.js', 2],                       // inboundLog + refillLog
    ['cloudfunctions/updateInventory/index.js', 1],                   // 出库 logs.push
    ['cloudfunctions/approveInventoryCorrectionRequest/index.js', 1], // correctionLog
    ['cloudfunctions/editInventory/index.js', 3],                     // 幅宽 / 盘点 / 移库
    ['cloudfunctions/importInventoryTemplate/index.js', 1]            // 补料 refillLog
  ];

  for (const [relPath, expected] of directWriters) {
    const source = read(relPath);
    const hits = (source.match(/buildInventoryLogIdentityFields\(/g) || []).length;
    assert.equal(
      hits, expected,
      `${relPath} 应有 ${expected} 处调用 buildInventoryLogIdentityFields，实际 ${hits} 处`
    );
  }

  // 经共享构造器产出 logData 的写入点：字段写在构造器里
  for (const relPath of [
    'cloudfunctions/_shared/batch-add.js',
    'cloudfunctions/importInventoryTemplate/inventory-import.js'
  ]) {
    const logData = read(relPath).match(/logData: \{[\s\S]*?\n {4}\}/);
    assert.ok(logData, `${relPath} 应存在 logData 构造`);
    for (const field of ['supplier_model', 'supplier_model_key', 'batch_number']) {
      assert.match(logData[0], new RegExp(`${field}:`), `${relPath} 的 logData 缺少 ${field}`);
    }
  }
});
