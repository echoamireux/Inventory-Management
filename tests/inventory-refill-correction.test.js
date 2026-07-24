const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

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

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
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

function createEmptyTestMaterialIdentityCollection() {
  return {
    where() {
      return {
        async get() {
          return { data: [] };
        }
      };
    }
  };
}

test('single stock-in rejects duplicate chemical labels unless refill is explicit', async () => {
  const inventoryRecord = {
    _id: 'inv-1',
    unique_code: 'L000501',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240501',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };

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
                return {
                  async get() {
                    return {
                      data: [{ role: 'user', status: 'active', name: '服务端库管' }]
                    };
                  }
                };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where() {
            return {
              async count() {
                return { total: 1 };
              },
              async get() {
                return { data: [inventoryRecord] };
              }
            };
          }
        };
      }

      if (name === 'materials') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{
                    _id: 'mat-1',
                    product_code: 'J-001',
                    category: 'chemical',
                    material_name: '丙酮',
                    default_unit: 'kg',
                    status: 'active'
                  }]
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    },
    runTransaction(fn) {
      return fn({
        collection(name) {
          if (name === 'inventory') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [inventoryRecord] };
                  }
                };
              },
              doc() {
                throw new Error('implicit duplicate label must not update inventory');
              }
            };
          }

          if (name === 'preprinted_labels') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [] };
                  }
                };
              }
            };
          }

          if (name === 'materials') {
            return {
              where() {
                return {
                  async get() {
                    return {
                      data: [{
                        _id: 'mat-1',
                        product_code: 'J-001',
                        category: 'chemical',
                        material_name: '丙酮',
                        default_unit: 'kg',
                        status: 'active'
                      }]
                    };
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/addMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-1' };
      },
      database() {
        return db;
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail: 'F1',
          location_text: '防爆柜01 | F1',
          location: '防爆柜01 | F1'
        };
      }
    }
  });

  const result = await mod.main({
    base: {
      name: '丙酮',
      category: 'chemical',
      product_code: 'J-001'
    },
    specs: {},
    inventory: {
      batch_number: 'AC240501',
      quantity_val: 2,
      quantity_unit: 'kg',
      expiry_date: '2026-12-31',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_detail: 'A-01'
    },
    unique_code: 'L000501',
    operation_id: 'op_single_reject_001',
    operator_name: '库管员'
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /补料/);
});

test('single stock-in refills an in-stock chemical label only after explicit refill confirmation', async () => {
  let updatedInventory = null;
  let addedLog = null;

  const inventoryRecord = {
    _id: 'inv-1',
    unique_code: 'L000501',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240501',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };

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
                return {
                  async get() {
                    return {
                      data: [{ role: 'user', status: 'active', name: '服务端库管' }]
                    };
                  }
                };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where() {
            return {
              async count() {
                return { total: 1 };
              },
              async get() {
                return { data: [inventoryRecord] };
              }
            };
          }
        };
      }

      if (name === 'materials') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{
                    _id: 'mat-1',
                    product_code: 'J-001',
                    category: 'chemical',
                    material_name: '丙酮',
                    default_unit: 'kg',
                    status: 'active'
                  }]
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    },
    runTransaction(fn) {
      return fn({
        collection(name) {
          if (name === 'inventory') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [inventoryRecord] };
                  }
                };
              },
              doc(id) {
                assert.equal(id, 'inv-1');
                return {
                  async update({ data }) {
                    updatedInventory = data;
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'inventory_log') {
            return {
              async add({ data }) {
                addedLog = data;
                return { _id: 'log-1' };
              }
            };
          }

          if (name === 'preprinted_labels') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [] };
                  }
                };
              }
            };
          }

          if (name === 'materials') {
            return {
              where() {
                return {
                  async get() {
                    return {
                      data: [{
                        _id: 'mat-1',
                        product_code: 'J-001',
                        category: 'chemical',
                        material_name: '丙酮',
                        default_unit: 'kg',
                        status: 'active'
                      }]
                    };
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/addMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-1' };
      },
      database() {
        return db;
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail: 'F1',
          location_text: '防爆柜01 | F1',
          location: '防爆柜01 | F1'
        };
      }
    }
  });

  const result = await mod.main({
    base: {
      name: '丙酮',
      category: 'chemical',
      product_code: 'J-001'
    },
    specs: {},
    inventory: {
      batch_number: 'AC240501',
      quantity_val: 2,
      quantity_unit: 'kg',
      expiry_date: '2026-12-31',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_detail: 'A-01'
    },
    unique_code: 'L000501',
    operation_id: 'op_single_refill_001',
    submit_action: 'refill',
    refill_inventory_id: 'inv-1',
    operator_name: '库管员'
  });

  assert.equal(result.success, true);
  assert.equal(result.inventoryId, 'inv-1');
  assert.equal(updatedInventory['quantity.val'], 7);
  assert.equal(updatedInventory['dynamic_attrs.weight_kg'], 7);
  assert.equal(addedLog.type, 'refill');
  assert.equal(addedLog.description, '补料入库');
  assert.equal(addedLog.quantity_change, 2);
  assert.equal(addedLog.operator, '服务端库管');
});

