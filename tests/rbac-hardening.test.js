const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
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

test('inventory export cloud function requires an active user before generating a workbook', async () => {
  let aggregateCalled = false;

  const db = {
    command: {},
    serverDate() {
      return { $date: true };
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
                return { data: [{ role: 'user', status: 'pending' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          aggregate() {
            aggregateCalled = true;
            return {
              match() { return this; },
              lookup() { return this; },
              sort() { return this; },
              skip() { return this; },
              limit() { return this; },
              async end() { return { list: [] }; }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/exportData/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-pending' };
      },
      database() {
        return db;
      }
    },
    './export-report': {
      buildInventoryExportFileName() {
        return '库存明细报表.xlsx';
      },
      buildInventoryExportRow() {
        return {};
      },
      async buildInventoryExportWorkbook() {
        throw new Error('workbook should not be built for inactive users');
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      sortZoneRecords(records) { return records; },
      buildZoneMap() { return new Map(); }
    },
    './material-subcategories': {
      ensureBuiltinSubcategories: async () => [],
      sortSubcategoryRecords(records) { return records; },
      buildSubcategoryMap() { return new Map(); }
    }
  });

  const result = await mod.main({}, {});

  assert.equal(result.success, false);
  assert.match(result.msg, /仅已激活用户可导出库存报表/);
  assert.equal(aggregateCalled, false);
});

test('admin-only cloud functions use active-admin mutation gates for write operations', () => {
  const expectations = [
    ['cloudfunctions/addWarehouseZone/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/manageSubcategory/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/adminUpdateUserStatus/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/approveMaterialRequest/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/removeInventory/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/editInventory/index.js', /assertAdminMutationAccess/g],
    ['cloudfunctions/exportMaterialTemplate/index.js', /assertAdminMutationAccess/g]
  ];

  expectations.forEach(([relPath, pattern]) => {
    const file = read(relPath);
    assert.match(file, pattern, `${relPath} should require active admin mutation access`);
  });

  const adminUpdate = read('cloudfunctions/adminUpdateUserStatus/index.js');
  assert.match(adminUpdate, /assertSuperAdminMutationAccess/);
});

test('removeInventory soft-deletes material inventory with doc updates inside the transaction', async () => {
  const file = read('cloudfunctions/removeInventory/index.js');
  const transactionBody = file.match(/db\.runTransaction\(async transaction => \{([\s\S]*?)\n    \}\);/);
  assert.ok(transactionBody, 'expected removeInventory to use a transaction');
  assert.doesNotMatch(transactionBody[1], /transaction\.collection\('inventory'\)\.where\([\s\S]*?\.update\(/);
  assert.match(file, /loadInventoryIdsByMaterialId/);
  assert.match(file, /affected_inventory_count/);

  const inventoryDocs = [
    { _id: 'inv-1', material_id: 'mat-1', material_name: '库存快照名' },
    { _id: 'inv-2', material_id: 'mat-1', material_name: '库存快照名' }
  ];
  const inventoryUpdates = [];
  let logPayload = null;

  const db = {
    command: {},
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where(query) {
            assert.deepEqual(query, { _openid: 'openid-admin' });
            return {
              async get() {
                return { data: [{ role: 'admin', status: 'active', name: '管理员' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where(query) {
            assert.deepEqual(query, { material_id: 'mat-1' });
            return {
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
                return { data: inventoryDocs.slice(skip, skip + limit) };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    runTransaction(fn) {
      const transaction = {
        collection(name) {
          if (name === 'users') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [{ role: 'admin', status: 'active', name: '管理员' }] };
                  }
                };
              }
            };
          }

          if (name === 'materials') {
            return {
              doc(id) {
                assert.equal(id, 'mat-1');
                return {
                  async get() {
                    return { data: { _id: 'mat-1', material_name: '正式物料名', name: '旧字段名' } };
                  },
                  async update({ data }) {
                    assert.equal(data.status, 'deleted');
                  }
                };
              }
            };
          }

          if (name === 'inventory') {
            return {
              where() {
                throw new Error('transaction inventory where update should not be used');
              },
              doc(id) {
                return {
                  async update({ data }) {
                    inventoryUpdates.push({ id, data });
                  }
                };
              }
            };
          }

          if (name === 'inventory_log') {
            return {
              async add({ data }) {
                logPayload = data;
              }
            };
          }

          throw new Error(`unexpected transaction collection: ${name}`);
        }
      };
      return fn(transaction);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/removeInventory/index.js', {
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

  const result = await mod.main({ material_id: 'mat-1', operator_name: '张三' }, {});

  assert.equal(result.success, true);
  assert.deepEqual(inventoryUpdates.map(item => item.id), ['inv-1', 'inv-2']);
  assert.equal(logPayload.material_name, '正式物料名');
  assert.equal(logPayload.affected_inventory_count, 2);
  assert.equal(logPayload.inventory_id, 'N/A');
  assert.equal(logPayload.operator, '张三');
});

test('removeInventory rejects unauthorized users before scanning material inventory ids', async () => {
  let inventoryScanned = false;
  let transactionStarted = false;

  const db = {
    collection(name) {
      if (name === 'users') {
        return {
          where(query) {
            assert.deepEqual(query, { _openid: 'openid-disabled' });
            return {
              async get() {
                return { data: [{ role: 'admin', status: 'disabled', name: '停用管理员' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        inventoryScanned = true;
        throw new Error('unauthorized deletion should not scan inventory ids');
      }

      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    runTransaction() {
      transactionStarted = true;
      throw new Error('unauthorized deletion should not start a transaction');
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/removeInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-disabled' };
      },
      database() {
        return db;
      }
    }
  });

  const originalError = console.error;
  let result;
  try {
    console.error = () => {};
    result = await mod.main({ material_id: 'mat-1', operator_name: '停用管理员' }, {});
  } finally {
    console.error = originalError;
  }

  assert.equal(result.success, false);
  assert.equal(inventoryScanned, false);
  assert.equal(transactionStarted, false);
});

test('material add archived-product branch exposes a working contact-admin handler', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');
  const pageWxml = read('miniprogram/pages/material-add/index.wxml');

  assert.match(pageWxml, /bind:click="onContactAdmin"/);
  assert.match(pageJs, /onContactAdmin\s*\(/);
  assert.match(pageJs, /请联系管理员恢复该物料后再入库/);
});

test('material approval creation writes governed master-data fields', () => {
  const file = read('cloudfunctions/approveMaterialRequest/index.js');

  assert.match(file, /buildGovernedMaterialMasterFields/);
  assert.match(file, /package_type/);
  assert.match(file, /thickness_um/);
  assert.match(file, /standard_width_mm/);
  assert.match(file, /default_unit:\s*normalizedUnit\.unit/);
});

test('retired log deletion functions return disabled messages without database auth work', () => {
  ['cloudfunctions/removeLog/index.js', 'cloudfunctions/batchRemoveLog/index.js'].forEach((relPath) => {
    const file = read(relPath);

    assert.match(file, /日志删除已停用/);
    assert.doesNotMatch(file, /db\.collection\('users'\)/);
    assert.doesNotMatch(file, /assertAdminAccess/);
  });
});

test('addMaterial performs duplicate label lookup inside the write transaction', () => {
  const file = read('cloudfunctions/addMaterial/index.js');
  const transactionBody = file.match(/db\.runTransaction\(async transaction => \{([\s\S]*?)\n    \}\);/);

  assert.ok(transactionBody, 'expected addMaterial to use a transaction');
  assert.match(transactionBody[1], /transaction\.collection\('inventory'\)[\s\S]*where\(\{\s*unique_code:\s*normalizedUniqueCode\s*\}\)/);
});

test('grouped inventory query uses aggregate grouping before pagination and keeps risk filters wired', () => {
  const file = read('cloudfunctions/getInventoryGrouped/index.js');

  assert.match(file, /aggregate\(\)/);
  assert.match(file, /\.group\(/);
  assert.match(file, /normalizedFilter === 'risk'/);
  assert.match(file, /normalizedFilter === 'expiry'/);
  assert.match(file, /normalizedFilter === 'low_stock'/);
  assert.doesNotMatch(file, /inventoryItems\s*=\s*inventoryItems\.concat/);
});
