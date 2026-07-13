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

function createOperationReceiptCollection(store = new Map()) {
  return {
    doc(id) {
      return {
        async get() {
          return { data: store.get(id) || null };
        },
        async set({ data }) {
          store.set(id, { ...data });
          return {};
        },
        async update({ data }) {
          store.set(id, { ...store.get(id), ...data });
          return {};
        }
      };
    }
  };
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
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail: 'A-01',
          location_text: '防爆柜01 | A-01',
          location: '防爆柜01 | A-01'
        };
      },
      resolveInventoryLocationText() {
        return '防爆柜01';
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

      if (name === 'operation_receipts') {
        return createOperationReceiptCollection();
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
      assertAdminMutationAccess() {
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
    operation_id: 'op_edit_width_001',
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

test('editInventory stocktake adjustment updates chemical current quantity and writes an audit log', async () => {
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
                    _id: 'inv-chemical-1',
                    material_id: 'mat-chemical-1',
                    material_name: 'UV减粘胶',
                    category: 'chemical',
                    product_code: 'J-008',
                    unique_code: 'L000108',
                    quantity: { val: 10, unit: 'kg' },
                    dynamic_attrs: { weight_kg: 10 }
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
            return { _id: 'log-stocktake-1' };
          }
        };
      }

      if (name === 'operation_receipts') {
        return createOperationReceiptCollection();
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

  const mod = loadModuleWithMocks('../cloudfunctions/editInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-admin' };
      },
      database() {
        return db;
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      },
      assertAdminMutationAccess() {
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
        return '防爆柜01';
      }
    }
  });

  const result = await mod.main({
    inventory_id: 'inv-chemical-1',
    operation_id: 'op_edit_stocktake_chemical_001',
    operator_name: '库存管理员',
    updates: {
      stocktake_quantity: 7.5,
      adjust_reason: '盘点称重'
    }
  });

  assert.equal(result.success, true);
  assert.equal(updatedPayload['quantity.val'], 7.5);
  assert.equal(updatedPayload['dynamic_attrs.weight_kg'], 7.5);
  assert.equal(loggedPayload.type, 'adjust');
  assert.equal(loggedPayload.action, '盘点调整');
  assert.equal(loggedPayload.quantity_change, -2.5);
  assert.match(loggedPayload.description, /10 kg/);
  assert.match(loggedPayload.description, /7.5 kg/);
  assert.match(loggedPayload.description, /盘点称重/);
});

test('editInventory stocktake adjustment updates film current length without changing initial length', async () => {
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
                    _id: 'inv-film-2',
                    material_id: 'mat-film-2',
                    material_name: 'PET离型膜',
                    category: 'film',
                    product_code: 'M-008',
                    unique_code: 'L000208',
                    quantity: { val: 120, unit: 'm²' },
                    dynamic_attrs: {
                      current_length_m: 100,
                      initial_length_m: 200,
                      width_mm: 1200
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
            return { _id: 'log-stocktake-2' };
          }
        };
      }

      if (name === 'operation_receipts') {
        return createOperationReceiptCollection();
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

  const mod = loadModuleWithMocks('../cloudfunctions/editInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-admin' };
      },
      database() {
        return db;
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      },
      assertAdminMutationAccess() {
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
        return '研发仓1';
      }
    }
  });

  const result = await mod.main({
    inventory_id: 'inv-film-2',
    operation_id: 'op_edit_stocktake_film_001',
    operator_name: '库存管理员',
    updates: {
      stocktake_quantity: 80,
      adjust_reason: '实测剩余长度'
    }
  });

  assert.equal(result.success, true);
  assert.equal(updatedPayload['dynamic_attrs.current_length_m'], 80);
  assert.equal(updatedPayload['quantity.val'], 96);
  assert.equal(Object.prototype.hasOwnProperty.call(updatedPayload, 'dynamic_attrs.initial_length_m'), false);
  assert.equal(loggedPayload.type, 'adjust');
  assert.equal(loggedPayload.action, '盘点调整');
  assert.equal(loggedPayload.quantity_change, -20);
  assert.match(loggedPayload.description, /100 m/);
  assert.match(loggedPayload.description, /80 m/);
  assert.match(loggedPayload.description, /实测剩余长度/);
});

