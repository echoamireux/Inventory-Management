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

test('material import batchCreate keeps create-only semantics while writing governed chemical and film master fields', async () => {
  const addedMaterials = [];
  const materialLogs = [];
  const existingCodes = new Set(['J-003']);

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where(query) {
            return {
              async count() {
                return {
                  total: existingCodes.has(query.product_code) ? 1 : 0
                };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            existingCodes.add(data.product_code);
            return { _id: `mat-${addedMaterials.length}` };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add({ data }) {
            materialLogs.push(data);
            return { _id: `log-${materialLogs.length}` };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
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
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        const results = [];
        return {
          recordCreated(rowIndex, productCode) {
            results.push({ rowIndex, product_code: productCode, status: 'created' });
          },
          recordSkipped(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'skipped', reason });
          },
          recordError(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'error', reason });
          },
          toResponse() {
            return {
              skipped: results.filter(item => item.status === 'skipped').length,
              errors: results.filter(item => item.status === 'error').length,
              results
            };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical' },
          { subcategory_key: 'builtin:film:protective-film', name: '保护膜', parent_category: 'film' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection(payload) {
        if (payload.category === 'film') {
          return {
            subcategory_key: 'builtin:film:protective-film',
            sub_category: '保护膜'
          };
        }
        return {
          subcategory_key: 'builtin:chemical:solvent',
          sub_category: '溶剂'
        };
      }
    }
  });

  const result = await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '001',
          material_name: '异丙醇',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'L',
          package_type: '铁桶',
          supplier: '国药',
          supplier_model: 'IPA-99'
        },
        {
          rowIndex: 3,
          product_code: '002',
          material_name: 'PET保护膜',
          category: 'film',
          sub_category: '保护膜',
          default_unit: 'm',
          thickness_um: 25,
          standard_width_mm: 1240,
          supplier: '东丽',
          supplier_model: 'T100'
        },
        {
          rowIndex: 4,
          product_code: '003',
          material_name: '重复化材',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'kg'
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.created, 2);
  assert.equal(result.skipped, 1);
  assert.equal(addedMaterials.length, 2);
  assert.equal(addedMaterials[0].package_type, '铁桶');
  assert.equal(addedMaterials[0].supplier_model, 'IPA-99');
  assert.deepEqual(addedMaterials[1].specs, {
    thickness_um: 25,
    standard_width_mm: 1240
  });
  assert.equal(
    result.results.find(item => item.rowIndex === 4).reason,
    '产品代码已存在'
  );
  const createAuditEvents = materialLogs.filter(item => (
    item.domain === 'material' && item.action === 'create'
  ));
  const batchAuditEvents = materialLogs.filter(item => (
    item.domain === 'material' && item.action === 'batch_create'
  ));
  assert.equal(createAuditEvents.length, 2);
  assert.deepEqual(
    createAuditEvents.map(item => item.target_label).sort(),
    ['J-001', 'M-002']
  );
  assert.equal(batchAuditEvents.length, 1);
});