test('single stock-in rejects voided preprint labels even when manually submitted', async () => {
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
                return {
                  async get() {
                    return { data: [{ role: 'user', status: 'active', name: '服务端库管' }] };
                  }
                };
              }
            };
          }
        };
      }

      if (name === 'materials') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{
                    _id: 'mat-1',
                    product_code: 'J-001',
                    category: 'chemical',
                    material_name: '丙酮',
                    default_unit: 'kg',
                    status: 'active'
                  }]
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    },
    runTransaction(fn) {
      return fn({
        collection(name) {
          if (name === 'inventory') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [] };
                  }
                };
              }
            };
          }

          if (name === 'preprinted_labels') {
            return {
              where() {
                return {
                  async get() {
                    return {
                      data: [{
                        _id: 'preprint-voided',
                        unique_code: 'L000777',
                        status: 'voided',
                        material_id: 'mat-1',
                        product_code: 'J-001',
                        category: 'chemical'
                      }]
                    };
                  }
                };
              }
            };
          }

          if (name === 'materials') {
            return {
              where() {
                return {
                  async get() {
                    return {
                      data: [{
                        _id: 'mat-1',
                        product_code: 'J-001',
                        category: 'chemical',
                        material_name: '丙酮',
                        default_unit: 'kg',
                        status: 'active'
                      }]
                    };
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/addMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-1' };
      },
      database() {
        return db;
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail: 'F1',
          location_text: '防爆柜01 | F1',
          location_zone_name: '防爆柜01'
        };
      }
    }
  });

  const result = await mod.main({
    unique_code: 'L000777',
    operation_id: 'op_single_voided_001',
    base: {
      name: '丙酮',
      category: 'chemical',
      product_code: 'J-001',
      supplier_model: 'AC-1'
    },
    specs: {},
    inventory: {
      quantity_val: 1,
      quantity_unit: 'kg',
      batch_number: 'B001',
      is_long_term_valid: true,
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_detail: 'A-01'
    }
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /已作废/);
});

test('batch stock-in keeps eligible duplicate chemical labels as refill operations inside one transaction', async () => {
  const inventoryAdds = [];
  const inventoryUpdates = [];
  const inventoryLogs = [];

  const material = {
    _id: 'mat-1',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    default_unit: 'kg',
    status: 'active'
  };

  const existingInventory = {
    _id: 'inv-refill',
    unique_code: 'L000601',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240601',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };
  const cloudStub = {
    init() {},
    getWXContext() {
      return { OPENID: 'openid-batch' };
    },
    database() {
      return {
        command: {
          in(list) {
            return { $in: list };
          }
        },
        serverDate() {
          return { $date: true };
        },
        collection(name) {
          if (name === 'users') {
            return {
              where() {
                return {
                  limit() {
                    return {
                      async get() {
                        return {
                          data: [{ role: 'user', status: 'active', name: '服务端批量库管' }]
                        };
                      }
                    };
                  }
                };
              }
            };
          }

          if (name === 'materials') {
            return {
              where() {
                return {
                  async get() {
                    return { data: [material] };
                  }
                };
              }
            };
          }
          throw new Error(`unexpected collection outside transaction: ${name}`);
        },
        runTransaction(fn) {
          return fn({
            collection(name) {
              if (name === 'inventory') {
                return {
                  where(query) {
                    return {
                      async get() {
                        if (query.unique_code === 'L000601') {
                          return { data: [existingInventory] };
                        }
                        return { data: [] };
                      }
                    };
                  },
                  doc(id) {
                    return {
                      async update({ data }) {
                        inventoryUpdates.push({ id, data });
                        return {};
                      }
                    };
                  },
                  async add({ data }) {
                    inventoryAdds.push(data);
                    return { _id: `inv-new-${inventoryAdds.length}` };
                  }
                };
              }

              if (name === 'inventory_log') {
                return {
                  async add({ data }) {
                    inventoryLogs.push(data);
                    return { _id: `log-${inventoryLogs.length}` };
                  }
                };
              }

              if (name === 'materials') {
                return {
                  doc() {
                    return {
                      async update() {
                        return {};
                      }
                    };
                  }
                };
              }

              if (name === 'preprinted_labels') {
                return {
                  where() {
                    return {
                      async get() {
                        return { data: [] };
                      }
                    };
                  }
                };
              }

              if (name === 'operation_receipts') {
                return createOperationReceiptCollection();
              }

              if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
            }
          });
        }
      };
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/batchAddInventory/index.js', {
    'wx-server-sdk': cloudStub,
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail: 'F1',
          location_text: '防爆柜01 | F1',
          location: '防爆柜01 | F1'
        };
      }
    },
    './batch-add': {
      assertBatchInventoryItemLimit() {},
      assertUniqueCodes() {},
      buildBatchInventoryPayload(_item, _material, index) {
        if (index === 0) {
          return {
            rawItem: _item,
            inventoryData: {
              material_id: 'mat-1',
              material_name: '丙酮',
              category: 'chemical',
              product_code: 'J-001',
              unique_code: 'L000601',
              batch_number: 'AC240601',
              status: 'in_stock',
              quantity: { val: 2, unit: 'kg' },
              dynamic_attrs: { weight_kg: 2 }
            },
            logData: {
              type: 'inbound',
              material_id: 'mat-1',
              material_name: '丙酮',
              category: 'chemical',
              product_code: 'J-001',
              unique_code: 'L000601',
              quantity_change: 2,
              spec_change_unit: 'kg',
              unit: 'kg',
              description: '批量入库'
            }
          };
        }

        return {
          rawItem: _item,
          inventoryData: {
            material_id: 'mat-1',
            material_name: '丙酮',
            category: 'chemical',
            product_code: 'J-001',
            unique_code: 'L000602',
            batch_number: 'AC240601',
            status: 'in_stock',
            quantity: { val: 1, unit: 'kg' },
            dynamic_attrs: { weight_kg: 1 }
          },
          logData: {
            type: 'inbound',
            material_id: 'mat-1',
            material_name: '丙酮',
            category: 'chemical',
            product_code: 'J-001',
            unique_code: 'L000602',
            quantity_change: 1,
            spec_change_unit: 'kg',
            unit: 'kg',
            description: '批量入库'
          }
        };
      }
    }
  });

  const result = await mod.main({
    operation_id: 'op_batch_refill_001',
    operator_name: '批量库管',
    items: [
      {
        material_id: 'mat-1',
        unique_code: 'L000601',
        submit_action: 'refill',
        refill_inventory_id: 'inv-refill'
      },
      { material_id: 'mat-1', unique_code: 'L000602' }
    ]
  });

  assert.equal(result.success, true);
  assert.equal(inventoryUpdates.length, 1);
  assert.equal(inventoryUpdates[0].id, 'inv-refill');
  assert.equal(inventoryUpdates[0].data['quantity.val'], 7);
  assert.equal(inventoryLogs[0].type, 'refill');
  assert.equal(inventoryLogs[0].description, '补料入库');
  assert.equal(inventoryLogs[0].operator, '服务端批量库管');
  assert.equal(inventoryAdds.length, 1);
  assert.equal(inventoryLogs[1].type, 'inbound');
  assert.equal(inventoryLogs[1].operator, '服务端批量库管');
});

