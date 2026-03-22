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

function buildLocationPayload(zoneKey, detail, zoneMap) {
  const normalizedZoneKey = String(zoneKey || '').trim();
  const locationDetail = String(detail || '').trim();
  const zone = zoneMap && zoneMap.get(normalizedZoneKey);
  const zoneName = getZoneDisplayName(zone);
  const locationText = composeLocation(zoneName, locationDetail);

  return {
    zone_key: normalizedZoneKey,
    location_detail: locationDetail,
    location_text: locationText,
    location: locationText
  };
}

function resolveInventoryLocation(item, zoneMap) {
  const zoneKey = String((item && item.zone_key) || '').trim();
  if (zoneKey && zoneMap && zoneMap.has(zoneKey)) {
    return composeLocation(getZoneDisplayName(zoneMap.get(zoneKey)), item && item.location_detail);
  }

  return String((item && item.location_text) || '').trim();
}

function extractLocationSelection(item, zoneMap) {
  const zoneKey = String((item && item.zone_key) || '').trim();

  if (zoneKey && zoneMap && zoneMap.has(zoneKey)) {
    return {
      zone_key: zoneKey,
      location_zone: getZoneDisplayName(zoneMap.get(zoneKey)),
      location_detail: String((item && item.location_detail) || '').trim()
    };
  }

  return {
    zone_key: '',
    location_zone: '',
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
  buildLocationPayload,
  resolveInventoryLocation,
  extractLocationSelection
};
