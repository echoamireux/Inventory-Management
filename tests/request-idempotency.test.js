const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadModuleWithMocks(modulePath, mocks) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
  }
}

function createQuery(rows, where = {}) {
  const matches = () => rows.filter(row => (
    Object.entries(where).every(([key, value]) => row[key] === value)
  ));
  const query = {
    field() { return query; },
    limit() { return query; },
    orderBy() { return query; },
    async get() { return { data: matches().map(row => ({ ...row })) }; },
    async count() { return { total: matches().length }; }
  };
  return query;
}

function createReceiptCollection(receipts) {
  return {
    doc(id) {
      return {
        async get() { return { data: receipts.get(id) || null }; },
        async set({ data }) { receipts.set(id, { ...data }); return {}; },
        async update({ data }) {
          receipts.set(id, { ...receipts.get(id), ...data });
          return {};
        }
      };
    }
  };
}

test('concurrent material requests keep one pending record and retry by operation receipt', async () => {
  const requests = [];
  const receipts = new Map();
  let auditCount = 0;
  const user = { _openid: 'openid-user', role: 'user', status: 'active', name: '申请人' };

  const db = {
    command: { or(parts) { return { $or: parts }; } },
    serverDate() { return { $date: true }; },
    async runTransaction(handler) { return handler(db); },
    collection(name) {
      if (name === 'users') return { where(where) { return createQuery([user], where); } };
      if (name === 'materials') return { where(where) { return createQuery([], where); } };
      if (name === 'material_requests') {
        return {
          where(where) { return createQuery(requests, where); },
          async add({ data }) {
            await Promise.resolve();
            if (requests.some(item => item.pending_key === data.pending_key)) {
              throw new Error('duplicate key pending_key unique index');
            }
            const _id = `request-${requests.length + 1}`;
            requests.push({ _id, ...data });
            return { _id };
          }
        };
      }
      if (name === 'operation_receipts') return createReceiptCollection(receipts);
      if (name === 'audit_events') {
        return { async add() { auditCount += 1; return { _id: `audit-${auditCount}` }; } };
      }
      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/addMaterialRequest/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() { return { OPENID: user._openid }; },
      database() { return db; }
    },
    './material-subcategories': {
      ensureBuiltinSubcategories: async () => [],
      sortSubcategoryRecords(records) { return records; },
      filterSubcategoryRecordsByCategory(records) { return records; },
      buildSubcategoryMap() { return new Map(); },
      resolveSubcategorySelection() {
        return { subcategory_key: 'builtin:chemical:solvent', sub_category: '溶剂' };
      }
    },
    './material-units': {
      normalizeUnitInput() { return { ok: true, unit: 'kg' }; }
    }
  });

  const payload = {
    action: 'submit',
    product_code: ' j-001 ',
    category: 'chemical',
    material_name: '异丙醇',
    subcategory_key: 'builtin:chemical:solvent',
    default_unit: 'kg'
  };
  const [first, second] = await Promise.all([
    mod.main({ ...payload, operation_id: 'material_req_op_001' }),
    mod.main({ ...payload, operation_id: 'material_req_op_002' })
  ]);

  assert.equal([first, second].filter(result => result.success).length, 1);
  assert.equal([first, second].filter(result => !result.success).length, 1);
  assert.match([first, second].find(result => !result.success).msg, /已有待审批/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].product_code, 'J-001');
  assert.equal(requests[0].pending_key, 'J-001');
  assert.equal(auditCount, 1);

  const successOperationId = first.success ? 'material_req_op_001' : 'material_req_op_002';
  const retried = await mod.main({ ...payload, operation_id: successOperationId });
  assert.equal(retried.success, true);
  assert.equal(retried.id, requests[0]._id);
  assert.equal(requests.length, 1);
  assert.equal(auditCount, 1);

  requests[0].status = 'rejected';
  delete requests[0].pending_key;
  const resubmitted = await mod.main({ ...payload, operation_id: 'material_req_op_003' });
  assert.equal(resubmitted.success, true);
  assert.equal(requests.filter(item => item.status === 'pending').length, 1);
  assert.equal(requests.length, 2);
});

test('concurrent correction requests keep one pending record and normalize the source log id', async () => {
  const corrections = [];
  const receipts = new Map();
  let auditCount = 0;
  const user = { _openid: 'openid-user', role: 'user', status: 'active', name: '申请人' };
  const log = {
    _id: 'log-1',
    type: 'inbound',
    inventory_id: 'inventory-1',
    unique_code: 'L000001',
    product_code: 'J-001',
    category: 'chemical',
    batch_number: 'B001',
    quantity_change: 5,
    unit: 'kg'
  };
  const inventory = {
    _id: 'inventory-1',
    unique_code: 'L000001',
    product_code: 'J-001',
    category: 'chemical',
    batch_number: 'B001',
    quantity: { val: 5, unit: 'kg' }
  };

  const db = {
    serverDate() { return { $date: true }; },
    async runTransaction(handler) { return handler(db); },
    collection(name) {
      if (name === 'users') return { where(where) { return createQuery([user], where); } };
      if (name === 'inventory_log') {
        return { doc(id) { return { async get() { return { data: id === log._id ? { ...log } : null }; } }; } };
      }
      if (name === 'inventory') {
        return { doc(id) { return { async get() { return { data: id === inventory._id ? { ...inventory } : null }; } }; } };
      }
      if (name === 'inventory_correction_requests') {
        return {
          where(where) { return createQuery(corrections, where); },
          async add({ data }) {
            await Promise.resolve();
            if (corrections.some(item => item.pending_key === data.pending_key)) {
              throw new Error('duplicate key pending_key unique index');
            }
            const _id = `correction-${corrections.length + 1}`;
            corrections.push({ _id, ...data });
            return { _id };
          }
        };
      }
      if (name === 'operation_receipts') return createReceiptCollection(receipts);
      if (name === 'audit_events') {
        return { async add() { auditCount += 1; return { _id: `audit-${auditCount}` }; } };
      }
      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/submitInventoryCorrectionRequest/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() { return { OPENID: user._openid }; },
      database() { return db; }
    }
  });
  const payload = {
    source_log_id: ' log-1 ',
    requested_quantity: 6,
    reason: '称量修正'
  };
  const [first, second] = await Promise.all([
    mod.main({ ...payload, operation_id: 'correction_op_001' }),
    mod.main({ ...payload, operation_id: 'correction_op_002' })
  ]);

  assert.equal([first, second].filter(result => result.success).length, 1);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].source_log_id, 'log-1');
  assert.equal(corrections[0].pending_key, 'log-1');
  assert.equal(auditCount, 1);

  const successOperationId = first.success ? 'correction_op_001' : 'correction_op_002';
  const retried = await mod.main({ ...payload, operation_id: successOperationId });
  assert.equal(retried.success, true);
  assert.equal(retried.id, corrections[0]._id);
  assert.equal(corrections.length, 1);
  assert.equal(auditCount, 1);

  corrections[0].status = 'rejected';
  delete corrections[0].pending_key;
  const resubmitted = await mod.main({ ...payload, operation_id: 'correction_op_003' });
  assert.equal(resubmitted.success, true);
  assert.equal(corrections.filter(item => item.status === 'pending').length, 1);
  assert.equal(corrections.length, 2);
});
