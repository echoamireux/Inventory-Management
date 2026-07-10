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

function createManageMaterialModule({
  existingMaterial = null,
  materialsById = null,
  inventoryRecords = [],
  onAdd = () => {},
  onUpdate = () => {},
  onRemove = () => {}
} = {}) {
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

      if (name === 'materials') {
        return {
          where() {
            return {
              async count() {
                return { total: 0 };
              }
            };
          },
          doc(id) {
            return {
              async get() {
                return {
                  data: (materialsById && materialsById[id]) || existingMaterial || {
                    _id: 'mat-test',
                    product_code: 'J-999',
                    material_name: '测试料-化材',
                    category: 'chemical',
                    subcategory_key: 'builtin:chemical:test',
                    sub_category: '测试料',
                    default_unit: 'g',
                    package_type: '瓶',
                    supplier_model: 'OLD-001',
                    is_test_material: false
                  }
                };
              },
              async update({ data }) {
                onUpdate(data, id);
                return {};
              },
              async remove() {
                onRemove(id);
                return {};
              }
            };
          },
          async add({ data }) {
            onAdd(data);
            return { _id: 'mat-created' };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where(query = {}) {
            const matches = inventoryRecords.filter(record => Object.entries(query).every(
              ([key, value]) => record[key] === value
            ));
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: matches.map(item => ({ ...item })) };
              },
              async count() {
                return { total: matches.length };
              }
            };
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

      throw new Error(`unexpected collection: ${name}`);
    },
    runTransaction(handler) {
      return handler({ collection: db.collection.bind(db) });
    }
  };

  return loadModuleWithMocks('../cloudfunctions/manageMaterial/index.js', {
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
      validateStandardProductCode(category, code) {
        const prefix = category === 'film' ? 'M' : 'J';
        const number = String(code).replace(/^[A-Z]{1,4}-/i, '').padStart(3, '0');
        return {
          ok: true,
          product_code: `${prefix}-${number}`
        };
      }
    },
    './material-subcategories': {
      async ensureBuiltinSubcategories() {
        return [
          { subcategory_key: 'builtin:chemical:test', name: '测试料', parent_category: 'chemical' }
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
          subcategory_key: 'builtin:chemical:test',
          sub_category: '测试料'
        };
      }
    }
  });
}

test('manageMaterial create allows test material master records without supplier model', async () => {
  const addedMaterials = [];
  const manageMaterial = createManageMaterialModule({
    onAdd(data) {
      addedMaterials.push(data);
    }
  });

  const result = await manageMaterial.main({
    action: 'create',
    data: {
      product_code: '999',
      material_name: '测试料-化材',
      category: 'chemical',
      subcategory_key: 'builtin:chemical:test',
      sub_category: '测试料',
      default_unit: 'g',
      package_type: '瓶',
      is_test_material: true,
      supplier_model: '   '
    }
  });

  assert.equal(result.success, true);
  assert.equal(addedMaterials.length, 1);
  assert.equal(addedMaterials[0].is_test_material, true);
  assert.equal(addedMaterials[0].supplier_model, '');
});

test('manageMaterial update allows switching a material to test material without supplier model', async () => {
  const updatedMaterials = [];
  const manageMaterial = createManageMaterialModule({
    onUpdate(data) {
      updatedMaterials.push(data);
    }
  });

  const result = await manageMaterial.main({
    action: 'update',
    data: {
      id: 'mat-test',
      product_code: '999',
      material_name: '测试料-化材',
      category: 'chemical',
      subcategory_key: 'builtin:chemical:test',
      sub_category: '测试料',
      default_unit: 'g',
      package_type: '瓶',
      is_test_material: true,
      supplier_model: ''
    }
  });

  assert.equal(result.success, true);
  assert.equal(updatedMaterials.length, 1);
  assert.equal(updatedMaterials[0].is_test_material, true);
  assert.equal(updatedMaterials[0].supplier_model, '');
});

test('manageMaterial update ignores non-editable client fields', async () => {
  const updatedMaterials = [];
  const manageMaterial = createManageMaterialModule({
    onUpdate(data) {
      updatedMaterials.push(data);
    }
  });

  const result = await manageMaterial.main({
    action: 'update',
    data: {
      id: 'mat-test',
      product_code: '999',
      product_code_number: '999',
      material_name: '测试料-化材',
      category: 'chemical',
      subcategory_key: 'builtin:chemical:test',
      sub_category: '测试料',
      default_unit: 'g',
      package_type: '瓶',
      is_test_material: false,
      status: 'archived',
      created_by: 'forged-openid'
    }
  });

  assert.equal(result.success, true);
  assert.equal(updatedMaterials.length, 1);
  assert.equal(Object.hasOwn(updatedMaterials[0], 'status'), false);
  assert.equal(Object.hasOwn(updatedMaterials[0], 'created_by'), false);
  assert.equal(Object.hasOwn(updatedMaterials[0], 'product_code_number'), false);
});

test('manageMaterial locks identity fields after any inventory record exists', async () => {
  const updatedMaterials = [];
  const manageMaterial = createManageMaterialModule({
    inventoryRecords: [{
      _id: 'inv-history-1',
      material_id: 'mat-test',
      product_code: 'J-999',
      status: 'used'
    }],
    onUpdate(data) {
      updatedMaterials.push(data);
    }
  });

  const result = await manageMaterial.main({
    action: 'update',
    data: {
      id: 'mat-test',
      product_code: '998',
      material_name: '测试料-化材',
      category: 'chemical',
      subcategory_key: 'builtin:chemical:test',
      sub_category: '测试料',
      default_unit: 'g',
      package_type: '瓶',
      is_test_material: false
    }
  });

  assert.equal(result.success, false);
  assert.match(result.msg, /库存记录.*身份字段|身份字段.*库存记录/);
  assert.equal(updatedMaterials.length, 0);
});

test('manageMaterial batch deletion refuses to archive materials with current stock', async () => {
  const updatedMaterials = [];
  let removed = 0;
  const manageMaterial = createManageMaterialModule({
    inventoryRecords: [{
      _id: 'inv-current-1',
      material_id: 'mat-test',
      product_code: 'J-999',
      status: 'in_stock'
    }],
    onUpdate(data) {
      updatedMaterials.push(data);
    },
    onRemove() {
      removed += 1;
    }
  });

  const result = await manageMaterial.main({
    action: 'batchDelete',
    data: { ids: ['mat-test'], archive_reason: '测试批量归档' }
  });

  assert.equal(result.success, false);
  assert.equal(result.failed, 1);
  assert.match(result.msg, /存在在库记录/);
  assert.equal(updatedMaterials.length, 0);
  assert.equal(removed, 0);
});

test('manageMaterial batch deletion is atomic when any selected material is still in stock', async () => {
  const removedIds = [];
  const manageMaterial = createManageMaterialModule({
    materialsById: {
      'mat-free': {
        _id: 'mat-free',
        product_code: 'J-001',
        category: 'chemical',
        status: 'active'
      },
      'mat-blocked': {
        _id: 'mat-blocked',
        product_code: 'J-002',
        category: 'chemical',
        status: 'active'
      }
    },
    inventoryRecords: [{
      _id: 'inv-current-2',
      material_id: 'mat-blocked',
      product_code: 'J-002',
      status: 'in_stock'
    }],
    onRemove(id) {
      removedIds.push(id);
    }
  });

  const result = await manageMaterial.main({
    action: 'batchDelete',
    data: { ids: ['mat-free', 'mat-blocked'], archive_reason: '批量清理' }
  });

  assert.equal(result.success, false);
  assert.deepEqual(removedIds, []);
});
