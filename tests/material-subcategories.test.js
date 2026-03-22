const test = require('node:test');
const assert = require('node:assert/strict');

const frontendSubcategories = require('../miniprogram/utils/material-subcategory');
const backendSubcategories = require('../cloudfunctions/_shared/material-subcategories');

function createMockDb(initialRecords) {
  const state = {
    records: initialRecords.map(item => ({ ...item })),
    nextId: initialRecords.length + 1
  };

  const collection = {
    skip(skip) {
      return {
        limit(limit) {
          return {
            async get() {
              return {
                data: state.records.slice(skip, skip + limit).map(item => ({ ...item }))
              };
            }
          };
        }
      };
    },
    doc(id) {
      return {
        async update({ data }) {
          const index = state.records.findIndex(item => item._id === id);
          if (index === -1) {
            throw new Error(`missing doc: ${id}`);
          }
          state.records[index] = {
            ...state.records[index],
            ...data
          };
        }
      };
    },
    async add({ data }) {
      const _id = `mock-${state.nextId++}`;
      state.records.push({ _id, ...data });
      return { _id };
    }
  };

  return {
    serverDate() {
      return { $date: true };
    },
    async createCollection(name) {
      assert.equal(name, 'material_subcategories');
      return { errMsg: 'ok' };
    },
    collection(name) {
      assert.equal(name, 'material_subcategories');
      return collection;
    }
  };
}

test('subcategory seeds cover both chemical and film defaults', () => {
  const seedKeys = backendSubcategories.BUILTIN_SUBCATEGORY_SEEDS.map(item => item.subcategory_key);

  assert.deepEqual(seedKeys, [
    'builtin:chemical:adhesive',
    'builtin:chemical:resin',
    'builtin:chemical:solvent',
    'builtin:chemical:additive',
    'builtin:chemical:pigment',
    'builtin:chemical:hardener',
    'builtin:film:pet',
    'builtin:film:pp-pe',
    'builtin:film:pe',
    'builtin:film:po',
    'builtin:film:pi',
    'builtin:film:release-film',
    'builtin:film:protective-film',
    'builtin:film:tape',
    'builtin:film:hard-coat'
  ]);
});

for (const [label, impl] of [
  ['frontend', frontendSubcategories],
  ['backend', backendSubcategories]
]) {
  test(`${label}: subcategory display prefers stable key and only falls back to sub_category snapshot`, () => {
    const subcategoryMap = impl.buildSubcategoryMap([
      { subcategory_key: 'builtin:chemical:solvent', name: '溶剂-新' }
    ]);

    assert.equal(
      impl.resolveSubcategoryDisplay({
        subcategory_key: 'builtin:chemical:solvent',
        sub_category: '旧溶剂'
      }, subcategoryMap),
      '溶剂-新'
    );

    assert.equal(
      impl.resolveSubcategoryDisplay({
        sub_category: '历史文本'
      }, subcategoryMap),
      '历史文本'
    );

    assert.equal(
      impl.resolveSubcategoryDisplay({
        suggested_sub_category: '旧建议'
      }, subcategoryMap),
      ''
    );

    assert.equal(
      impl.resolveSubcategoryDisplay({
        name: '旧名字兜底'
      }, subcategoryMap),
      ''
    );
  });
}