test('material import batchCreate routes test-material rows into identities and rejects unknown test codes', async () => {
  const addedMaterials = [];
  const addedIdentities = [];
  const auditEvents = [];
  const materialsByCode = new Map([
    ['J-999', {
      _id: 'mat-existing-test',
      product_code: 'J-999',
      material_name: '测试料',
      category: 'chemical',
      subcategory_key: 'builtin:chemical:test-material',
      sub_category: '测试料',
      supplier: '',
      supplier_model: '',
      is_test_material: true,
      status: 'active'
    }]
  ]);

  function buildCollection(name) {
    if (name === 'materials') {
      return {
        where(query = {}) {
          return {
            limit() {
              return this;
            },
            async get() {
              if (query.product_code) {
                const matched = materialsByCode.get(query.product_code);
                return { data: matched ? [matched] : [] };
              }
              return { data: [] };
            },
            async count() {
              return {
                total: query.product_code && materialsByCode.has(query.product_code) ? 1 : 0
              };
            }
          };
        },
        async add({ data }) {
          const record = { _id: `mat-${addedMaterials.length + 1}`, ...data };
          addedMaterials.push(record);
          materialsByCode.set(record.product_code, record);
          return { _id: record._id };
        }
      };
    }

    if (name === 'test_material_identities') {
      return {
        where(query = {}) {
          return {
            limit() {
              return this;
            },
            async get() {
              if (query.identity_key) {
                return { data: addedIdentities.filter(item => item.identity_key === query.identity_key) };
              }
              if (query.category && query.product_code) {
                return {
                  data: addedIdentities.filter(item => (
                    item.category === query.category && item.product_code === query.product_code
                  ))
                };
              }
              return { data: [] };
            }
          };
        },
        async add({ data }) {
          const record = { _id: `identity-${addedIdentities.length + 1}`, ...data };
          addedIdentities.push(record);
          return { _id: record._id };
        }
      };
    }

    if (name === 'material_log' || name === 'audit_events') {
      return {
        async add({ data }) {
          auditEvents.push(data);
          return { _id: `audit-${auditEvents.length}` };
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
                data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
              };
            }
          };
        }
      };
    }

    throw new Error(`unexpected collection: ${name}`);
  }

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    async createCollection() {},
    collection: buildCollection
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

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        const results = [];
        return {
          recordCreated(rowIndex, productCode) {
            results.push({ rowIndex, product_code: productCode, status: 'created' });
          },
          recordSkipped(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'skipped', reason });
          },
          recordError(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'error', reason });
          },
          toResponse() {
            return {
              skipped: results.filter(item => item.status === 'skipped').length,
              errors: results.filter(item => item.status === 'error').length,
              results
            };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:test-material', name: '测试料', parent_category: 'chemical', status: 'active' },
          { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical', status: 'active' },
          { subcategory_key: 'custom:chemical:resin', name: '树脂', parent_category: 'chemical', status: 'active' },
          { subcategory_key: 'builtin:film:protective-film', name: '保护膜', parent_category: 'film', status: 'active' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection(payload, records) {
        const matched = records.find(item => item.name === payload.sub_category)
          || records.find(item => item.subcategory_key === payload.subcategory_key);
        return matched
          ? { subcategory_key: matched.subcategory_key, sub_category: matched.name }
          : { subcategory_key: '', sub_category: '' };
      }
    }
  });

  const result = await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '001',
          material_name: '异丙醇',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'L',
          package_type: '铁桶',
          is_test_material: false
        },
        {
          rowIndex: 3,
          product_code: '999',
          material_name: '环氧树脂样品',
          category: 'chemical',
          sub_category: '树脂',
          default_unit: 'g',
          package_type: '瓶装',
          supplier: '供应商A',
          supplier_model: ' TEST - 01 ',
          is_test_material: true
        },
        {
          rowIndex: 4,
          product_code: '998',
          material_name: '误填样品',
          category: 'chemical',
          sub_category: '树脂',
          default_unit: 'g',
          package_type: '瓶装',
          supplier: '供应商B',
          supplier_model: ' TEST - 02 ',
          is_test_material: true
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.created, 2);
  assert.equal(result.errors, 1);
  assert.equal(addedMaterials.length, 1);
  assert.equal(addedMaterials[0].product_code, 'J-001');
  assert.equal(materialsByCode.get('J-999').supplier_model, '');
  assert.equal(addedIdentities.length, 1);
  assert.equal(addedIdentities[0].product_code, 'J-999');
  assert.equal(addedIdentities[0].label_material_name, '环氧树脂样品');
  assert.equal(addedIdentities[0].material_name, '环氧树脂样品');
  assert.equal(addedIdentities[0].sub_category, '树脂');
  assert.equal(addedIdentities[0].supplier, '供应商A');
  assert.equal(addedIdentities[0].supplier_model, 'TEST-01');
  assert.equal(addedIdentities[0].identity_key, 'chemical::J-999::TEST-01');
  assert.equal(materialsByCode.has('J-998'), false);
  assert.equal(addedIdentities.some(item => item.product_code === 'J-998'), false);
  assert.ok(result.results.some(item => (
    item.rowIndex === 4
    && item.product_code === '998'
    && item.status === 'error'
    && /测试料产品代码 J-998 未维护/.test(item.reason)
  )));
  assert.ok(auditEvents.some(item => item.domain === 'test_material_identity' && item.action === 'create'));
  assert.equal(auditEvents.some(item => item.action === 'create_test_material_shell'), false);
});

