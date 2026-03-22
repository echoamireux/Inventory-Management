const BUILTIN_ZONE_SEEDS = [
  {
    zone_key: 'builtin:chemical:lab1',
    name: '实验室1',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 10
  },
  {
    zone_key: 'builtin:chemical:lab2',
    name: '实验室2',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 20
  },
  {
    zone_key: 'builtin:chemical:lab3',
    name: '实验室3',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 30
  },
  {
    zone_key: 'builtin:chemical:store-room',
    name: '物料间',
    scope: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 40
  },
  {
    zone_key: 'builtin:film:rnd1',
    name: '研发仓1',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 110
  },
  {
    zone_key: 'builtin:film:rnd2',
    name: '研发仓2',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 120
  },
  {
    zone_key: 'builtin:film:line',
    name: '实验线',
    scope: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 130
  }
];

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
  const existingRecords = await loadAllZoneRecords(db);
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

    await collection.add({
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
  return (records || [])
    .map(normalizeZoneRecord)
    .filter(item => item.zone_key && item.name)
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }
      return String(left.zone_key).localeCompare(String(right.zone_key));
    });
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
