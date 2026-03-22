const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_ZONE_SEEDS,
  normalizeZoneRecord,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
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

test('builtin zone seeds cover both chemical and film defaults', () => {
  const zoneKeys = BUILTIN_ZONE_SEEDS.map(item => item.zone_key);

  assert.deepEqual(zoneKeys, [
    'builtin:chemical:lab1',
    'builtin:chemical:lab2',
    'builtin:chemical:lab3',
    'builtin:chemical:store-room',
    'builtin:film:rnd1',
    'builtin:film:rnd2',
    'builtin:film:line'
  ]);
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
    { zone_key: 'builtin:film:rnd1', name: '研发仓1', scope: 'film', status: 'active', sort_order: 10 },
    { zone_key: 'builtin:chemical:lab1', name: '实验室1', scope: 'chemical', status: 'active', sort_order: 10 },
    { zone_key: 'global:disabled', name: '旧库位', scope: 'global', status: 'disabled', sort_order: 40 }
  ]), 'chemical');

  assert.deepEqual(filtered.map(item => item.zone_key), [
    'builtin:chemical:lab1',
    'global:temp'
  ]);
});

test('inventory location payload stores zone reference and resolves renamed display text', () => {
  const zoneMap = buildZoneMap([
    { zone_key: 'builtin:film:rnd1', name: '研发仓1' }
  ]);

  assert.deepEqual(
    buildInventoryLocationPayload({
      zoneKey: 'builtin:film:rnd1',
      locationDetail: '机台-A'
    }, zoneMap),
    {
      zone_key: 'builtin:film:rnd1',
      location_detail: '机台-A',
      location_text: '研发仓1 | 机台-A',
      location: '研发仓1 | 机台-A'
    }
  );

  const renamedZoneMap = buildZoneMap([
    { zone_key: 'builtin:film:rnd1', name: '研发一仓' }
  ]);

  assert.equal(
    resolveInventoryLocationText({
      zone_key: 'builtin:film:rnd1',
      location_detail: '机台-A',
      location: '研发仓1 | 机台-A'
    }, renamedZoneMap),
    '研发一仓 | 机台-A'
  );
  assert.equal(composeLocationText('研发一仓', '机台-A'), '研发一仓 | 机台-A');
});

test('ensureBuiltinZones preserves reordered builtin sort order already stored in database', async () => {
  const db = createMockDb([
    {
      _id: 'zone-lab1',
      zone_key: 'builtin:chemical:lab1',
      name: '实验室1',
      scope: 'chemical',
      is_builtin: true,
      status: 'active',
      sort_order: 20
    },
    {
      _id: 'zone-lab2',
      zone_key: 'builtin:chemical:lab2',
      name: '实验室2',
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
      { zone_key: 'builtin:chemical:lab2', sort_order: 10 },
      { zone_key: 'builtin:chemical:lab1', sort_order: 20 }
    ]
  );
});
