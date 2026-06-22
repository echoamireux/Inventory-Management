const BUILTIN_ZONE_SEEDS = [
  {
    zone_key: 'builtin:chemical:safe-cabinet-01',
    name: '防爆柜01',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 10
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-02',
    name: '防爆柜02',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 20
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-03',
    name: '防爆柜03',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 30
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-04',
    name: '防爆柜04',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 40
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-05',
    name: '防爆柜05',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 50
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-06',
    name: '防爆柜06',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 60
  },
  {
    zone_key: 'builtin:chemical:safe-cabinet-07',
    name: '防爆柜07',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 70
  },
  {
    zone_key: 'builtin:film:research-warehouse-01',
    name: '研发仓1',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 110
  },
  {
    zone_key: 'builtin:film:research-warehouse-02',
    name: '研发仓2',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 120
  },
  {
    zone_key: 'builtin:film:research-warehouse-03',
    name: '研发仓3',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 130
  },
  {
    zone_key: 'builtin:film:pilot-line',
    name: '实验线',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 140
  }
];

const BUILTIN_ZONE_KEY_SET = new Set(BUILTIN_ZONE_SEEDS.map(item => item.zone_key));

function normalizeScope(scope) {
  return scope === 'chemical' || scope === 'film' ? scope : 'global';
}

function normalizeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function normalizeZoneName(name) {
  return String(name || '').trim();
}

function composeLocationText(zoneName, locationDetail) {
  const safeZoneName = String(zoneName || '').trim();
  const safeDetail = String(locationDetail || '').trim();

  if (!safeZoneName) {
    return '';
  }

  return safeDetail ? `${safeZoneName} | ${safeDetail}` : safeZoneName;
}

function normalizeZoneRecord(record) {
  const normalized = record || {};
  const zoneKey = String(normalized.zone_key || normalized._id || '').trim();

  return {
    _id: normalized._id,
    zone_key: zoneKey,
    name: normalizeZoneName(normalized.name),
    scope: normalizeScope(normalized.scope),
    is_builtin: !!normalized.is_builtin,
    status: normalizeStatus(normalized.status),
    sort_order: Number(
      normalized.sort_order !== undefined ? normalized.sort_order : normalized.order
    ) || 0
  };
}

function buildBuiltinZoneDocId(zoneKey) {
  return String(zoneKey || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

function compareZoneRecordOrder(left, right) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order;
  }

  const keyCompare = String(left.zone_key).localeCompare(String(right.zone_key));
  if (keyCompare !== 0) {
    return keyCompare;
  }

  return String(left._id || '').localeCompare(String(right._id || ''));
}

function chooseBuiltinZoneKeeper(records) {
  const sorted = records.slice().sort((left, right) => {
    const leftExpectedId = left._id === buildBuiltinZoneDocId(left.zone_key) ? 0 : 1;
    const rightExpectedId = right._id === buildBuiltinZoneDocId(right.zone_key) ? 0 : 1;
    if (leftExpectedId !== rightExpectedId) {
      return leftExpectedId - rightExpectedId;
    }

    return compareZoneRecordOrder(left, right);
  });

  return sorted[0];
}

async function removeDuplicateBuiltinZoneRecords(collection, records) {
  const groups = new Map();
  records
    .map(normalizeZoneRecord)
    .filter(item => item._id && BUILTIN_ZONE_KEY_SET.has(item.zone_key))
    .forEach((item) => {
      if (!groups.has(item.zone_key)) {
        groups.set(item.zone_key, []);
      }
      groups.get(item.zone_key).push(item);
    });

  let removed = false;
  const duplicateGroups = Array.from(groups.values()).filter(group => group.length > 1);
  for (let i = 0; i < duplicateGroups.length; i += 1) {
    const group = duplicateGroups[i];
    const keeper = chooseBuiltinZoneKeeper(group);
    const duplicates = group.filter(item => item._id !== keeper._id);
    for (let j = 0; j < duplicates.length; j += 1) {
      await collection.doc(duplicates[j]._id).remove();
      removed = true;
    }
  }

  return removed;
}