test('single stock-in rejects non-active users before attempting any inventory writes', async () => {
  const mod = loadModuleWithMocks('../cloudfunctions/addMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-pending' };
      },
      database() {
        return {
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
                      return {
                        async get() {
                          return {
                            data: [{ role: 'user', status: 'pending', name: '待审批用户' }]
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
            throw new Error(`should not access collection: ${name}`);
          }
        };
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {};
      }
    }
  });

  const result = await mod.main({
    base: {
      name: '丙酮',
      category: 'chemical',
      product_code: 'J-001'
    },
    specs: {},
    inventory: {
      batch_number: 'AC240510',
      quantity_val: 2,
      expiry_date: '2026-12-31',
      zone_key: 'builtin:chemical:safe-cabinet-01'
    },
    unique_code: 'L000510'
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /仅已激活用户可执行入库/);
});

test('single stock-in rejects expiry dates earlier than today on the backend', async () => {
  const mod = loadModuleWithMocks('../cloudfunctions/addMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-date-check' };
      },
      database() {
        return {
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
                      return {
                        async get() {
                          return {
                            data: [{ role: 'user', status: 'active', name: '日期校验员' }]
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
            throw new Error(`should not access collection: ${name}`);
          }
        };
      }
    },
    './warehouse-zones': {
      ensureBuiltinZones: async () => [],
      ensureBuiltinLocationDetails: async () => [],
      sortZoneRecords(records) {
        return records;
      },
      filterZoneRecordsByCategory(records) {
        return records;
      },
      buildZoneMap() {
        return new Map();
      },
      buildLocationDetailMapByZone() {
        return new Map();
      },
      buildInventoryLocationPayload() {
        return {};
      }
    }
  });

  const result = await mod.main({
    base: {
      name: '丙酮',
      category: 'chemical',
      product_code: 'J-001'
    },
    specs: {},
    inventory: {
      batch_number: 'AC240511',
      quantity_val: 1,
      expiry_date: '2026-03-25',
      zone_key: 'builtin:chemical:safe-cabinet-01'
    },
    unique_code: 'L000511',
    operation_id: 'op_single_expiry_001'
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /过期日期不能早于当天/);
});

test('batch stock-in rejects non-active users before loading material data', async () => {
  const mod = loadModuleWithMocks('../cloudfunctions/batchAddInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-batch-pending' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return {
                            data: [{ role: 'user', status: 'disabled', name: '停用用户' }]
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
            throw new Error(`should not access collection: ${name}`);
          }
        };
      }
    }
  });

  const result = await mod.main({
    items: [{ material_id: 'mat-1', unique_code: 'L000612' }]
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /仅已激活用户可执行批量入库/);
});

test('inventory template preview marks eligible duplicate chemical labels as pending refill instead of an error', async () => {
  const material = {
    _id: 'mat-tpl-1',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    sub_category: '溶剂',
    default_unit: 'kg',
    status: 'active'
  };
  const existingInventory = {
    _id: 'inv-template-refill',
    unique_code: 'L000801',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240801',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };
  const productCodePrefixes = [];

  const mod = loadModuleWithMocks('../cloudfunctions/importInventoryTemplate/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-template' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: [{ role: 'user', status: 'active', name: '模板操作员' }] };
                        }
                      };
                    }
                  };
                }
              };
            }

            if (name === 'materials') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [material] };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where(query) {
                  return {
                    skip() {
                      return this;
                    },
                    limit() {
                      return this;
                    },
                    field() {
                      return this;
                    },
                    async get() {
                      if (query && query.unique_code && query.unique_code.$in) {
                        return { data: [existingInventory] };
                      }
                      if (query && query.product_code && query.product_code.$in) {
                        return { data: [existingInventory] };
                      }
                      return { data: [] };
                    }
                  };
                }
              };
            }

            if (name === 'warehouse_zones') {
              return {
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

            if (name === 'preprinted_labels') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [] };
                    }
                  };
                }
              };
            }

            if (name === 'product_code_prefixes') {
              return {
                skip() {
                  return this;
                },
                limit() {
                  return this;
                },
                async get() {
                  return { data: productCodePrefixes };
                },
                async add({ data }) {
                  productCodePrefixes.push({
                    _id: `prefix-${productCodePrefixes.length}`,
                    ...data
                  });
                  return { _id: `prefix-${productCodePrefixes.length}` };
                },
                doc(id) {
                  return {
                    async set({ data }) {
                      const index = productCodePrefixes.findIndex(item => item._id === id);
                      if (index === -1) productCodePrefixes.push({ _id: id, ...data });
                      else productCodePrefixes[index] = { _id: id, ...data };
                    },
                    async update() {}
                  };
                }
              };
            }

            if (name === 'test_material_identities') {
              return createEmptyTestMaterialIdentityCollection();
            }

            throw new Error(`unexpected collection: ${name}`);
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    action: 'preview',
    data: {
      templateMeta: {
        templateKind: 'inventory_import',
        schemaVersion: 'inventory-import-v2'
      },
      rows: [
        { rowIndex: 1, values: ['基础信息', '', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '', '时效信息', ''] },
        { rowIndex: 2, values: ['标签编号*', '代码前缀*', '产品编号*', '类别*', '生产批号*', '存储区域*', '详细坐标*', '净含量', '包装形式', '膜材厚度(μm)', '本批次实际幅宽(mm)', '长度(m)', '供应商', '原厂型号', '样品说明/备注', '过期日期', '长期有效'] },
        { rowIndex: 3, values: ['必填', '必填', '必填', '必填', '必填', '必填', '必填', '化材必填', '化材选填', '膜材条件必填', '膜材必填', '膜材必填', '选填', '测试料必填', '选填', '二选一', '二选一'] },
        { rowIndex: 4, values: ['L000801', 'J', '001', '化材', 'AC240801', '防爆柜01', 'F1', '2', '', '', '', '', '', '', '', '2026-12-31', ''] }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].hasError, false);
  assert.equal(result.list[0].submit_action, 'refill');
  assert.equal(result.list[0].refill_inventory_id, 'inv-template-refill');
  assert.match(result.list[0].warning, /补料入库/);
});

