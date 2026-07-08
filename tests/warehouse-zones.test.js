const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_ZONE_SEEDS,
  DEFAULT_SAFE_CABINET_LOCATION_DETAILS,
  normalizeZoneRecord,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildBuiltinLocationDetailSeeds,
  ensureBuiltinLocationDetails,
  composeLocationText,
  ensureBuiltinZones,
  buildInventoryLocationPayload,
  resolveInventoryLocationText
} = require('../cloudfunctions/_shared/warehouse-zones');

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
        },
        async set({ data }) {
          const index = state.records.findIndex(item => item._id === id);
          if (index === -1) {
            state.records.push({ _id: id, ...data });
          } else {
            state.records[index] = {
              ...state.records[index],
              ...data
            };
          }
          return { _id: id };
        },
        async remove() {
          const index = state.records.findIndex(item => item._id === id);
          if (index >= 0) {
            state.records.splice(index, 1);
          }
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
    collection(name) {
      assert.equal(name, 'warehouse_zones');
      return collection;
    },
    state
  };
}

function createMockMultiCollectionDb(initialCollections) {
  const state = {};

  Object.keys(initialCollections).forEach((name) => {
    state[name] = {
      records: initialCollections[name].map(item => ({ ...item })),
      nextId: initialCollections[name].length + 1
    };
  });

  function getCollectionState(name) {
    if (!state[name]) {
      state[name] = { records: [], nextId: 1 };
    }
    return state[name];
  }

  return {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      const collectionState = getCollectionState(name);

      return {
        skip(skip) {
          return {
            limit(limit) {
              return {
                async get() {
                  return {
                    data: collectionState.records
                      .slice(skip, skip + limit)
                      .map(item => ({ ...item }))
                  };
                }
              };
            }
          };
        },
        doc(id) {
          return {
            async update({ data }) {
              const index = collectionState.records.findIndex(item => item._id === id);
              if (index === -1) {
                throw new Error(`missing doc: ${name}/${id}`);
              }
              collectionState.records[index] = {
                ...collectionState.records[index],
                ...data
              };
            },
            async set({ data }) {
              const index = collectionState.records.findIndex(item => item._id === id);
              if (index === -1) {
                collectionState.records.push({ _id: id, ...data });
              } else {
                collectionState.records[index] = {
                  ...collectionState.records[index],
                  ...data
                };
              }
              return { _id: id };
            }
          };
        },
        async add({ data }) {
          const _id = `${name}-mock-${collectionState.nextId++}`;
          collectionState.records.push({ _id, ...data });
          return { _id };
        }
      };
    },
    state
  };
}

test('builtin zone seeds cover both chemical and film defaults', () => {
  const zoneKeys = BUILTIN_ZONE_SEEDS.map(item => item.zone_key);

  assert.deepEqual(zoneKeys, [
    'builtin:chemical:safe-cabinet-01',
    'builtin:chemical:safe-cabinet-02',
    'builtin:chemical:safe-cabinet-03',
    'builtin:chemical:safe-cabinet-04',
    'builtin:chemical:safe-cabinet-05',
    'builtin:chemical:safe-cabinet-06',
    'builtin:chemical:safe-cabinet-07',
    'builtin:film:research-warehouse-01',
    'builtin:film:research-warehouse-02',
    'builtin:film:research-warehouse-03',
    'builtin:film:pilot-line'
  ]);

  assert.deepEqual(BUILTIN_ZONE_SEEDS.map(item => item.name), [
    '防爆柜01',
    '防爆柜02',
    '防爆柜03',
    '防爆柜04',
    '防爆柜05',
    '防爆柜06',
    '防爆柜07',
    '研发仓1',
    '研发仓2',
    '研发仓3',
    '实验线'
  ]);
});