async function loadAllZoneRecords(db, pageSize = 100) {
  const collection = db.collection('warehouse_zones');
  let skip = 0;
  let allRecords = [];

  while (true) {
    let response;
    try {
      response = await collection.skip(skip).limit(pageSize).get();
    } catch (error) {
      if (skip === 0) {
        return [];
      }
      throw error;
    }

    const batch = (response && response.data) || [];
    allRecords = allRecords.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return allRecords;
}

async function ensureBuiltinZones(db) {
  const collection = db.collection('warehouse_zones');
  let existingRecords = await loadAllZoneRecords(db);
  const removedDuplicates = await removeDuplicateBuiltinZoneRecords(collection, existingRecords);
  if (removedDuplicates) {
    existingRecords = await loadAllZoneRecords(db);
  }

  const normalizedRecords = existingRecords.map(normalizeZoneRecord);
  const byKey = new Map(normalizedRecords.map(item => [item.zone_key, item]));
  const byName = new Map(normalizedRecords.map(item => [item.name, item]));

  for (let i = 0; i < BUILTIN_ZONE_SEEDS.length; i += 1) {
    const seed = BUILTIN_ZONE_SEEDS[i];
    const existingByKey = byKey.get(seed.zone_key);
    if (existingByKey) {
      const needsMetadataRefresh =
        existingByKey.scope !== seed.scope ||
        existingByKey.is_builtin !== true;

      if (needsMetadataRefresh) {
        await collection.doc(existingByKey._id).update({
          data: {
            scope: seed.scope,
            is_builtin: true,
            updated_at: db.serverDate()
          }
        });
      }
      continue;
    }

    const legacyByName = byName.get(seed.name);
    if (legacyByName && legacyByName._id) {
      await collection.doc(legacyByName._id).update({
        data: {
          zone_key: seed.zone_key,
          scope: seed.scope,
          is_builtin: true,
          updated_at: db.serverDate()
        }
      });
      continue;
    }

    await collection.doc(buildBuiltinZoneDocId(seed.zone_key)).set({
      data: {
        zone_key: seed.zone_key,
        name: seed.name,
        scope: seed.scope,
        is_builtin: true,
        status: 'active',
        sort_order: seed.sort_order,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  }

  return loadAllZoneRecords(db);
}

function sortZoneRecords(records) {
  const byKey = new Map();
  (records || [])
    .map(normalizeZoneRecord)
    .filter(item => item.zone_key && item.name)
    .sort(compareZoneRecordOrder)
    .forEach((item) => {
      if (!byKey.has(item.zone_key)) {
        byKey.set(item.zone_key, item);
      }
    });

  return Array.from(byKey.values());
}

function filterZoneRecordsByCategory(records, category, options = {}) {
  const normalizedCategory = category === 'film' ? 'film' : 'chemical';
  const includeDisabled = !!options.includeDisabled;

  return (records || []).filter((item) => {
    const zone = normalizeZoneRecord(item);
    if (!includeDisabled && zone.status !== 'active') {
      return false;
    }

    return zone.scope === normalizedCategory || zone.scope === 'global';
  });
}

function buildZoneMap(records) {
  return new Map(
    (records || [])
      .map(normalizeZoneRecord)
      .filter(item => item.zone_key)
      .map(item => [item.zone_key, item])
  );
}

function findZoneRecordByName(records, name, excludeZoneKey = '') {
  const normalizedName = normalizeZoneName(name);
  const excludedKey = String(excludeZoneKey || '').trim();

  return (records || [])
    .map(normalizeZoneRecord)
    .find(item => item.name === normalizedName && item.zone_key !== excludedKey);
}

function buildInventoryLocationPayload(selection, zoneMap) {
  const zoneKey = String((selection && selection.zoneKey) || '').trim();
  const locationDetail = String((selection && selection.locationDetail) || '').trim();
  const zone = zoneMap && zoneMap.get(zoneKey);

  if (!zone || !zone.name) {
    throw new Error(`无效库区: ${zoneKey || '未选择'}`);
  }

  const locationText = composeLocationText(zone.name, locationDetail);

  return {
    zone_key: zoneKey,
    location_detail: locationDetail,
    location_text: locationText,
    location: locationText
  };
}

function resolveInventoryLocationText(item, zoneMap) {
  const zoneKey = String((item && item.zone_key) || '').trim();
  if (zoneKey && zoneMap && zoneMap.has(zoneKey)) {
    const zone = zoneMap.get(zoneKey);
    return composeLocationText(zone.name, item && item.location_detail);
  }

  return String((item && item.location_text) || '').trim();
}

module.exports = {
  BUILTIN_ZONE_SEEDS,
  normalizeScope,
  normalizeStatus,
  normalizeZoneName,
  composeLocationText,
  normalizeZoneRecord,
  loadAllZoneRecords,
  ensureBuiltinZones,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  findZoneRecordByName,
  buildInventoryLocationPayload,
  resolveInventoryLocationText
};