test('inventory detail page exposes admin-only stocktake adjustment controls', () => {
  const detailJs = require('node:fs').readFileSync(path.join(__dirname, '..', 'miniprogram/pages/inventory-detail/index.js'), 'utf8');
  const detailWxml = require('node:fs').readFileSync(path.join(__dirname, '..', 'miniprogram/pages/inventory-detail/index.wxml'), 'utf8');

  assert.match(detailJs, /canAdjustStocktake/);
  assert.match(detailJs, /onShowStocktakeAdjustPopup/);
  assert.match(detailJs, /onStocktakeAdjustConfirm/);
  assert.match(detailWxml, /盘点调整/);
  assert.match(detailWxml, /wx:if="\{\{ canAdjustStocktake \}\}"/);
  assert.match(detailWxml, /stocktakeQuantityValue/);
});

test('addMaterialRequest no longer writes suggested_sub_category', async () => {
  let insertedRequest = null;

  const db = {
    serverDate() {
      return { $date: true };
    },
    async runTransaction(handler) {
      const transaction = {
        collection: (name) => db.collection(name)
      };
      return handler(transaction);
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

      if (name === 'users') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return {
                  data: [{ _openid: 'openid-2', role: 'user', status: 'active', name: '申请人A' }]
                };
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
    },
    './material-units': {
      normalizeUnitInput(category, unit) {
        if (category === 'chemical' && unit === 'kg') {
          return { ok: true, unit: 'kg' };
        }
        return { ok: false, msg: '默认单位不合法' };
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
    default_unit: 'kg',
    suggested_sub_category: '旧建议'
  });

  assert.equal(result.success, true);
  assert.ok(insertedRequest);
  assert.equal(insertedRequest.default_unit, 'kg');
  assert.equal(Object.prototype.hasOwnProperty.call(insertedRequest, 'suggested_sub_category'), false);
});

test('addMaterialRequest requires active users for submit and listMine actions', async () => {
  const userCases = [
    ['pending', { _openid: 'openid-2', role: 'user', status: 'pending' }],
    ['rejected', { _openid: 'openid-2', role: 'user', status: 'rejected' }],
    ['disabled', { _openid: 'openid-2', role: 'user', status: 'disabled' }],
    ['missing', null]
  ];

  for (const [caseName, user] of userCases) {
    let insertedRequest = null;
    let materialRequestsQueried = false;

    const db = {
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
                  return { data: user ? [user] : [] };
                }
              };
            }
          };
        }

        if (name === 'material_requests') {
          materialRequestsQueried = true;
          return {
            where() {
              return {
                orderBy() {
                  return this;
                },
                async get() {
                  return { data: [] };
                },
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
      },
      './material-units': {
        normalizeUnitInput() {
          return { ok: true, unit: 'kg' };
        }
      },
      './auth': {
        assertActiveUserAccess(operator, message) {
          if (!operator || operator.status !== 'active') {
            return { ok: false, msg: message };
          }
          return { ok: true };
        }
      }
    });

    const submitResult = await mod.main({
      action: 'submit',
      product_code: 'J-001',
      category: 'chemical',
      material_name: `异丙醇-${caseName}`,
      subcategory_key: 'builtin:chemical:solvent',
      sub_category: '溶剂',
      default_unit: 'kg'
    });
    assert.equal(submitResult.success, false);
    assert.equal(submitResult.msg, '仅已激活用户可提交物料申请');
    assert.equal(insertedRequest, null);

    materialRequestsQueried = false;
    const listResult = await mod.main({ action: 'listMine' });
    assert.equal(listResult.success, false);
    assert.equal(listResult.msg, '仅已激活用户可查看物料申请');
    assert.equal(materialRequestsQueried, false);
  }
});