test('builtin chemical safe cabinets expose F1-F5 managed location details', () => {
  assert.deepEqual(DEFAULT_SAFE_CABINET_LOCATION_DETAILS, ['F1', 'F2', 'F3', 'F4', 'F5']);

  const seeds = buildBuiltinLocationDetailSeeds([
    { zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' },
    { zone_key: 'builtin:film:research-warehouse-01', name: '研发仓1' }
  ]);

  assert.deepEqual(
    seeds.map(item => ({ zone_key: item.zone_key, detail_key: item.detail_key, name: item.name })),
    [
      { zone_key: 'builtin:chemical:safe-cabinet-01', detail_key: 'builtin:chemical:safe-cabinet-01:F1', name: 'F1' },
      { zone_key: 'builtin:chemical:safe-cabinet-01', detail_key: 'builtin:chemical:safe-cabinet-01:F2', name: 'F2' },
      { zone_key: 'builtin:chemical:safe-cabinet-01', detail_key: 'builtin:chemical:safe-cabinet-01:F3', name: 'F3' },
      { zone_key: 'builtin:chemical:safe-cabinet-01', detail_key: 'builtin:chemical:safe-cabinet-01:F4', name: 'F4' },
      { zone_key: 'builtin:chemical:safe-cabinet-01', detail_key: 'builtin:chemical:safe-cabinet-01:F5', name: 'F5' }
    ]
  );
});

test('ensureBuiltinLocationDetails fills missing safe cabinet details without re-enabling disabled ones', async () => {
  const db = createMockMultiCollectionDb({
    warehouse_zones: [
      {
        _id: 'builtin_chemical_safe-cabinet-01',
        zone_key: 'builtin:chemical:safe-cabinet-01',
        name: '防爆柜01',
        scope: 'chemical',
        is_builtin: true,
        status: 'active',
        sort_order: 10
      },
      {
        _id: 'builtin_film_research-warehouse-01',
        zone_key: 'builtin:film:research-warehouse-01',
        name: '研发仓1',
        scope: 'film',
        is_builtin: true,
        status: 'active',
        sort_order: 110
      }
    ],
    warehouse_location_details: [
      {
        _id: 'builtin_chemical_safe-cabinet-01_F1',
        zone_key: 'builtin:chemical:safe-cabinet-01',
        detail_key: 'builtin:chemical:safe-cabinet-01:F1',
        name: 'A',
        is_builtin: true,
        status: 'disabled',
        sort_order: 10
      }
    ]
  });

  const records = await ensureBuiltinLocationDetails(db, db.state.warehouse_zones.records);
  const safeCabinetDetails = records
    .filter(item => item.zone_key === 'builtin:chemical:safe-cabinet-01')
    .sort((left, right) => left.sort_order - right.sort_order);

  assert.deepEqual(
    safeCabinetDetails.map(item => ({
      detail_key: item.detail_key,
      name: item.name,
      status: item.status
    })),
    [
      { detail_key: 'builtin:chemical:safe-cabinet-01:F1', name: 'A', status: 'disabled' },
      { detail_key: 'builtin:chemical:safe-cabinet-01:F2', name: 'F2', status: 'active' },
      { detail_key: 'builtin:chemical:safe-cabinet-01:F3', name: 'F3', status: 'active' },
      { detail_key: 'builtin:chemical:safe-cabinet-01:F4', name: 'F4', status: 'active' },
      { detail_key: 'builtin:chemical:safe-cabinet-01:F5', name: 'F5', status: 'active' }
    ]
  );

  assert.equal(
    records.some(item => item.zone_key === 'builtin:film:research-warehouse-01'),
    false
  );
});

test('legacy zone docs normalize into unified active global records', () => {
  assert.deepEqual(
    normalizeZoneRecord({
      _id: 'legacy-zone-1',
      name: '防爆柜',
      order: 8
    }),
    {
      _id: 'legacy-zone-1',
      zone_key: 'legacy-zone-1',
      name: '防爆柜',
      scope: 'global',
      is_builtin: false,
      status: 'active',
      sort_order: 8
    }
  );
});

test('category filtering keeps builtins plus active global zones in stable order', () => {
  const filtered = filterZoneRecordsByCategory(sortZoneRecords([
    { zone_key: 'global:temp', name: '公共暂存', scope: 'global', status: 'active', sort_order: 30 },
    { zone_key: 'builtin:film:research-warehouse-01', name: '研发仓1', scope: 'film', status: 'active', sort_order: 10 },
    { zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01', scope: 'chemical', status: 'active', sort_order: 10 },
    { zone_key: 'global:disabled', name: '旧库位', scope: 'global', status: 'disabled', sort_order: 40 }
  ]), 'chemical');

  assert.deepEqual(filtered.map(item => item.zone_key), [
    'builtin:chemical:safe-cabinet-01',
    'global:temp'
  ]);
});

test('zone sorting collapses duplicated zone keys left by concurrent builtin initialization', () => {
  const sorted = sortZoneRecords([
    {
      _id: 'auto-doc-1',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'auto-doc-2',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'auto-doc-3',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      name: '防爆柜02',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    }
  ]);

  assert.deepEqual(sorted.map(item => item.zone_key), [
    'builtin:chemical:safe-cabinet-01',
    'builtin:chemical:safe-cabinet-02'
  ]);
});

test('zone sorting collapses duplicated builtin names even when legacy keys differ', () => {
  const sorted = sortZoneRecords([
    {
      _id: 'legacy-safe-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'builtin_chemical_safe-cabinet-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'auto-doc-3',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      name: '防爆柜02',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    }
  ]);

  assert.deepEqual(
    sorted.map(item => ({ zone_key: item.zone_key, name: item.name })),
    [
      { zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' },
      { zone_key: 'builtin:chemical:safe-cabinet-02', name: '防爆柜02' }
    ]
  );
});

test('inventory location payload stores zone reference and resolves renamed display text', () => {
  const zoneMap = buildZoneMap([
    { zone_key: 'builtin:film:research-warehouse-01', name: '研发仓1' }
  ]);

  assert.deepEqual(
    buildInventoryLocationPayload({
      zoneKey: 'builtin:film:research-warehouse-01',
      locationDetail: '机台-A'
    }, zoneMap),
    {
      zone_key: 'builtin:film:research-warehouse-01',
      location_detail: '机台-A',
      location_text: '研发仓1 | 机台-A',
      location: '研发仓1 | 机台-A'
    }
  );

  const renamedZoneMap = buildZoneMap([
    { zone_key: 'builtin:film:research-warehouse-01', name: '研发一仓' }
  ]);

  assert.equal(
    resolveInventoryLocationText({
      zone_key: 'builtin:film:research-warehouse-01',
      location_detail: '机台-A',
      location: '研发仓1 | 机台-A'
    }, renamedZoneMap),
    '研发一仓 | 机台-A'
  );
  assert.equal(composeLocationText('研发一仓', '机台-A'), '研发一仓 | 机台-A');
});

test('inventory location payload stores detail key and follows renamed detail display text', () => {
  const zoneMap = buildZoneMap([
    { zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' }
  ]);
  const detailMapByZone = buildLocationDetailMapByZone([
    {
      zone_key: 'builtin:chemical:safe-cabinet-01',
      detail_key: 'builtin:chemical:safe-cabinet-01:F1',
      name: 'F1',
      status: 'active',
      sort_order: 10
    }
  ]);

  assert.deepEqual(
    buildInventoryLocationPayload({
      zoneKey: 'builtin:chemical:safe-cabinet-01',
      locationDetailKey: 'builtin:chemical:safe-cabinet-01:F1'
    }, zoneMap, detailMapByZone),
    {
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_detail_key: 'builtin:chemical:safe-cabinet-01:F1',
      location_detail: 'F1',
      location_text: '防爆柜01 | F1',
      location: '防爆柜01 | F1'
    }
  );

  const renamedDetailMapByZone = buildLocationDetailMapByZone([
    {
      zone_key: 'builtin:chemical:safe-cabinet-01',
      detail_key: 'builtin:chemical:safe-cabinet-01:F1',
      name: 'A',
      status: 'active',
      sort_order: 10
    }
  ]);

  assert.equal(
    resolveInventoryLocationText({
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location_detail_key: 'builtin:chemical:safe-cabinet-01:F1',
      location_detail: 'F1',
      location: '防爆柜01 | F1'
    }, zoneMap, renamedDetailMapByZone),
    '防爆柜01 | A'
  );

  assert.throws(
    () => buildInventoryLocationPayload({
      zoneKey: 'builtin:chemical:safe-cabinet-01',
      locationDetail: ''
    }, zoneMap, detailMapByZone),
    /请选择详细坐标/
  );
});

test('ensureBuiltinZones preserves reordered builtin sort order already stored in database', async () => {
  const db = createMockDb([
    {
      _id: 'zone-safe-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    },
    {
      _id: 'zone-safe-02',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      name: '防爆柜02',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    }
  ]);

  const synced = await ensureBuiltinZones(db);
  const chemicalBuiltins = sortZoneRecords(synced)
    .filter(item => item.scope === 'chemical' && item.is_builtin)
    .slice(0, 2);

  assert.deepEqual(
    chemicalBuiltins.map(item => ({
      zone_key: item.zone_key,
      sort_order: item.sort_order
    })),
    [
      { zone_key: 'builtin:chemical:safe-cabinet-02', sort_order: 10 },
      { zone_key: 'builtin:chemical:safe-cabinet-01', sort_order: 20 }
    ]
  );
});

test('ensureBuiltinZones preserves admin renamed builtin zone names', async () => {
  const db = createMockDb([
    {
      _id: 'zone-safe-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '一号防爆柜',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    },
    {
      _id: 'zone-safe-02',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      name: '二号防爆柜',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    }
  ]);

  const synced = await ensureBuiltinZones(db);
  const syncedMap = new Map(synced.map(item => [item.zone_key, item]));

  assert.equal(syncedMap.get('builtin:chemical:safe-cabinet-01').name, '一号防爆柜');
  assert.equal(syncedMap.get('builtin:chemical:safe-cabinet-01').sort_order, 20);
  assert.equal(syncedMap.get('builtin:chemical:safe-cabinet-02').name, '二号防爆柜');
  assert.equal(syncedMap.get('builtin:chemical:safe-cabinet-02').sort_order, 10);
});

test('ensureBuiltinZones initializes clean default zone set when collection is empty', async () => {
  const db = createMockDb([]);

  const synced = sortZoneRecords(await ensureBuiltinZones(db));
  const builtins = synced.filter(item => item.is_builtin);

  assert.deepEqual(
    builtins.map(item => ({
      zone_key: item.zone_key,
      name: item.name,
      scope: item.scope
    })),
    [
      { zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-02', name: '防爆柜02', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-03', name: '防爆柜03', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-04', name: '防爆柜04', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-05', name: '防爆柜05', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-06', name: '防爆柜06', scope: 'chemical' },
      { zone_key: 'builtin:chemical:safe-cabinet-07', name: '防爆柜07', scope: 'chemical' },
      { zone_key: 'builtin:film:research-warehouse-01', name: '研发仓1', scope: 'film' },
      { zone_key: 'builtin:film:research-warehouse-02', name: '研发仓2', scope: 'film' },
      { zone_key: 'builtin:film:research-warehouse-03', name: '研发仓3', scope: 'film' },
      { zone_key: 'builtin:film:pilot-line', name: '实验线', scope: 'film' }
    ]
  );
});

test('ensureBuiltinZones stays idempotent when empty collection initialization runs concurrently', async () => {
  const db = createMockDb([]);

  await Promise.all([
    ensureBuiltinZones(db),
    ensureBuiltinZones(db)
  ]);

  const storedBuiltinKeys = db.state.records
    .filter(item => item.is_builtin)
    .map(item => item.zone_key);

  assert.equal(storedBuiltinKeys.length, BUILTIN_ZONE_SEEDS.length);
  assert.equal(new Set(storedBuiltinKeys).size, BUILTIN_ZONE_SEEDS.length);
});

test('ensureBuiltinZones removes duplicated builtin names left by legacy initialization', async () => {
  const db = createMockDb([
    {
      _id: 'legacy-safe-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'builtin_chemical_safe-cabinet-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    }
  ]);

  await ensureBuiltinZones(db);
  const sameNameRecords = db.state.records.filter(item => item.name === '防爆柜01');

  assert.equal(sameNameRecords.length, 1);
  assert.equal(sameNameRecords[0].zone_key, 'builtin:chemical:safe-cabinet-01');
});

test('ensureBuiltinZones recreates missing builtin zones while preserving disabled builtins', async () => {
  const db = createMockDb([
    {
      _id: 'builtin_chemical_safe-cabinet-01',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      name: '防爆柜01',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 10
    },
    {
      _id: 'builtin_chemical_safe-cabinet-02',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      name: '防爆柜02',
      scope: 'chemical',
      is_builtin: true,
      status: 'disabled',
      sort_order: 20
    }
  ]);

  await ensureBuiltinZones(db);
  const storedBuiltins = sortZoneRecords(db.state.records).filter(item => item.is_builtin);
  const disabledSafeCabinet = storedBuiltins.find(item => item.zone_key === 'builtin:chemical:safe-cabinet-02');

  assert.deepEqual(
    storedBuiltins.map(item => item.zone_key),
    BUILTIN_ZONE_SEEDS.map(item => item.zone_key)
  );
  assert.equal(disabledSafeCabinet.status, 'disabled');
});