test('inventory template submit supports mixed create and refill rows in one request', async () => {
  const inventoryAdds = [];
  const inventoryUpdates = [];
  const inventoryLogs = [];

  const material = {
    _id: 'mat-tpl-2',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    sub_category: '溶剂',
    default_unit: 'kg',
    status: 'active'
  };
  const existingInventory = {
    _id: 'inv-template-refill-2',
    unique_code: 'L000901',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240901',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };
  const currentInventory = {
    ...existingInventory,
    quantity: { val: 3, unit: 'kg' },
    dynamic_attrs: { weight_kg: 3 }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/importInventoryTemplate/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-template-submit' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: [{ role: 'user', status: 'active', name: '模板提交员' }] };
                        }
                      };
                    }
                  };
                }
              };
            }

            if (name === 'materials') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [material] };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where(query) {
                  return {
                    skip() {
                      return this;
                    },
                    limit() {
                      return this;
                    },
                    field() {
                      return this;
                    },
                    async get() {
                      if (query && query.unique_code && query.unique_code.$in) {
                        return { data: [existingInventory] };
                      }
                      return { data: [] };
                    }
                  };
                }
              };
            }

            if (name === 'warehouse_zones') {
              return {
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

            if (name === 'test_material_identities') {
              return createEmptyTestMaterialIdentityCollection();
            }

            throw new Error(`unexpected collection outside transaction: ${name}`);
          },
          runTransaction(fn) {
            return fn({
              collection(name) {
	                if (name === 'inventory') {
	                  return {
	                    where(query) {
	                      return {
	                        limit() {
	                          return this;
	                        },
	                        async get() {
	                          assert.equal(query.unique_code, 'L000902');
	                          return { data: [] };
	                        }
	                      };
	                    },
	                    doc(id) {
	                      return {
	                        async get() {
                          assert.equal(id, 'inv-template-refill-2');
                          return { data: currentInventory };
                        },
                        async update({ data }) {
                          inventoryUpdates.push({ id, data });
                          return {};
                        }
                      };
                    },
                    async add({ data }) {
                      inventoryAdds.push(data);
                      return { _id: `inv-created-${inventoryAdds.length}` };
                    }
                  };
                }

                if (name === 'inventory_log') {
                  return {
                    async add({ data }) {
                      inventoryLogs.push(data);
                      return { _id: `log-${inventoryLogs.length}` };
                    }
                  };
                }

                if (name === 'preprinted_labels') {
                  return {
                    where() {
                      return {
                        async get() {
                          return { data: [] };
                        }
                      };
                    }
                  };
                }

                if (name === 'materials') {
                  return {
                    doc(id) {
                      return {
                        async get() {
                          assert.equal(id, 'mat-tpl-2');
                          return { data: material };
                        },
                        async update() {
                          return {};
                        }
                      };
                    }
                  };
                }

                if (name === 'operation_receipts') {
                  return createOperationReceiptCollection();
                }

                if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
              }
            });
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    action: 'submit',
    operation_id: 'op_template_mixed_001',
    data: {
      items: [
        {
          rowIndex: 4,
          unique_code: 'L000901',
          product_code: 'J-001',
          material_id: 'mat-tpl-2',
          material_name: '丙酮',
          sub_category: '溶剂',
          category: 'chemical',
          batch_number: 'AC240901',
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail_key: 'builtin:chemical:safe-cabinet-01:F1',
          location_detail: 'F1',
          location: '防爆柜01 | F1',
          expiry_date: '2026-12-31',
          is_long_term_valid: false,
          net_content: 2,
          quantity_unit: 'kg',
          quantity_summary: '2 kg',
          submit_action: 'refill',
          refill_inventory_id: 'inv-template-refill-2'
        },
        {
          rowIndex: 5,
          unique_code: 'L000902',
          product_code: 'J-001',
          material_id: 'mat-tpl-2',
          material_name: '丙酮',
          sub_category: '溶剂',
          category: 'chemical',
          batch_number: 'AC240901',
          zone_key: 'builtin:chemical:safe-cabinet-01',
          location_detail_key: 'builtin:chemical:safe-cabinet-01:F2',
          location_detail: 'F2',
          location: '防爆柜01 | F2',
          expiry_date: '2026-12-31',
          is_long_term_valid: false,
          net_content: 1,
          quantity_unit: 'kg',
          quantity_summary: '1 kg',
          submit_action: 'create'
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(inventoryUpdates.length, 1);
  assert.equal(inventoryUpdates[0].id, 'inv-template-refill-2');
  assert.equal(inventoryUpdates[0].data['quantity.val'], 5);
  assert.equal(inventoryAdds.length, 1);
  assert.equal(inventoryLogs.length, 2);
  assert.equal(inventoryLogs[0].type, 'refill');
  assert.equal(inventoryLogs[1].type, 'inbound');
});

test('inventory template submit consumes matching unused preprint labels when creating inventory', async () => {
  const inventoryAdds = [];
  const inventoryLogs = [];
  const preprintUpdates = [];

  const material = {
    _id: 'mat-tpl-preprint',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    sub_category: '溶剂',
    default_unit: 'kg',
    status: 'active'
  };
  const preprintLabel = {
    _id: 'preprint-template-1',
    unique_code: 'L000904',
    status: 'unused',
    material_id: 'mat-tpl-preprint',
    product_code: 'J-001',
    category: 'chemical'
  };

  const mod = loadModuleWithMocks('../cloudfunctions/importInventoryTemplate/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-template-preprint' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: [{ role: 'user', status: 'active', name: '模板提交员' }] };
                        }
                      };
                    }
                  };
                }
              };
            }

            if (name === 'materials') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [material] };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where() {
                  return {
                    skip() {
                      return this;
                    },
                    limit() {
                      return this;
                    },
                    field() {
                      return this;
                    },
                    async get() {
                      return { data: [] };
                    }
                  };
                }
              };
            }

            if (name === 'warehouse_zones') {
              return {
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

            if (name === 'test_material_identities') {
              return createEmptyTestMaterialIdentityCollection();
            }

            throw new Error(`unexpected collection outside transaction: ${name}`);
          },
          runTransaction(fn) {
            return fn({
              collection(name) {
	                if (name === 'inventory') {
	                  return {
	                    where(query) {
	                      return {
	                        limit() {
	                          return this;
	                        },
	                        async get() {
	                          assert.equal(query.unique_code, 'L000904');
	                          return { data: [] };
	                        }
	                      };
	                    },
	                    async add({ data }) {
	                      inventoryAdds.push(data);
	                      return { _id: `inv-created-${inventoryAdds.length}` };
                    }
                  };
                }

                if (name === 'preprinted_labels') {
                  return {
                    where(query) {
                      return {
                        async get() {
                          assert.equal(query.unique_code, 'L000904');
                          return { data: [preprintLabel] };
                        }
                      };
                    },
                    doc(id) {
                      return {
                        async update({ data }) {
                          preprintUpdates.push({ id, data });
                          return {};
                        }
                      };
                    }
                  };
                }

                if (name === 'inventory_log') {
                  return {
                    async add({ data }) {
                      inventoryLogs.push(data);
                      return { _id: `log-${inventoryLogs.length}` };
                    }
                  };
                }

                if (name === 'materials') {
                  return {
                    doc(id) {
                      return {
                        async get() {
                          assert.equal(id, material._id);
                          return { data: material };
                        },
                        async update() {
                          return {};
                        }
                      };
                    }
                  };
                }

                if (name === 'operation_receipts') {
                  return createOperationReceiptCollection();
                }

                if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
              }
            });
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    action: 'submit',
    operation_id: 'op_template_preprint_001',
    data: {
      items: [{
        rowIndex: 5,
        unique_code: 'L000904',
        product_code: 'J-001',
        material_id: 'mat-tpl-preprint',
        material_name: '丙酮',
        sub_category: '溶剂',
        category: 'chemical',
        batch_number: 'AC240904',
        zone_key: 'builtin:chemical:safe-cabinet-01',
        location_detail_key: 'builtin:chemical:safe-cabinet-01:F2',
        location_detail: 'F2',
        location: '防爆柜01 | F2',
        expiry_date: '2026-12-31',
        is_long_term_valid: false,
        net_content: 1,
        quantity_unit: 'kg',
        quantity_summary: '1 kg',
        submit_action: 'create'
      }]
    }
  });

  assert.equal(result.success, true);
  assert.equal(inventoryAdds.length, 1);
  assert.equal(preprintUpdates.length, 1);
  assert.equal(preprintUpdates[0].id, 'preprint-template-1');
  assert.equal(preprintUpdates[0].data.status, 'used');
  assert.equal(preprintUpdates[0].data.inventory_id, 'inv-created-1');
  assert.equal(inventoryLogs.length, 1);
  assert.equal(inventoryLogs[0].unique_code, 'L000904');
});