test('addMaterialRequest allows active users to list their own requests', async () => {
  let queriedWhere = null;

  const db = {
    command: {
      or(parts) {
        return { __or: parts };
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
                  data: [{ _openid: 'openid-2', role: 'user', status: 'active', name: '申请人A' }]
                };
              }
            };
          }
        };
      }

      if (name === 'material_requests') {
        return {
          where(query) {
            queriedWhere = query;
            return {
              orderBy() {
                return this;
              },
              async get() {
                return {
                  data: [{ _id: 'req-1', product_code: 'J-001', applicant: 'openid-2' }]
                };
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
    },
    './material-units': {
      normalizeUnitInput() {
        return { ok: true, unit: 'kg' };
      }
    },
    './auth': {
      assertActiveUserAccess(operator, message) {
        if (!operator || operator.status !== 'active') {
          return { ok: false, msg: message };
        }
        return { ok: true };
      }
    }
  });

  const result = await mod.main({ action: 'listMine' });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 1);
  assert.ok(queriedWhere);
});

test('material add page routes request submission through the addMaterialRequest cloud function', () => {
  const fs = require('node:fs');
  const file = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );

  assert.match(file, /name:\s*'addMaterialRequest'/);
  assert.match(file, /action:\s*'submit'/);
  assert.match(file, /default_unit:\s*normalizedRequestUnit\.unit/);
  assert.doesNotMatch(file, /db\.collection\('material_requests'\)\.add/);
});

test('material add request popup exposes governed default unit selection and existing material stock-in no longer offers unit switching', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /title="默认单位"/);
  assert.match(wxml, /requestForm\.default_unit \|\| '请选择'/);
  assert.match(wxml, /bind:click="showRequestUnitSheet"/);
  assert.doesNotMatch(wxml, /slot="button" class="flex-row items-center" bindtap="showUnitSheet"/);
  assert.doesNotMatch(wxml, /切换单位/);
});

test('approval center material request cards surface the requested default unit', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/approval-center/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /默认单位：/);
  assert.match(wxml, /item\.default_unit \|\| '未填写'/);
});

test('approveMaterialRequest writes request default unit into the formal material record', async () => {
  let insertedMaterial = null;
  let updatedRequest = null;

  const db = {
    serverDate() {
      return { $date: true };
    },
    async runTransaction(handler) {
      const transaction = {
        collection: (name) => db.collection(name)
      };
      return handler(transaction);
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{ role: 'admin', status: 'active', name: '审批管理员' }]
                };
              }
            };
          }
        };
      }

      if (name === 'material_requests') {
        return {
          doc() {
            return {
              async get() {
                return {
                  data: {
                    _id: 'req-1',
                    status: 'pending',
                    product_code: 'J-001',
                    category: 'chemical',
                    material_name: '异丙醇',
                    subcategory_key: 'builtin:chemical:solvent',
                    sub_category: '溶剂',
                    supplier: '供应商A',
                    default_unit: 'kg',
                    applicant: 'openid-user'
                  }
                };
              },
              async update({ data }) {
                updatedRequest = data;
                return {};
              }
            };
          }
        };
      }

      if (name === 'materials') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [] };
              }
            };
          },
          async add({ data }) {
            insertedMaterial = data;
            return { _id: 'mat-1' };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
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

  const mod = loadModuleWithMocks('../cloudfunctions/approveMaterialRequest/index.js', {
    'wx-server-sdk': cloudStub,
    './auth': {
      assertAdminMutationAccess() {
        return { ok: true };
      }
    },
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
    },
    './material-units': {
      normalizeUnitInput(category, unit) {
        if (category === 'chemical' && unit === 'kg') {
          return { ok: true, unit: 'kg' };
        }
        return { ok: false, msg: '默认单位不合法' };
      }
    }
  });

  const result = await mod.main({
    request_id: 'req-1',
    action: 'approve'
  });

  assert.equal(result.success, true);
  assert.ok(insertedMaterial);
  assert.equal(insertedMaterial.default_unit, 'kg');
  assert.equal(insertedMaterial.status, 'active');
  assert.equal(updatedRequest.status, 'approved');
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