for (const [label, impl] of [
  ['frontend', frontendSubcategories],
  ['backend', backendSubcategories]
]) {
  test(`${label}: deprecated legacy "其他" subcategories stay readable but disappear from new pickers`, () => {
    const records = [
      { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', status: 'active' },
      { subcategory_key: 'builtin:chemical:other', name: '其他 (Other)', status: 'active' }
    ];

    assert.deepEqual(
      impl.buildSubcategoryActions(records),
      [{ name: '溶剂', subcategory_key: 'builtin:chemical:solvent' }]
    );

    const subcategoryMap = impl.buildSubcategoryMap(records);
    assert.equal(
      impl.resolveSubcategoryDisplay({
        subcategory_key: 'builtin:chemical:other',
        sub_category: '其他 (Other)'
      }, subcategoryMap),
      '其他 (Other)'
    );
  });
}

for (const [label, impl] of [
  ['frontend', frontendSubcategories],
  ['backend', backendSubcategories]
]) {
  test(`${label}: deprecated optical film stays readable but disappears from new pickers`, () => {
    const records = [
      { subcategory_key: 'builtin:film:protective-film', name: '保护膜', status: 'active' },
      { subcategory_key: 'builtin:film:optical-film', name: '光学膜', status: 'active' }
    ];

    assert.deepEqual(
      impl.buildSubcategoryActions(records),
      [{ name: '保护膜', subcategory_key: 'builtin:film:protective-film' }]
    );

    const subcategoryMap = impl.buildSubcategoryMap(records);
    assert.equal(
      impl.resolveSubcategoryDisplay({
        subcategory_key: 'builtin:film:optical-film',
        sub_category: '光学膜'
      }, subcategoryMap),
      '光学膜'
    );
  });
}

test('backend: subcategory selection resolves current snapshot by key or matching name within category', () => {
  const records = backendSubcategories.sortSubcategoryRecords([
    {
      subcategory_key: 'builtin:chemical:resin',
      name: '树脂-新版',
      parent_category: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    }
  ]);
  const subcategoryMap = backendSubcategories.buildSubcategoryMap(records);

  assert.deepEqual(
    backendSubcategories.resolveSubcategorySelection({
      category: 'chemical',
      subcategory_key: 'builtin:chemical:resin',
      sub_category: '树脂'
    }, records, subcategoryMap),
    {
      subcategory_key: 'builtin:chemical:resin',
      sub_category: '树脂-新版'
    }
  );

  assert.deepEqual(
    backendSubcategories.resolveSubcategorySelection({
      category: 'chemical',
      sub_category: '树脂-新版'
    }, records, subcategoryMap),
    {
      subcategory_key: 'builtin:chemical:resin',
      sub_category: '树脂-新版'
    }
  );
});

test('backend: deprecated "其他" can no longer be resolved as a valid new selection', () => {
  const records = backendSubcategories.sortSubcategoryRecords([
    {
      subcategory_key: 'builtin:chemical:other',
      name: '其他 (Other)',
      parent_category: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 70
    }
  ]);
  const subcategoryMap = backendSubcategories.buildSubcategoryMap(records);

  assert.deepEqual(
    backendSubcategories.resolveSubcategorySelection({
      category: 'chemical',
      subcategory_key: 'builtin:chemical:other',
      sub_category: '其他 (Other)'
    }, records, subcategoryMap),
    {
      subcategory_key: '',
      sub_category: '其他 (Other)'
    }
  );
});

test('backend: ensureBuiltinSubcategories refreshes builtin names and default order from seeds', async () => {
  const db = createMockDb([
    {
      _id: 'subcat-adhesive',
      subcategory_key: 'builtin:chemical:adhesive',
      name: '胶水 (Adhesive)',
      parent_category: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 60
    },
    {
      _id: 'subcat-film-pppe',
      subcategory_key: 'builtin:film:pp-pe',
      name: '基材-PP/PE',
      parent_category: 'film',
      is_builtin: true,
      status: 'active',
      sort_order: 130
    }
  ]);

  const synced = await backendSubcategories.ensureBuiltinSubcategories(db);
  const syncedMap = new Map(synced.map(item => [item.subcategory_key, item]));

  assert.equal(syncedMap.get('builtin:chemical:adhesive').name, '主胶');
  assert.equal(syncedMap.get('builtin:chemical:adhesive').sort_order, 10);
  assert.equal(syncedMap.get('builtin:chemical:hardener').sort_order, 60);
  assert.equal(syncedMap.get('builtin:film:pp-pe').name, '基材-BOPP');
  assert.equal(syncedMap.get('builtin:film:pp-pe').sort_order, 120);
  assert.equal(syncedMap.get('builtin:film:pe').name, '基材-PE');
  assert.equal(syncedMap.get('builtin:film:po').name, '基材-PO');
  assert.equal(syncedMap.get('builtin:film:hard-coat').name, '硬化膜');
});