test('inventory template submit rejects voided preprint labels even when the row is otherwise valid', async () => {
  const material = {
    _id: 'mat-tpl-voided-preprint',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    sub_category: '溶剂',
    default_unit: 'kg',
    status: 'active'
  };
  const preprintLabel = {
    _id: 'preprint-template-voided',
    unique_code: 'L000905',
    status: 'voided',
    material_id: 'mat-tpl-voided-preprint',
    product_code: 'J-001',
    category: 'chemical'
  };

  const mod = loadModuleWithMocks('../cloudfunctions/importInventoryTemplate/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-template-voided-preprint' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: [{ role: 'user', status: 'active', name: '模板提交员' }] };
                        }
                      };
                    }
                  };
                }
              };
            }

            if (name === 'materials') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [material] };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where() {
                  return {
                    skip() {
                      return this;
                    },
                    limit() {
                      return this;
                    },
                    field() {
                      return this;
                    },
                    async get() {
                      return { data: [] };
                    }
                  };
                }
              };
            }

            if (name === 'warehouse_zones') {
              return {
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

            if (name === 'test_material_identities') {
              return createEmptyTestMaterialIdentityCollection();
            }

            throw new Error(`unexpected collection outside transaction: ${name}`);
          },
          runTransaction(fn) {
            return fn({
              collection(name) {
	                if (name === 'inventory') {
	                  return {
	                    where(query) {
	                      return {
	                        limit() {
	                          return this;
	                        },
	                        async get() {
	                          assert.equal(query.unique_code, 'L000905');
	                          return { data: [] };
	                        }
	                      };
	                    },
	                    async add() {
	                      throw new Error('voided preprint should fail before inventory is created');
                    }
                  };
                }

                if (name === 'preprinted_labels') {
                  return {
                    where(query) {
                      return {
                        async get() {
                          assert.equal(query.unique_code, 'L000905');
                          return { data: [preprintLabel] };
                        }
                      };
                    }
                  };
                }

                if (name === 'materials') {
                  return {
                    doc(id) {
                      return {
                        async get() {
                          assert.equal(id, material._id);
                          return { data: material };
                        },
                        async update() {
                          return {};
                        }
                      };
                    }
                  };
                }

                if (name === 'inventory_log') {
                  return {
                    async add() {
                      throw new Error('voided preprint should fail before log is written');
                    }
                  };
                }

                if (name === 'operation_receipts') {
                  return createOperationReceiptCollection();
                }

                if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
              }
            });
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    action: 'submit',
    operation_id: 'op_template_voided_001',
    data: {
      items: [{
        rowIndex: 5,
        unique_code: 'L000905',
        product_code: 'J-001',
        material_id: 'mat-tpl-voided-preprint',
        material_name: '丙酮',
        sub_category: '溶剂',
        category: 'chemical',
        batch_number: 'AC240905',
        zone_key: 'builtin:chemical:safe-cabinet-01',
        location_detail_key: 'builtin:chemical:safe-cabinet-01:F2',
        location_detail: 'F2',
        location: '防爆柜01 | F2',
        expiry_date: '2026-12-31',
        is_long_term_valid: false,
        net_content: 1,
        quantity_unit: 'kg',
        quantity_summary: '1 kg',
        submit_action: 'create'
      }]
    }
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /已作废/);
});

