const cloud = require('wx-server-sdk');
const { assertAdminAccess } = require('./auth');
const {
  normalizeZoneName,
  normalizeStatus,
  ensureBuiltinZones,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  findZoneRecordByName
} = require('./warehouse-zones');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function buildCustomZoneKey() {
  return `custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function getOperator(openid) {
  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return userRes.data && userRes.data[0];
}

async function listZones(event) {
  const allZones = await ensureBuiltinZones(db);
  const normalized = sortZoneRecords(allZones);
  const filtered = event && event.category
    ? filterZoneRecordsByCategory(normalized, event.category, {
      includeDisabled: !!event.includeDisabled
    })
    : normalized.filter(item => event && event.includeDisabled ? true : item.status === 'active');

  return {
    success: true,
    list: filtered
  };
}

async function createZone(name, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可新建库存区域');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedName = normalizeZoneName(name);
  if (!normalizedName) {
    return { success: false, msg: '请输入区域名称' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const existing = findZoneRecordByName(existingZones, normalizedName);
  if (existing) {
    if (existing.status === 'disabled' && existing._id) {
      await db.collection('warehouse_zones').doc(existing._id).update({
        data: {
          status: 'active',
          updated_at: db.serverDate()
        }
      });
    }

    return {
      success: true,
      msg: '区域已存在',
      zone_key: existing.zone_key,
      id: existing._id
    };
  }

  const activeZones = existingZones.filter(item => item.status === 'active');
  const maxSortOrder = activeZones.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0);
  const zoneKey = buildCustomZoneKey();

  const res = await db.collection('warehouse_zones').add({
    data: {
      zone_key: zoneKey,
      name: normalizedName,
      scope: 'global',
      is_builtin: false,
      status: 'active',
      sort_order: maxSortOrder + 10,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: '创建成功',
    zone_key: zoneKey,
    id: res._id
  };
}

async function renameExistingZone(zoneKey, name, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可重命名库存区域');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedName = normalizeZoneName(name);
  if (!normalizedName) {
    return { success: false, msg: '请输入区域名称' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const currentZone = existingZones.find(item => item.zone_key === zoneKey);
  if (!currentZone || !currentZone._id) {
    return { success: false, msg: '库存区域不存在' };
  }

  const duplicate = findZoneRecordByName(existingZones, normalizedName, zoneKey);
  if (duplicate) {
    return { success: false, msg: '已存在同名库存区域' };
  }

  await db.collection('warehouse_zones').doc(currentZone._id).update({
    data: {
      name: normalizedName,
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: '重命名成功'
  };
}

async function setExistingZoneStatus(zoneKey, status, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可启用或停用库存区域');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalized = normalizeStatus(status);
  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const currentZone = existingZones.find(item => item.zone_key === zoneKey);
  if (!currentZone || !currentZone._id) {
    return { success: false, msg: '库存区域不存在' };
  }

  await db.collection('warehouse_zones').doc(currentZone._id).update({
    data: {
      status: normalized,
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    msg: normalized === 'active' ? '已启用' : '已停用'
  };
}

async function reorderExistingZones(zoneKeys, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminAccess(operator, '仅管理员可调整库存区域顺序');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  if (!Array.isArray(zoneKeys) || zoneKeys.length === 0) {
    return { success: false, msg: '缺少排序数据' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const zoneMap = new Map(existingZones.map(item => [item.zone_key, item]));
  const validKeys = zoneKeys.filter(key => zoneMap.has(String(key || '').trim()));
  if (validKeys.length === 0) {
    return { success: false, msg: '未找到可排序的库存区域' };
  }

  for (let index = 0; index < validKeys.length; index += 1) {
    const zone = zoneMap.get(validKeys[index]);
    await db.collection('warehouse_zones').doc(zone._id).update({
      data: {
        sort_order: (index + 1) * 10,
        updated_at: db.serverDate()
      }
    });
  }

  return {
    success: true,
    msg: '排序已更新'
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : (event && event.name ? 'create' : 'list');

  try {
    if (action === 'list') {
      return await listZones(event || {});
    }
    if (action === 'create') {
      return await createZone(event && event.name, OPENID);
    }
    if (action === 'rename') {
      return await renameExistingZone(String(event && event.zone_key || '').trim(), event && event.name, OPENID);
    }
    if (action === 'setStatus') {
      return await setExistingZoneStatus(String(event && event.zone_key || '').trim(), event && event.status, OPENID);
    }
    if (action === 'reorder') {
      return await reorderExistingZones(event && event.zone_keys, OPENID);
    }

    return {
      success: false,
      msg: `不支持的操作: ${action}`
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
