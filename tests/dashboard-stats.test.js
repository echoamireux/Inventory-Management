const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
  calculateDashboardStatsFromItems
} = require('../cloudfunctions/_shared/dashboard-stats');

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

test('dashboard stats count unique products and risky products correctly', () => {
  const now = Date.now();
  const alertConfig = {
    EXPIRY_DAYS: 30,
    LOW_STOCK: {
      chemical: 5,
      film: 20
    }
  };
  const items = [
    {
      product_code: 'J-001',
      category: 'chemical',
      quantity: { val: 3 }
    },
    {
      product_code: 'J-001',
      category: 'chemical',
      quantity: { val: 10 }
    },
    {
      product_code: 'M-001',
      category: 'film',
      dynamic_attrs: { current_length_m: 100 },
      expiry_date: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      product_code: 'M-002',
      category: 'film',
      dynamic_attrs: { current_length_m: 200 }
    }
  ];

  assert.deepEqual(calculateDashboardStatsFromItems(items, alertConfig), {
    totalMaterials: 3,
    lowStock: 1,
    riskCount: 1
  });
});

test('dashboard todayIn counts both inbound and refill logs as inventory-increasing actions', async () => {
  const logQueries = [];

  const mod = loadModuleWithMocks('../cloudfunctions/getDashboardStats/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return {
          command: {
            gte(value) {
              return { $gte: value };
            },
            in(values) {
              return { $in: values };
            },
            or(...values) {
              return { $or: values };
            },
            eq(value) {
              return { $eq: value };
            },
            aggregate: {
              first(value) {
                return value;
              },
              min(value) {
                return value;
              },
              sum(value) {
                return value;
              }
            }
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return this;
                    },
                    async get() {
                      return {
                        data: [{ role: 'user', status: 'active', name: '操作员A' }]
                      };
                    }
                  };
                }
              };
            }

            if (name === 'inventory_log') {
              return {
                where(query) {
                  logQueries.push(query);
                  return {
                    async count() {
                      if (
                        query.type
                        && query.type.$in
                        && query.type.$in.includes('inbound')
                        && query.type.$in.includes('refill')
                      ) {
                        return { total: 3 };
                      }
                      return { total: 2 };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where(query) {
                  assert.deepEqual(query, { status: 'in_stock' });
                  return {
                    field() {
                      return this;
                    },
                    skip() {
                      return this;
                    },
                    limit() {
                      return this;
                    },
                    async get() {
                      return { data: [] };
                    }
                  };
                }
              };
            }

            throw new Error(`unexpected collection: ${name}`);
          }
        };
      }
    },
    './alert-config': {
      EXPIRY_DAYS: 30,
      LOW_STOCK: {
        chemical: 5,
        film: 20
      }
    },
    './cst-time': {
      getCstDayStart() {
        return new Date('2026-03-26T00:00:00.000Z');
      }
    }
  });

  const result = await mod.main({});

  assert.equal(result.success, true);
  assert.equal(result.todayIn, 3);
  assert.ok(logQueries.some(query => query.type && query.type.$in && query.type.$in.includes('refill')));
});

test('dashboard stats loads all inventory pages before calculating grouped risk counts', async () => {
  const inventoryRows = Array.from({ length: 1005 }, (_, index) => ({
    product_code: `J-${String(index + 1).padStart(4, '0')}`,
    category: 'chemical',
    quantity: { val: 10 }
  }));
  const requestedPages = [];

  const mod = loadModuleWithMocks('../cloudfunctions/getDashboardStats/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return {
          command: {
            gte(value) {
              return { $gte: value };
            },
            in(values) {
              return { $in: values };
            },
            or(...values) {
              return { $or: values };
            },
            eq(value) {
              return { $eq: value };
            }
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return this;
                    },
                    async get() {
                      return {
                        data: [{ role: 'user', status: 'active', name: '操作员A' }]
                      };
                    }
                  };
                }
              };
            }

            if (name === 'inventory_log') {
              return {
                where() {
                  return {
                    async count() {
                      return { total: 0 };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                aggregate() {
                  throw new Error('dashboard stats should not aggregate with a fixed 1000 group cap');
                },
                where(query) {
                  assert.deepEqual(query, { status: 'in_stock' });
                  return {
                    field() {
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
                      const skip = this._skip || 0;
                      const limit = this._limit || 100;
                      requestedPages.push({ skip, limit });
                      return { data: inventoryRows.slice(skip, skip + limit) };
                    }
                  };
                }
              };
            }

            throw new Error(`unexpected collection: ${name}`);
          }
        };
      }
    },
    './alert-config': {
      EXPIRY_DAYS: 30,
      LOW_STOCK: {
        chemical: 5,
        film: 20
      }
    },
    './cst-time': {
      getCstDayStart() {
        return new Date('2026-03-26T00:00:00.000Z');
      }
    },
    './dashboard-stats': {
      calculateDashboardStatsFromItems
    }
  });

  const result = await mod.main({});

  assert.equal(result.success, true);
  assert.equal(result.totalMaterials, 1005);
  assert.equal(result.riskCount, 0);
  assert.ok(requestedPages.length > 1);
});