test('inventory template submit rejects invalid refill quantities even if the frontend payload is tampered', async () => {
  const material = {
    _id: 'mat-tpl-3',
    product_code: 'J-001',
    category: 'chemical',
    material_name: '丙酮',
    sub_category: '溶剂',
    default_unit: 'kg',
    status: 'active'
  };
  const existingInventory = {
    _id: 'inv-template-refill-3',
    unique_code: 'L000903',
    status: 'in_stock',
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'AC240903',
    quantity: { val: 5, unit: 'kg' },
    dynamic_attrs: { weight_kg: 5 }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/importInventoryTemplate/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-template-invalid-refill' };
      },
      database() {
        return {
          command: {
            in(list) {
              return { $in: list };
            }
          },
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: [{ role: 'user', status: 'active', name: '模板提交员' }] };
                        }
                      };
                    }
                  };
                }
              };
            }

            if (name === 'materials') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [material] };
                    }
                  };
                }
              };
            }

            if (name === 'inventory') {
              return {
                where() {
                  return {
                    async get() {
                      return { data: [existingInventory] };
                    }
                  };
                }
              };
            }

            if (name === 'warehouse_zones') {
              return {
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

            if (name === 'test_material_identities') {
              return createEmptyTestMaterialIdentityCollection();
            }

            throw new Error(`unexpected collection: ${name}`);
          },
          runTransaction(fn) {
            return fn({
              collection(name) {
                if (name === 'operation_receipts') {
                  return createOperationReceiptCollection();
                }
                throw new Error('invalid refill quantity should fail before inventory writes');
              }
            });
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    action: 'submit',
    operation_id: 'op_template_invalid_refill_001',
    data: {
      items: [{
        rowIndex: 4,
        unique_code: 'L000903',
        product_code: 'J-001',
        material_id: 'mat-tpl-3',
        material_name: '丙酮',
        sub_category: '溶剂',
        category: 'chemical',
        batch_number: 'AC240903',
        zone_key: 'builtin:chemical:safe-cabinet-01',
        location_detail_key: 'builtin:chemical:safe-cabinet-01:F1',
        location_detail: 'F1',
        location: '防爆柜01 | F1',
        expiry_date: '2026-12-31',
        is_long_term_valid: false,
        net_content: 0,
        quantity_unit: 'kg',
        quantity_summary: '0 kg',
        submit_action: 'refill',
        refill_inventory_id: 'inv-template-refill-3'
      }]
    }
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /补料数量必须为有效正数/);
});

test('submitInventoryCorrectionRequest only accepts inbound logs and stores a pending correction request', async () => {
  let insertedRequest = null;
  let auditCount = 0;

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
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
          doc(id) {
            assert.equal(id, 'log-in-1');
            return {
              async get() {
                return {
                  data: {
                    _id: 'log-in-1',
                    type: 'inbound',
                    inventory_id: 'inv-1',
                    unique_code: 'L000701',
                    product_code: 'J-001',
                    category: 'chemical',
                    batch_number: 'AC240701',
                    quantity_change: 5,
                    unit: 'kg',
                    timestamp: new Date('2026-03-25T09:00:00.000Z')
                  }
                };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          doc(id) {
            assert.equal(id, 'inv-1');
            return {
              async get() {
                return {
                  data: {
                    _id: 'inv-1',
                    unique_code: 'L000701',
                    product_code: 'J-001',
                    category: 'chemical',
                    batch_number: 'AC240701',
                    quantity: { val: 5, unit: 'kg' },
                    dynamic_attrs: { weight_kg: 5 }
                  }
                };
              }
            };
          }
        };
      }

      if (name === 'inventory_correction_requests') {
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
            insertedRequest = data;
            return { _id: 'corr-1' };
          }
        };
      }

      if (name === 'audit_events') {
        return {
          async add() {
            auditCount += 1;
            return { _id: `audit-${auditCount}` };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/submitInventoryCorrectionRequest/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return db;
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    source_log_id: 'log-in-1',
    requested_quantity: 8,
    reason: '入库称量录入错误'
  });

  assert.equal(result.success, true);
  assert.ok(insertedRequest);
  assert.equal(insertedRequest.status, 'pending');
  assert.equal(insertedRequest.source_log_id, 'log-in-1');
  assert.equal(insertedRequest.inventory_id, 'inv-1');
  assert.equal(insertedRequest.original_quantity, 5);
  assert.equal(insertedRequest.requested_quantity, 8);
  assert.equal(insertedRequest.unit, 'kg');
  assert.equal(insertedRequest.reason, '入库称量录入错误');
  assert.equal(auditCount, 1);
});

test('submitInventoryCorrectionRequest rejects non-positive requested quantities on the server', async () => {
  const mod = loadModuleWithMocks('../cloudfunctions/submitInventoryCorrectionRequest/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user-invalid-quantity' };
      },
      database() {
        return {
          serverDate() {
            return { $date: true };
          },
          collection(name) {
            if (name === 'users') {
              return {
                where() {
                  return {
                    async get() {
                      return {
                        data: [{ role: 'user', status: 'active', name: '操作员B' }]
                      };
                    }
                  };
                }
              };
            }

            throw new Error(`should not access collection: ${name}`);
          }
        };
      }
    },
    './auth': {
      assertActiveUserAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    source_log_id: 'log-in-invalid',
    requested_quantity: 0,
    reason: '测试'
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /申请数量必须为有效的正数/);
});