test('material import batchCreate returns success with warning when summary audit fails after row audits', async () => {
  const addedMaterials = [];
  const materialLogs = [];

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            return { _id: `mat-${addedMaterials.length}` };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add({ data }) {
            if (data.action === 'batch_create') {
              throw new Error('summary audit unavailable');
            }
            materialLogs.push(data);
            return { _id: `log-${materialLogs.length}` };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-admin' };
      },
      database() {
        return db;
      }
    },
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode() {
        return { ok: true, product_code: 'J-011' };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        const results = [];
        return {
          recordCreated(rowIndex, productCode) {
            results.push({ rowIndex, product_code: productCode, status: 'created' });
          },
          recordSkipped(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'skipped', reason });
          },
          recordError(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'error', reason });
          },
          toResponse() {
            return {
              skipped: results.filter(item => item.status === 'skipped').length,
              errors: results.filter(item => item.status === 'error').length,
              results
            };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection() {
        return {
          subcategory_key: 'builtin:chemical:solvent',
          sub_category: '溶剂'
        };
      }
    }
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await manageMaterial.main({
      action: 'batchCreate',
      data: {
        items: [{
          rowIndex: 2,
          product_code: '011',
          material_name: '汇总审计测试料',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'g',
          package_type: '瓶'
        }]
      }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.success, true);
  assert.equal(result.created, 1);
  assert.equal(addedMaterials.length, 1);
  assert.equal(materialLogs.filter(item => item.action === 'create').length, 1);
  assert.match(result.warning, /汇总审计记录写入失败/);
});

test('material import batchCreate allows film creation without default width while still persisting thickness', async () => {
  const addedMaterials = [];

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            return { _id: 'mat-1' };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add() {
            return { _id: 'log-1' };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
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
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        return {
          recordCreated() {},
          recordSkipped() {},
          recordError() {},
          toResponse() {
            return { skipped: 0, errors: 0, results: [] };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:film:protective-film', name: '保护膜', parent_category: 'film' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection() {
        return {
          subcategory_key: 'builtin:film:protective-film',
          sub_category: '保护膜'
        };
      }
    }
  });

  const result = await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '002',
          material_name: 'PET保护膜',
          category: 'film',
          sub_category: '保护膜',
          default_unit: 'm',
          thickness_um: 25,
          standard_width_mm: null,
          supplier: '东丽',
          supplier_model: 'T100'
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(addedMaterials.length, 1);
  assert.deepEqual(addedMaterials[0].specs, {
    thickness_um: 25
  });
});

test('material import batchCreate rejects film rows that omit thickness even if the request bypasses frontend validation', async () => {
  const addedMaterials = [];

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            return { _id: 'mat-1' };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add() {
            return { _id: 'log-1' };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
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
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        const results = [];
        return {
          recordCreated(rowIndex, productCode) {
            results.push({ rowIndex, product_code: productCode, status: 'created' });
          },
          recordSkipped(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'skipped', reason });
          },
          recordError(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'error', reason });
          },
          toResponse() {
            return {
              skipped: results.filter(item => item.status === 'skipped').length,
              errors: results.filter(item => item.status === 'error').length,
              results
            };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:film:protective-film', name: '保护膜', parent_category: 'film' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection() {
        return {
          subcategory_key: 'builtin:film:protective-film',
          sub_category: '保护膜'
        };
      }
    }
  });

  const result = await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '002',
          material_name: 'PET保护膜',
          category: 'film',
          sub_category: '保护膜',
          default_unit: 'm',
          standard_width_mm: 1240,
          supplier: '东丽',
          supplier_model: 'T100'
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.created, 0);
  assert.equal(result.errors, 1);
  assert.equal(addedMaterials.length, 0);
  assert.equal(result.results[0].reason, '膜材厚度必填');
});

