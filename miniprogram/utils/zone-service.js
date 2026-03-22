const LEGACY_ZONE_FUNCTION_HINT = '当前云函数版本过旧，请部署最新版 addWarehouseZone';

function isLegacyZoneListError(data, result) {
  if (!data || data.action !== 'list') {
    return false;
  }

  const message = String((result && result.msg) || '').trim().toLowerCase();
  if (!message) {
    return false;
  }

  return message.includes('zone name is required') || message.includes('请输入区域名称');
}

function normalizeZoneFunctionResult(data, res) {
  const result = res && res.result ? res.result : {};

  if (isLegacyZoneListError(data, result)) {
    throw new Error(LEGACY_ZONE_FUNCTION_HINT);
  }

  if (!result.success) {
    throw new Error(result.msg || '库区操作失败');
  }

  if (data && data.action === 'list' && !Array.isArray(result.list)) {
    throw new Error(LEGACY_ZONE_FUNCTION_HINT);
  }

  return result;
}

function callZoneFunction(data) {
  return wx.cloud.callFunction({
    name: 'addWarehouseZone',
    data
  }).then((res) => normalizeZoneFunctionResult(data, res));
}

function listZoneRecords(category, includeDisabled = false) {
  return callZoneFunction({
    action: 'list',
    category,
    includeDisabled
  }).then(result => result.list || []);
}

function createZone(name) {
  return callZoneFunction({
    action: 'create',
    name
  });
}

function renameZone(zoneKey, name) {
  return callZoneFunction({
    action: 'rename',
    zone_key: zoneKey,
    name
  });
}

function setZoneStatus(zoneKey, status) {
  return callZoneFunction({
    action: 'setStatus',
    zone_key: zoneKey,
    status
  });
}

function reorderZones(zoneKeys) {
  return callZoneFunction({
    action: 'reorder',
    zone_keys: zoneKeys
  });
}

module.exports = {
  LEGACY_ZONE_FUNCTION_HINT,
  normalizeZoneFunctionResult,
  listZoneRecords,
  createZone,
  renameZone,
  setZoneStatus,
  reorderZones
};