test('approveInventoryCorrectionRequest applies a chemical quantity delta and writes an adjust audit log', async () => {
  let updatedInventory = null;
  let updatedRequest = null;
  let addedAdjustLog = null;
  let transactionUsed = false;

  const requestRecord = {
    _id: 'corr-approve-1',
    status: 'pending',
    source_log_id: 'log-in-2',
    inventory_id: 'inv-2',
    unique_code: 'L000702',
    product_code: 'J-002',
    category: 'chemical',
    batch_number: 'AC240702',
    original_quantity: 5,
    requested_quantity: 8,
    unit: 'kg',
    reason: '首次称量少录'
  };

  const sourceLog = {
    _id: 'log-in-2',
    type: 'inbound',
    inventory_id: 'inv-2',
    timestamp: new Date('2026-03-25T08:00:00.000Z'),
    quantity_change: 5,
    unit: 'kg'
  };

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{ role: 'admin', status: 'active', name: '审批员' }]
                };
              }
            };
          }
        };
      }
      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    runTransaction(fn) {
      transactionUsed = true;
      return fn({
        collection(name) {
          if (name === 'inventory_correction_requests') {
            return {
              doc(id) {
                assert.equal(id, 'corr-approve-1');
                return {
                  async get() {
                    return { data: requestRecord };
                  },
                  async update({ data }) {
                    updatedRequest = data;
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'inventory_log') {
            return {
              doc(id) {
                assert.equal(id, 'log-in-2');
                return {
                  async get() {
                    return { data: sourceLog };
                  }
                };
              },
              where() {
                return {
                  skip() {
                    return this;
                  },
                  limit() {
                    return this;
                  },
                  async get() {
                    return { data: [sourceLog] };
                  }
                };
              },
              async add({ data }) {
                addedAdjustLog = data;
                return { _id: 'log-adjust-1' };
              }
            };
          }

          if (name === 'inventory') {
            return {
              doc(id) {
                assert.equal(id, 'inv-2');
                return {
                  async get() {
                    return {
                      data: {
                        _id: 'inv-2',
                        unique_code: 'L000702',
                        status: 'in_stock',
                        category: 'chemical',
                        product_code: 'J-002',
                        batch_number: 'AC240702',
                        quantity: { val: 5, unit: 'kg' },
                        dynamic_attrs: { weight_kg: 5 }
                      }
                    };
                  },
                  async update({ data }) {
                    updatedInventory = data;
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/approveInventoryCorrectionRequest/index.js', {
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
      assertAdminMutationAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    request_id: 'corr-approve-1',
    action: 'approve',
    operation_id: 'op_correction_approve_001'
  });

  assert.equal(result.success, true);
  assert.equal(transactionUsed, true);
  assert.equal(updatedInventory['quantity.val'], 8);
  assert.equal(updatedInventory['dynamic_attrs.weight_kg'], 8);
  assert.equal(updatedRequest.status, 'approved');
  assert.equal(addedAdjustLog.type, 'adjust');
  assert.match(addedAdjustLog.description, /原数量 5 kg/);
  assert.match(addedAdjustLog.description, /申请数量 8 kg/);
  assert.match(addedAdjustLog.description, /差额 3 kg/);
});

test('approveInventoryCorrectionRequest reuses the success receipt when retrying an already approved request', async () => {
  let inventoryUpdateCount = 0;
  const receiptStore = new Map();

  const requestRecord = {
    _id: 'corr-approve-retry',
    status: 'pending',
    source_log_id: 'log-in-retry',
    inventory_id: 'inv-retry',
    unique_code: 'L000703',
    product_code: 'J-003',
    category: 'chemical',
    original_quantity: 2,
    requested_quantity: 3,
    unit: 'kg',
    reason: '复核修正'
  };
  const sourceLog = {
    _id: 'log-in-retry',
    type: 'inbound',
    inventory_id: 'inv-retry',
    timestamp: new Date('2026-03-25T08:00:00.000Z')
  };

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return { data: [{ role: 'admin', status: 'active', name: '审批员' }] };
              }
            };
          }
        };
      }
      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    runTransaction(fn) {
      return fn({
        collection(name) {
          if (name === 'inventory_correction_requests') {
            return {
              doc() {
                return {
                  async get() {
                    return { data: requestRecord };
                  },
                  async update({ data }) {
                    Object.assign(requestRecord, data);
                    return {};
                  }
                };
              }
            };
          }
          if (name === 'operation_receipts') {
            return createOperationReceiptCollection(receiptStore);
          }
          if (name === 'inventory_log') {
            return {
              doc() {
                return {
                  async get() {
                    return { data: sourceLog };
                  }
                };
              },
              where() {
                return {
                  orderBy() { return this; },
                  skip() { return this; },
                  limit() { return this; },
                  async get() {
                    return { data: [sourceLog] };
                  }
                };
              },
              async add() {
                return { _id: 'log-adjust-retry' };
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
                        _id: 'inv-retry',
                        unique_code: 'L000703',
                        status: 'in_stock',
                        category: 'chemical',
                        product_code: 'J-003',
                        quantity: { val: 2, unit: 'kg' },
                        dynamic_attrs: { weight_kg: 2 }
                      }
                    };
                  },
                  async update() {
                    inventoryUpdateCount += 1;
                    return {};
                  }
                };
              }
            };
          }
          if (name === 'audit_events') {
            return { async add() { return { _id: 'audit-test-id' }; } };
          }
          throw new Error(`unexpected transaction collection: ${name}`);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/approveInventoryCorrectionRequest/index.js', {
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
      assertAdminMutationAccess() {
        return { ok: true };
      }
    }
  });

  const payload = {
    request_id: 'corr-approve-retry',
    action: 'approve',
    operation_id: 'op_correction_retry_001'
  };
  const first = await mod.main(payload);
  const retry = await mod.main(payload);

  assert.equal(first.success, true);
  assert.deepEqual(retry, first);
  assert.equal(inventoryUpdateCount, 1);
});

test('approveInventoryCorrectionRequest rejects corrections when later quantity-affecting logs only appear on a later page', async () => {
  let inventoryUpdated = false;
  let scannedSkips = [];
  const receiptStore = new Map();

  const sourceLog = {
    _id: 'log-in-3',
    type: 'inbound',
    inventory_id: 'inv-3',
    timestamp: new Date('2026-03-25T08:00:00.000Z'),
    quantity_change: 10,
    unit: 'm'
  };

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  data: [{ role: 'admin', status: 'active', name: '审批员' }]
                };
              }
            };
          }
        };
      }
      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    runTransaction(fn) {
      return fn({
        collection(name) {
          if (name === 'inventory_correction_requests') {
            return {
              doc() {
                return {
                  async get() {
                    return {
                      data: {
                        _id: 'corr-reject-1',
                        status: 'pending',
                        source_log_id: 'log-in-3',
                        inventory_id: 'inv-3',
                        unique_code: 'L000703',
                        product_code: 'M-001',
                        category: 'film',
                        batch_number: 'PET240703',
                        original_quantity: 10,
                        requested_quantity: 12,
                        unit: 'm',
                        reason: '长度录入错误'
                      }
                    };
                  },
                  async update() {
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'inventory_log') {
            return {
              doc() {
                return {
                  async get() {
                    return { data: sourceLog };
                  }
                };
              },
              where() {
                return {
                  skip(value) {
                    scannedSkips.push(value);
                    this._skip = value;
                    return this;
                  },
                  limit() {
                    return this;
                  },
                  async get() {
                    if (this._skip === 0) {
                      return {
                        data: new Array(100).fill(null).map((_, index) => ({
                          _id: index === 0 ? 'log-in-3' : `log-noop-${index}`,
                          type: index === 0 ? 'inbound' : 'create',
                          inventory_id: 'inv-3',
                          timestamp: new Date('2026-03-25T08:00:00.000Z')
                        }))
                      };
                    }
                    return {
                      data: [{
                        _id: 'log-out-1',
                        type: 'outbound',
                        inventory_id: 'inv-3',
                        timestamp: new Date('2026-03-25T09:00:00.000Z')
                      }]
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
                        _id: 'inv-3',
                        status: 'in_stock',
                        category: 'film',
                        quantity: { val: 10, unit: 'm' },
                        dynamic_attrs: {
                          current_length_m: 10,
                          initial_length_m: 10,
                          width_mm: 1000
                        }
                      }
                    };
                  },
                  async update() {
                    inventoryUpdated = true;
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection(receiptStore);
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      });
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/approveInventoryCorrectionRequest/index.js', {
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
      assertAdminMutationAccess() {
        return { ok: true };
      }
    }
  });

  const result = await mod.main({
    request_id: 'corr-reject-1',
    action: 'approve',
    operation_id: 'op_correction_reject_001'
  });
  const retry = await mod.main({
    request_id: 'corr-reject-1',
    action: 'approve',
    operation_id: 'op_correction_reject_001'
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /已有后续业务/);
  assert.deepEqual(retry, result);
  assert.equal(inventoryUpdated, false);
  assert.deepEqual(scannedSkips, [0, 100]);
});

test('logs and approval center expose inventory correction actions and correction approvals', () => {
  const logItemJs = read('miniprogram/components/log-item/index.js');
  const logItemWxml = read('miniprogram/components/log-item/index.wxml');
  const logsJs = read('miniprogram/pages/logs/index.js');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');
  const approvalCenterJs = read('miniprogram/pages/admin/approval-center/index.js');
  const approvalCenterWxml = read('miniprogram/pages/admin/approval-center/index.wxml');
  const inventoryDetailJs = read('miniprogram/pages/inventory-detail/index.js');

  assert.match(logItemJs, /requestcorrection/i);
  assert.match(logItemWxml, /发起纠错申请/);
  assert.match(logsWxml, /bind:requestcorrection="onRequestCorrection"/);
  assert.match(adminLogsWxml, /bind:requestcorrection="onRequestCorrection"/);
  assert.match(logsJs, /submitInventoryCorrectionRequest/);
  assert.match(adminLogsJs, /submitInventoryCorrectionRequest/);
  assert.match(logsJs, /refill/);
  assert.match(logsJs, /adjust/);
  assert.match(adminLogsJs, /refill/);
  assert.match(adminLogsJs, /adjust/);
  assert.match(approvalCenterJs, /correction/);
  assert.match(approvalCenterJs, /approveInventoryCorrectionRequest/);
  assert.match(approvalCenterWxml, /库存纠错/);
  assert.match(approvalCenterWxml, /申请数量/);
  assert.match(inventoryDetailJs, /dynamic_attrs && item\.dynamic_attrs\.initial_length_m/);
  assert.match(inventoryDetailJs, /dynamic_attrs && item\.dynamic_attrs\.current_length_m/);
  assert.doesNotMatch(inventoryDetailJs, /item\.inventory \? item\.inventory\.length_m/);
});

test('manual and batch stock-in pages no longer hard-code every duplicate label as an absolute conflict for chemicals', () => {
  const materialAddJs = read('miniprogram/pages/material-add/index.js');
  const batchEntryJs = read('miniprogram/pages/material-add/batch-entry.js');

  assert.match(materialAddJs, /补料入库/);
  assert.match(materialAddJs, /同标签在库化材/);
  assert.match(materialAddJs, /是否按补料入库处理/);
  assert.match(batchEntryJs, /补料入库/);
  assert.match(batchEntryJs, /同标签在库化材/);
  assert.match(batchEntryJs, /待补料/);
});