test('material import batchCreate blocks same-code rows in one file when their governed master fields conflict', async () => {
  const addedMaterials = [];

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            return { _id: `mat-${addedMaterials.length}` };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add() {
            return { _id: 'log-1' };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
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
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        const results = [];
        return {
          recordCreated(rowIndex, productCode) {
            results.push({ rowIndex, product_code: productCode, status: 'created' });
          },
          recordSkipped(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'skipped', reason });
          },
          recordError(rowIndex, productCode, reason) {
            results.push({ rowIndex, product_code: productCode, status: 'error', reason });
          },
          toResponse() {
            return {
              skipped: results.filter(item => item.status === 'skipped').length,
              errors: results.filter(item => item.status === 'error').length,
              results
            };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical' },
          { subcategory_key: 'builtin:chemical:resin', name: '树脂', parent_category: 'chemical' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection(payload) {
        if (payload.sub_category === '树脂') {
          return {
            subcategory_key: 'builtin:chemical:resin',
            sub_category: '树脂'
          };
        }
        return {
          subcategory_key: 'builtin:chemical:solvent',
          sub_category: '溶剂'
        };
      }
    }
  });

  const result = await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '001',
          material_name: '异丙醇',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'L',
          package_type: '铁桶',
          supplier: '国药',
          supplier_model: 'IPA-99'
        },
        {
          rowIndex: 3,
          product_code: '001',
          material_name: '异丙醇',
          category: 'chemical',
          sub_category: '树脂',
          default_unit: 'kg',
          package_type: '铁桶',
          supplier: '国药',
          supplier_model: 'IPA-99'
        }
      ]
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.created, 0);
  assert.equal(result.errors, 2);
  assert.equal(addedMaterials.length, 0);
  assert.equal(
    result.results[0].reason,
    '产品代码 J-001 在本次导入文件中重复，且主数据字段不一致，请统一后再导入'
  );
  assert.equal(
    result.results[1].reason,
    '产品代码 J-001 在本次导入文件中重复，且主数据字段不一致，请统一后再导入'
  );
});

test('material import duplicate guard treats test-material flag as a governed identity field', () => {
  const source = read('cloudfunctions/manageMaterial/index.js');

  assert.match(source, /is_test_material:\s*normalizeTestMaterialFlag\(item\.item\.is_test_material\)\.value/);
});

test('material import batchCreate ignores film-only fields on chemical rows and keeps governed master fields category-safe', async () => {
  const addedMaterials = [];

  const db = {
    command: {
      remove() {
        return { __remove: true };
      }
    },
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          async add({ data }) {
            addedMaterials.push(data);
            return { _id: 'mat-1' };
          }
        };
      }

      if (name === 'material_log' || name === 'audit_events') {
        return {
          async add() {
            return { _id: 'log-1' };
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
                  data: [{ _openid: 'openid-admin', role: 'admin', status: 'active' }]
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
      return { OPENID: 'openid-admin' };
    },
    database() {
      return db;
    }
  };

  const manageMaterial = loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
    'wx-server-sdk': cloudStub,
    './material-units': {
      normalizeUnitInput(_category, unit) {
        return { ok: true, unit };
      }
    },
    './product-code': {
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './import-batch-results': {
      createImportResultTracker() {
        return {
          recordCreated() {},
          recordSkipped() {},
          recordError() {},
          toResponse() {
            return { skipped: 0, errors: 0, results: [] };
          }
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical' }
        ];
      },
      sortSubcategoryRecords(records) {
        return records;
      },
      filterSubcategoryRecordsByCategory(records, category) {
        return records.filter(item => item.parent_category === category);
      },
      buildSubcategoryMap(records) {
        return new Map(records.map(item => [item.subcategory_key, item]));
      },
      resolveSubcategoryDisplay(item) {
        return item.sub_category || '';
      },
      resolveSubcategorySelection() {
        return {
          subcategory_key: 'builtin:chemical:solvent',
          sub_category: '溶剂'
        };
      }
    }
  });

  await manageMaterial.main({
    action: 'batchCreate',
    data: {
      items: [
        {
          rowIndex: 2,
          product_code: '001',
          material_name: '异丙醇',
          category: 'chemical',
          sub_category: '溶剂',
          default_unit: 'L',
          package_type: '铁桶',
          thickness_um: 25,
          standard_width_mm: 1240,
          supplier: '国药',
          supplier_model: 'IPA-99'
        }
      ]
    }
  });

  assert.equal(addedMaterials.length, 1);
  assert.equal(addedMaterials[0].package_type, '铁桶');
  assert.equal('specs' in addedMaterials[0], false);
});
