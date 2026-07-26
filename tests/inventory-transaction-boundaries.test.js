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
  let skipValue = 0;
  let limitValue = rows.length;
  const orders = [];
  const query = {
    orderBy(field, direction) { orders.push([field, direction]); return query; },
    skip(value) { skipValue = Number(value) || 0; return query; },
    limit(value) { limitValue = Number(value) || 0; return query; },
    field() { return query; },
    async get() {
      const filtered = rows
        .filter(row => Object.entries(where).every(([key, value]) => row[key] === value))
        .sort((left, right) => {
          for (const [field, direction] of orders) {
            const leftValue = left[field] instanceof Date ? left[field].getTime() : left[field];
            const rightValue = right[field] instanceof Date ? right[field].getTime() : right[field];
            if (leftValue === rightValue) continue;
            const result = leftValue > rightValue ? 1 : -1;
            return direction === 'desc' ? -result : result;
          }
          return 0;
        });
      return { data: filtered.slice(skipValue, skipValue + limitValue).map(row => ({ ...row })) };
    }
  };
  return query;
}

function createHarness({ candidates, transactionUser }) {
  const outsideUser = { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' };
  const project = { project_code: 'OR2026RD02001', project_name: '项目一', status: 'active' };
  const material = { product_code: 'J-001', status: 'active', is_test_material: false };
  const receipts = new Map();
  const updatedIds = [];
  let candidateRowsRead = 0;

  function receiptCollection() {
    return {
      doc(id) {
        return {
          async get() { return { data: receipts.get(id) || null }; },
          async set({ data }) { receipts.set(id, { ...data }); return {}; },
          async update({ data }) { receipts.set(id, { ...receipts.get(id), ...data }); return {}; }
        };
      }
    };
  }

  const db = {
    serverDate() { return { $date: true }; },
    collection(name) {
      if (name === 'users') return { where(where) { return createQuery([outsideUser], where); } };
      if (name === 'project_codes') return { where(where) { return createQuery([project], where); } };
      if (name === 'materials') return { where(where) { return createQuery([material], where); } };
      throw new Error(`unexpected outside collection: ${name}`);
    },
    async runTransaction(handler) {
      return handler({
        collection(name) {
          if (name === 'users') return { where(where) { return createQuery([transactionUser], where); } };
          if (name === 'project_codes') return { where(where) { return createQuery([project], where); } };
          if (name === 'operation_receipts') return receiptCollection();
          if (name === 'inventory') {
            return {
              where(where) {
                const query = createQuery(candidates, where);
                const originalGet = query.get;
                query.get = async () => {
                  const result = await originalGet();
                  candidateRowsRead += result.data.length;
                  return result;
                };
                return query;
              },
              doc(id) {
                return {
                  async update() { updatedIds.push(id); return {}; }
                };
              }
            };
          }
          if (name === 'inventory_log' || name === 'audit_events') {
            return { async add() { return { _id: `${name}-1` }; } };
          }
          throw new Error(`unexpected transaction collection: ${name}`);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/updateInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() { return { OPENID: outsideUser._openid }; },
      database() { return db; }
    }
  });

  async function withdraw(operationId = 'withdraw_boundary_001', withdrawAmount = 1) {
    const originalError = console.error;
    try {
      console.error = () => {};
      return await mod.main({
        product_code: 'J-001',
        withdraw_amount: withdrawAmount,
        project_code: project.project_code,
        operation_id: operationId
      });
    } finally {
      console.error = originalError;
    }
  }

  return {
    withdraw,
    updatedIds,
    getCandidateRowsRead: () => candidateRowsRead
  };
}

function buildCandidate(index, quantity, overrides = {}) {
  return {
    _id: `inventory-${String(index).padStart(4, '0')}`,
    material_id: 'material-1',
    material_name: '异丙醇',
    category: 'chemical',
    product_code: 'J-001',
    unique_code: `L${String(index).padStart(6, '0')}`,
    batch_number: 'B001',
    status: 'in_stock',
    expiry_date: '2026-12-31',
    create_time: new Date(2026, 0, index),
    quantity: { val: quantity, unit: 'kg' },
    ...overrides
  };
}

test('withdrawal rechecks user status inside the transaction', async () => {
  const harness = createHarness({
    candidates: [buildCandidate(1, 2)],
    transactionUser: { _openid: 'openid-user', role: 'user', status: 'disabled', name: '领料人' }
  });

  const result = await harness.withdraw('withdraw_disabled_001');
  assert.equal(result.success, false);
  assert.match(result.msg, /用户状态或角色已变化/);
  assert.equal(harness.updatedIds.length, 0);
  assert.equal(harness.getCandidateRowsRead(), 0);
});

test('all inbound write paths recheck the active operator inside their transaction', () => {
  for (const relPath of [
    'cloudfunctions/addMaterial/index.js',
    'cloudfunctions/batchAddInventory/index.js',
    'cloudfunctions/importInventoryTemplate/index.js',
    'cloudfunctions/updateInventory/index.js'
  ]) {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', relPath), 'utf8');
    assert.match(source, /transactionOperator|getTransactionOperator/);
    assert.match(source, /assertActiveInventoryAccess/);
    assert.match(source, /用户状态或角色已变化/);
  }
});

test('withdrawal uses transaction-time FEFO order and stops after enough inventory', async () => {
  const harness = createHarness({
    candidates: [
      buildCandidate(2, 1, { expiry_date: '2026-08-01' }),
      buildCandidate(1, 1, { expiry_date: '2026-07-01' })
    ],
    transactionUser: { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' }
  });

  const result = await harness.withdraw('withdraw_fefo_001');
  assert.equal(result.success, true);
  assert.deepEqual(harness.updatedIds, ['inventory-0001']);
  assert.equal(harness.getCandidateRowsRead(), 2);
});

test('withdrawal can reach the 500th candidate but never reads the 501st', async () => {
  const withinLimit = Array.from({ length: 500 }, (_, index) => (
    buildCandidate(index + 1, index === 499 ? 1 : 0)
  ));
  const allowedHarness = createHarness({
    candidates: withinLimit,
    transactionUser: { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' }
  });

  const allowed = await allowedHarness.withdraw('withdraw_limit_500');
  assert.equal(allowed.success, true);
  assert.deepEqual(allowedHarness.updatedIds, ['inventory-0500']);
  assert.equal(allowedHarness.getCandidateRowsRead(), 500);

  const overLimitHarness = createHarness({
    candidates: [...withinLimit.map(item => ({ ...item, quantity: { val: 0, unit: 'kg' } })), buildCandidate(501, 1)],
    transactionUser: { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' }
  });
  const blocked = await overLimitHarness.withdraw('withdraw_limit_501');
  assert.equal(blocked.success, false);
  assert.match(blocked.msg, /库存范围过大/);
  assert.equal(overLimitHarness.updatedIds.length, 0);
  assert.equal(overLimitHarness.getCandidateRowsRead(), 500);
});

// B1 回归：扣减侧曾用 Math.floor(deduct * 1000) / 1000 截断，而解析侧用 Math.round，
// 两边口径不一致。二进制浮点下 2.01 * 1000 = 2009.9999999999998，floor 会少扣 0.001，
// 残留量最终触发「库存不足」误判。0.001~100.000 区间内共 741 个数值受影响。
test('withdrawal deducts three-decimal amounts without floating-point truncation', async () => {
  // 这些数值在 floor 口径下全部会失败：一位小数 32.3，两位小数 2.01，三位小数 1.001
  for (const amount of [2.01, 1.001, 32.3]) {
    const harness = createHarness({
      candidates: [buildCandidate(1, 100)],
      transactionUser: { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' }
    });

    const res = await harness.withdraw(`withdraw_precision_${String(amount).replace('.', '_')}`, amount);

    assert.equal(res.success, true, `领用 ${amount} 应当成功，实际：${res.msg || ''}`);
    assert.deepEqual(harness.updatedIds, ['inventory-0001']);
  }
});

test('withdrawal can empty a batch whose stock has a three-decimal tail', async () => {
  // 全额领用带三位小数尾数的批次：floor 口径下会残留 0.001 而报「库存不足」
  const harness = createHarness({
    candidates: [buildCandidate(1, 1.001)],
    transactionUser: { _openid: 'openid-user', role: 'user', status: 'active', name: '领料人' }
  });

  const res = await harness.withdraw('withdraw_precision_exact', 1.001);

  assert.equal(res.success, true, `全额领用应当成功，实际：${res.msg || ''}`);
  assert.deepEqual(harness.updatedIds, ['inventory-0001']);
});
