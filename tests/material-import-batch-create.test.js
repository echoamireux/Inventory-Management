const test = require('node:test');
const assert = require('node:assert/strict');
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

      if (name === 'material_log') {
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
        const prefix = category === 'film' ? 'M-' : 'J-';
        const number = String(code).replace(/^[A-Z]-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}${number}`
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
  assert.equal(materialLogs.length > 0, true);
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

      if (name === 'material_log') {
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
        const prefix = category === 'film' ? 'M-' : 'J-';
        const number = String(code).replace(/^[A-Z]-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}${number}`
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

      if (name === 'material_log') {
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
        const prefix = category === 'film' ? 'M-' : 'J-';
        const number = String(code).replace(/^[A-Z]-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}${number}`
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

      if (name === 'material_log') {
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
        const prefix = category === 'film' ? 'M-' : 'J-';
        const number = String(code).replace(/^[A-Z]-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}${number}`
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

      if (name === 'material_log') {
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
        const prefix = category === 'film' ? 'M-' : 'J-';
        const number = String(code).replace(/^[A-Z]-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}${number}`
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
