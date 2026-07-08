function buildLocationZoneActions(zones, canManageZones) {
  return (zones || []).map((zone) => ({ name: getZoneDisplayName(zone) }));
}

function mergeLocationZones(category, defaultZonesByCategory, sharedZones) {
  const categoryDefaults = (defaultZonesByCategory && defaultZonesByCategory[category]) || [];
  const merged = [...categoryDefaults];
  const seen = new Set(categoryDefaults);

  (sharedZones || []).forEach((name) => {
    if (!seen.has(name)) {
      seen.add(name);
      merged.push(name);
    }
  });

  return merged;
}

function buildLocationZoneState(category, defaultZonesByCategory, sharedZones, canManageZones) {
  const zones = mergeLocationZones(category, defaultZonesByCategory, sharedZones);

  return {
    zones,
    actions: buildLocationZoneActions(zones, canManageZones)
  };
}

function getZoneDisplayName(zone) {
  if (zone && typeof zone === 'object') {
    return String(zone.name || '').trim();
  }

  return String(zone || '').trim();
}

function composeLocation(zone, detail) {
  const locationZone = String(zone || '').trim();
  const locationDetail = String(detail || '').trim();

  if (!locationZone) {
    return '';
  }

  return locationDetail ? `${locationZone} | ${locationDetail}` : locationZone;
}

function buildZoneMap(zones) {
  return new Map(
    (zones || [])
      .filter(item => item && item.zone_key)
      .map(item => [item.zone_key, item])
  );
}

function normalizeLocationDetailRecord(record) {
  return {
    zone_key: String((record && record.zone_key) || '').trim(),
    detail_key: String((record && (record.detail_key || record._id)) || '').trim(),
    name: String((record && record.name) || '').trim(),
    status: (record && record.status) === 'disabled' ? 'disabled' : 'active',
    sort_order: Number(record && (record.sort_order !== undefined ? record.sort_order : record.order)) || 0
  };
}

function buildLocationDetailMapByZone(records, options = {}) {
  const includeDisabled = !!options.includeDisabled;
  const byZone = new Map();

  (records || [])
    .map(normalizeLocationDetailRecord)
    .filter(item => item.zone_key && item.detail_key && item.name)
    .filter(item => includeDisabled || item.status === 'active')
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }
      return left.detail_key.localeCompare(right.detail_key);
    })
    .forEach((item) => {
      if (!byZone.has(item.zone_key)) {
        byZone.set(item.zone_key, {
          list: [],
          byKey: new Map(),
          byName: new Map()
        });
      }

      const group = byZone.get(item.zone_key);
      if (group.byKey.has(item.detail_key)) {
        return;
      }

      group.list.push(item);
      group.byKey.set(item.detail_key, item);
      if (!group.byName.has(item.name)) {
        group.byName.set(item.name, item);
      }
    });

  return byZone;
}

function buildLocationDetailActions(zoneKey, detailMapByZone) {
  const normalizedZoneKey = String(zoneKey || '').trim();
  const detailGroup = detailMapByZone && detailMapByZone.get(normalizedZoneKey);
  return detailGroup && detailGroup.list
    ? detailGroup.list.map(item => ({ name: item.name, detail_key: item.detail_key }))
    : [];
}

function hasManagedLocationDetails(zoneKey, detailMapByZone) {
  return buildLocationDetailActions(zoneKey, detailMapByZone).length > 0;
}

function buildLocationPayload(zoneKey, detail, zoneMap, detailMapByZone, detailKey) {
  const normalizedZoneKey = String(zoneKey || '').trim();
  const locationDetail = String(detail || '').trim();
  const locationDetailKey = String(detailKey || '').trim();
  const zone = zoneMap && zoneMap.get(normalizedZoneKey);
  const zoneName = getZoneDisplayName(zone);
  const detailGroup = detailMapByZone && detailMapByZone.get(normalizedZoneKey);
  const hasManagedDetails = !!(detailGroup && detailGroup.list && detailGroup.list.length);
  let resolvedDetail = locationDetail;
  let resolvedDetailKey = '';

  if (hasManagedDetails) {
    let detailRecord;
    if (locationDetailKey) {
      detailRecord = detailGroup.byKey && detailGroup.byKey.get(locationDetailKey);
    } else if (locationDetail) {
      detailRecord = detailGroup.byName && detailGroup.byName.get(locationDetail);
    }

    if (!detailRecord) {
      throw new Error(locationDetailKey || locationDetail ? '无效详细坐标' : '请选择详细坐标');
    }

    resolvedDetail = detailRecord.name;
    resolvedDetailKey = detailRecord.detail_key;
  }

  const locationText = composeLocation(zoneName, resolvedDetail);
  const payload = {
    zone_key: normalizedZoneKey,
    location_detail: resolvedDetail,
    location_text: locationText,
    location: locationText
  };

  if (resolvedDetailKey) {
    payload.location_detail_key = resolvedDetailKey;
  }

  return payload;
}

function resolveInventoryLocation(item, zoneMap, detailMapByZone) {
  const zoneKey = String((item && item.zone_key) || '').trim();
  if (zoneKey && zoneMap && zoneMap.has(zoneKey)) {
    const detailKey = String((item && item.location_detail_key) || '').trim();
    const detailGroup = detailMapByZone && detailMapByZone.get(zoneKey);
    const detailRecord = detailKey && detailGroup && detailGroup.byKey && detailGroup.byKey.get(detailKey);
    const detailName = detailRecord ? detailRecord.name : (item && item.location_detail);
    return composeLocation(getZoneDisplayName(zoneMap.get(zoneKey)), detailName);
  }

  return String((item && item.location_text) || '').trim();
}

function extractLocationSelection(item, zoneMap, detailMapByZone) {
  const zoneKey = String((item && item.zone_key) || '').trim();

  if (zoneKey && zoneMap && zoneMap.has(zoneKey)) {
    const detailKey = String((item && item.location_detail_key) || '').trim();
    const detailGroup = detailMapByZone && detailMapByZone.get(zoneKey);
    const detailRecord = detailKey && detailGroup && detailGroup.byKey && detailGroup.byKey.get(detailKey);

    return {
      zone_key: zoneKey,
      location_zone: getZoneDisplayName(zoneMap.get(zoneKey)),
      location_detail_key: detailRecord ? detailRecord.detail_key : detailKey,
      location_detail: detailRecord
        ? detailRecord.name
        : String((item && item.location_detail) || '').trim()
    };
  }

  return {
    zone_key: '',
    location_zone: '',
    location_detail_key: '',
    location_detail: ''
  };
}

module.exports = {
  buildLocationZoneActions,
  mergeLocationZones,
  buildLocationZoneState,
  composeLocation,
  getZoneDisplayName,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildLocationDetailActions,
  hasManagedLocationDetails,
  buildLocationPayload,
  resolveInventoryLocation,
  extractLocationSelection
};
