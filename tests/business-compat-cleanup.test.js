const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

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

test('editInventory rejects legacy location text update fields', async () => {
  const transaction = {
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{ role: 'admin', status: 'active' }]
                };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          doc() {
            return {
              async get() {
                return {
                  data: { _id: 'inv-1', category: 'chemical' }
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const db = {
    runTransaction(fn) {
      return fn(transaction);
    }
  };

  const cloudStub = {
    init() {},
    getWXContext() {
      return { OPENID: 'openid-1' };
    },
    database() {
      return db;
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/editInventory/index.js', {
    'wx-server-sdk': cloudStub,
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {
          zone_key: 'builtin:chemical:lab1',
          location_detail: 'A-01',
          location_text: '实验室1 | A-01',
          location: '实验室1 | A-01'
        };
      },
      resolveInventoryLocationText() {
        return '实验室1';
      }
    }
  });

  const originalConsoleError = console.error;
  let result;
  try {
    console.error = () => {};
    result = await mod.main({
      inventory_id: 'inv-1',
      updates: {
        location: '旧区域 | A-01'
      }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.success, false);
  assert.match(result.msg, /Unsupported update fields: location/);
});

test('editInventory requires admin access for film width correction and logs the before/after audit trail', async () => {
  let updatedPayload = null;
  let loggedPayload = null;

  const transaction = {
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{ role: 'admin', status: 'active', name: '库存管理员' }]
                };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          doc() {
            return {
              async get() {
                return {
                  data: {
                    _id: 'inv-film-1',
                    material_id: 'mat-film-1',
                    material_name: 'PET保护膜',
                    category: 'film',
                    product_code: 'M-005',
                    unique_code: 'L000004',
                    quantity: { val: 246, unit: 'm²' },
                    dynamic_attrs: {
                      current_length_m: 200,
                      initial_length_m: 200,
                      width_mm: 1230
                    }
                  }
                };
              },
              async update({ data }) {
                updatedPayload = data;
                return {};
              }
            };
          }
        };
      }

      if (name === 'inventory_log') {
        return {
          async add({ data }) {
            loggedPayload = data;
            return { _id: 'log-1' };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const db = {
    serverDate() {
      return { $date: true };
    },
    runTransaction(fn) {
      return fn(transaction);
    }
  };

  const cloudStub = {
    init() {},
    getWXContext() {
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/editInventory/index.js', {
    'wx-server-sdk': cloudStub,
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      },
      assertAdminAccess() {
        return { ok: true };
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {};
      },
      resolveInventoryLocationText() {
        return '研发仓2';
      }
    }
  });

  const result = await mod.main({
    inventory_id: 'inv-film-1',
    operator_name: '库存管理员',
    updates: {
      width_mm: 1250,
      adjust_reason: '实测纠偏'
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(updatedPayload['dynamic_attrs.width_mm'], 1250);
  assert.equal(updatedPayload['quantity.val'], 250);
  assert.equal(loggedPayload.type, 'adjust');
  assert.equal(loggedPayload.action, '修正幅宽');
  assert.match(loggedPayload.description, /1230/);
  assert.match(loggedPayload.description, /1250/);
  assert.match(loggedPayload.description, /实测纠偏/);
});

test('addMaterialRequest no longer writes suggested_sub_category', async () => {
  let insertedRequest = null;

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'material_requests') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            insertedRequest = data;
            return { _id: 'req-1' };
          }
        };
      }

      if (name === 'materials') {
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

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const cloudStub = {
    init() {},
    getWXContext() {
      return { OPENID: 'openid-2' };
    },
    database() {
      return db;
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/addMaterialRequest/index.js', {
    'wx-server-sdk': cloudStub,
    './material-subcategories': {
      ensureBuiltinSubcategories: async () => [],
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records) {
        return records;
      },
      buildSubcategoryMap() {
        return new Map();
      },
      resolveSubcategorySelection() {
        return {
          subcategory_key: 'builtin:chemical:solvent',
          sub_category: '溶剂'
        };
      }
    }
  });

  const result = await mod.main({
    product_code: 'J-001',
    category: 'chemical',
    material_name: '异丙醇',
    subcategory_key: 'builtin:chemical:solvent',
    sub_category: '溶剂',
    supplier: '供应商A',
    suggested_sub_category: '旧建议'
  });

  assert.equal(result.success, true);
  assert.ok(insertedRequest);
  assert.equal(Object.prototype.hasOwnProperty.call(insertedRequest, 'suggested_sub_category'), false);
});

test('material add page routes request submission through the addMaterialRequest cloud function', () => {
  const fs = require('node:fs');
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );

  assert.match(file, /name:\s*'addMaterialRequest'/);
  assert.match(file, /action:\s*'submit'/);
  assert.doesNotMatch(file, /db\.collection\('material_requests'\)\.add/);
});

test('my-requests loads only current applicant records through the cloud function path', async () => {
  let pageConfig = null;
  let callPayload = null;

  global.Page = (config) => {
    pageConfig = config;
  };

  global.wx = {
    cloud: {
      database() {
        throw new Error('should not query material_requests directly from page');
      },
      callFunction: async (payload) => {
        callPayload = payload;
        return {
          result: {
            success: true,
            list: [
              {
                _id: 'req-1',
                product_code: 'J-001',
                category: 'chemical',
                material_name: '异丙醇',
                sub_category: '溶剂',
                status: 'pending',
                supplier: '供应商A',
                created_at: new Date('2026-03-22T08:00:00.000Z')
              }
            ]
          }
        };
      }
    },
    showToast() {}
  };

  const pagePath = path.resolve(
    process.cwd(),
    'miniprogram/pages/my-requests/index.js'
  );
  delete require.cache[pagePath];
  require(pagePath);

  assert.ok(pageConfig);

  const instance = {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(next) {
      this.data = Object.assign({}, this.data, next);
    }
  };

  const originalConsoleError = console.error;
  try {
    console.error = () => {};
    await pageConfig.fetchRequests.call(instance);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.list.length, 1);
  assert.deepEqual(callPayload, {
    name: 'addMaterialRequest',
    data: {
      action: 'listMine'
    }
  });
  assert.equal(instance.data.list[0].statusText, '待审核');
});
