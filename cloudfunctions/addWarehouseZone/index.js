const cloud = require('wx-server-sdk');
const {
  assertActiveUserAccess,
  assertAdminMutationAccess,
  isAdminRole
} = require('./auth');
const {
  normalizeZoneName,
  normalizeLocationDetailName,
  normalizeScope,
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  sortLocationDetailRecords,
  filterZoneRecordsByCategory,
  findZoneRecordByName,
  findLocationDetailRecordByName
} = require('./warehouse-zones');
const { writeAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function parseMutationStatus(status) {
  const normalized = String(status || '').trim();
  return normalized === 'active' || normalized === 'disabled' ? normalized : '';
}

function buildCustomZoneKey() {
  return `custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildCustomDetailKey(zoneKey) {
  return `${String(zoneKey || '').trim()}:custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function getOperator(openid) {
  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return userRes.data && userRes.data[0];
}

async function writeWarehouseAudit(transaction, action, operator, openid, record = {}, detail = {}) {
  const isDetail = !!record.detail_key;
  await writeAuditEvent(transaction, db, {
    domain: 'warehouse',
    action,
    operator: Object.assign({}, operator || {}, { _openid: openid }),
    target: {
      type: isDetail ? 'warehouse_location_detail' : 'warehouse_zone',
      id: record.detail_key || record.zone_key || record._id || '',
      label: record.name || record.detail_key || record.zone_key || ''
    },
    after: record,
    detail
  });
}

async function listZones(event, openid) {
  const operator = await getOperator(openid);
  const activeResult = assertActiveUserAccess(operator, '仅已激活用户可查看库存区域');
  if (!activeResult.ok) {
    return { success: false, msg: activeResult.msg };
  }

  const includeDisabled = !!(event && event.includeDisabled && isAdminRole(operator.role));
  const allZones = await ensureBuiltinZones(db);
  const allDetails = await ensureBuiltinLocationDetails(db, allZones);
  const normalized = sortZoneRecords(allZones);
  const filtered = event && event.category
    ? filterZoneRecordsByCategory(normalized, event.category, {
      includeDisabled
    })
    : normalized.filter(item => includeDisabled ? true : item.status === 'active');
  const visibleZoneKeys = new Set(filtered.map(item => item.zone_key));
  const detailList = sortLocationDetailRecords(allDetails)
    .filter(item => visibleZoneKeys.has(item.zone_key))
    .filter(item => includeDisabled ? true : item.status === 'active');

  return {
    success: true,
    list: filtered,
    detail_list: detailList
  };
}

async function createZone(name, scope, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可新建库存区域');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedName = normalizeZoneName(name);
  const normalizedScope = normalizeScope(scope);
  if (!normalizedName) {
    return { success: false, msg: '请输入区域名称' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const existing = findZoneRecordByName(existingZones, normalizedName);
  if (existing) {
    if (existing.status === 'disabled' && existing._id) {
      await db.runTransaction(async transaction => {
        await transaction.collection('warehouse_zones').doc(existing._id).update({
          data: {
            scope: normalizedScope,
            status: 'active',
            updated_at: db.serverDate()
          }
        });
        await writeWarehouseAudit(transaction, 'status', operator, openid, Object.assign({}, existing, {
          scope: normalizedScope,
          status: 'active'
        }), {
          previous_status: existing.status,
          next_status: 'active'
        });
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

  const res = await db.runTransaction(async transaction => {
    const created = await transaction.collection('warehouse_zones').add({
      data: {
        zone_key: zoneKey,
        name: normalizedName,
        scope: normalizedScope,
        is_builtin: false,
        status: 'active',
        sort_order: maxSortOrder + 10,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'create', operator, openid, {
      _id: created._id,
      zone_key: zoneKey,
      name: normalizedName,
      scope: normalizedScope,
      status: 'active'
    });
    return created;
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
  const authResult = assertAdminMutationAccess(operator, '仅管理员可重命名库存区域');
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

  await db.runTransaction(async transaction => {
    await transaction.collection('warehouse_zones').doc(currentZone._id).update({
      data: {
        name: normalizedName,
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'update', operator, openid, Object.assign({}, currentZone, {
      name: normalizedName
    }), {
      previous_name: currentZone.name,
      next_name: normalizedName
    });
  });

  return {
    success: true,
    msg: '重命名成功'
  };
}

async function setExistingZoneStatus(zoneKey, status, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可启用或停用库存区域');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalized = parseMutationStatus(status);
  if (!normalized) {
    return { success: false, msg: '状态仅支持 active 或 disabled' };
  }
  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const currentZone = existingZones.find(item => item.zone_key === zoneKey);
  if (!currentZone || !currentZone._id) {
    return { success: false, msg: '库存区域不存在' };
  }

  await db.runTransaction(async transaction => {
    await transaction.collection('warehouse_zones').doc(currentZone._id).update({
      data: {
        status: normalized,
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'status', operator, openid, Object.assign({}, currentZone, {
      status: normalized
    }), {
      previous_status: currentZone.status,
      next_status: normalized
    });
  });

  return {
    success: true,
    msg: normalized === 'active' ? '已启用' : '已停用'
  };
}

async function reorderExistingZones(zoneKeys, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可调整库存区域顺序');
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

  await db.runTransaction(async transaction => {
    for (let index = 0; index < validKeys.length; index += 1) {
      const zone = zoneMap.get(validKeys[index]);
      await transaction.collection('warehouse_zones').doc(zone._id).update({
        data: {
          sort_order: (index + 1) * 10,
          updated_at: db.serverDate()
        }
      });
    }
    await writeWarehouseAudit(transaction, 'reorder', operator, openid, { zone_key: validKeys.join(',') }, {
      zone_keys: validKeys
    });
  });

  return {
    success: true,
    msg: '排序已更新'
  };
}

async function createLocationDetail(zoneKey, name, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可新建详细坐标');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedZoneKey = String(zoneKey || '').trim();
  const normalizedName = normalizeLocationDetailName(name);
  if (!normalizedZoneKey) {
    return { success: false, msg: '请选择库存区域' };
  }
  if (!normalizedName) {
    return { success: false, msg: '请输入详细坐标名称' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const zone = existingZones.find(item => item.zone_key === normalizedZoneKey);
  if (!zone) {
    return { success: false, msg: '库存区域不存在' };
  }

  const existingDetails = sortLocationDetailRecords(await ensureBuiltinLocationDetails(db, existingZones));
  const existing = findLocationDetailRecordByName(existingDetails, normalizedZoneKey, normalizedName);
  if (existing) {
    if (existing.status === 'disabled' && existing._id) {
      await db.runTransaction(async transaction => {
        await transaction.collection('warehouse_location_details').doc(existing._id).update({
          data: {
            status: 'active',
            updated_at: db.serverDate()
          }
        });
        await writeWarehouseAudit(transaction, 'status', operator, openid, Object.assign({}, existing, {
          status: 'active'
        }), {
          previous_status: existing.status,
          next_status: 'active'
        });
      });
    }

    return {
      success: true,
      msg: '详细坐标已存在',
      detail_key: existing.detail_key,
      id: existing._id
    };
  }

  const zoneDetails = existingDetails.filter(item => item.zone_key === normalizedZoneKey);
  const maxSortOrder = zoneDetails.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0);
  const detailKey = buildCustomDetailKey(normalizedZoneKey);
  const res = await db.runTransaction(async transaction => {
    const created = await transaction.collection('warehouse_location_details').add({
      data: {
        zone_key: normalizedZoneKey,
        detail_key: detailKey,
        name: normalizedName,
        is_builtin: false,
        status: 'active',
        sort_order: maxSortOrder + 10,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'create', operator, openid, {
      _id: created._id,
      zone_key: normalizedZoneKey,
      detail_key: detailKey,
      name: normalizedName,
      status: 'active'
    });
    return created;
  });

  return {
    success: true,
    msg: '创建成功',
    detail_key: detailKey,
    id: res._id
  };
}

async function renameLocationDetail(detailKey, name, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可重命名详细坐标');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedDetailKey = String(detailKey || '').trim();
  const normalizedName = normalizeLocationDetailName(name);
  if (!normalizedName) {
    return { success: false, msg: '请输入详细坐标名称' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const existingDetails = sortLocationDetailRecords(await ensureBuiltinLocationDetails(db, existingZones));
  const currentDetail = existingDetails.find(item => item.detail_key === normalizedDetailKey);
  if (!currentDetail || !currentDetail._id) {
    return { success: false, msg: '详细坐标不存在' };
  }

  const duplicate = findLocationDetailRecordByName(
    existingDetails,
    currentDetail.zone_key,
    normalizedName,
    normalizedDetailKey
  );
  if (duplicate) {
    return { success: false, msg: '该库区下已存在同名详细坐标' };
  }

  await db.runTransaction(async transaction => {
    await transaction.collection('warehouse_location_details').doc(currentDetail._id).update({
      data: {
        name: normalizedName,
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'update', operator, openid, Object.assign({}, currentDetail, {
      name: normalizedName
    }), {
      previous_name: currentDetail.name,
      next_name: normalizedName
    });
  });

  return {
    success: true,
    msg: '重命名成功'
  };
}

async function setLocationDetailStatus(detailKey, status, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可启用或停用详细坐标');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedDetailKey = String(detailKey || '').trim();
  const normalized = parseMutationStatus(status);
  if (!normalized) {
    return { success: false, msg: '状态仅支持 active 或 disabled' };
  }
  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const existingDetails = sortLocationDetailRecords(await ensureBuiltinLocationDetails(db, existingZones));
  const currentDetail = existingDetails.find(item => item.detail_key === normalizedDetailKey);
  if (!currentDetail || !currentDetail._id) {
    return { success: false, msg: '详细坐标不存在' };
  }

  await db.runTransaction(async transaction => {
    await transaction.collection('warehouse_location_details').doc(currentDetail._id).update({
      data: {
        status: normalized,
        updated_at: db.serverDate()
      }
    });
    await writeWarehouseAudit(transaction, 'status', operator, openid, Object.assign({}, currentDetail, {
      status: normalized
    }), {
      previous_status: currentDetail.status,
      next_status: normalized
    });
  });

  return {
    success: true,
    msg: normalized === 'active' ? '已启用' : '已停用'
  };
}

async function reorderLocationDetails(zoneKey, detailKeys, openid) {
  const operator = await getOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可调整详细坐标顺序');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const normalizedZoneKey = String(zoneKey || '').trim();
  if (!Array.isArray(detailKeys) || detailKeys.length === 0) {
    return { success: false, msg: '缺少排序数据' };
  }

  const existingZones = sortZoneRecords(await ensureBuiltinZones(db));
  const existingDetails = sortLocationDetailRecords(await ensureBuiltinLocationDetails(db, existingZones));
  const detailMap = new Map(
    existingDetails
      .filter(item => item.zone_key === normalizedZoneKey)
      .map(item => [item.detail_key, item])
  );
  const validKeys = detailKeys.map(key => String(key || '').trim()).filter(key => detailMap.has(key));
  if (validKeys.length === 0) {
    return { success: false, msg: '未找到可排序的详细坐标' };
  }

  await db.runTransaction(async transaction => {
    for (let index = 0; index < validKeys.length; index += 1) {
      const detail = detailMap.get(validKeys[index]);
      await transaction.collection('warehouse_location_details').doc(detail._id).update({
        data: {
          sort_order: (index + 1) * 10,
          updated_at: db.serverDate()
        }
      });
    }
    await writeWarehouseAudit(transaction, 'reorder', operator, openid, {
      zone_key: normalizedZoneKey,
      detail_key: validKeys.join(',')
    }, {
      zone_key: normalizedZoneKey,
      detail_keys: validKeys
    });
  });

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
      return await listZones(event || {}, OPENID);
    }
    if (action === 'create') {
      return await createZone(event && event.name, event && event.scope, OPENID);
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
    if (action === 'createDetail') {
      return await createLocationDetail(
        String(event && event.zone_key || '').trim(),
        event && event.name,
        OPENID
      );
    }
    if (action === 'renameDetail') {
      return await renameLocationDetail(String(event && event.detail_key || '').trim(), event && event.name, OPENID);
    }
    if (action === 'setDetailStatus') {
      return await setLocationDetailStatus(String(event && event.detail_key || '').trim(), event && event.status, OPENID);
    }
    if (action === 'reorderDetails') {
      return await reorderLocationDetails(
        String(event && event.zone_key || '').trim(),
        event && event.detail_keys,
        OPENID
      );
    }

    return {
      success: false,
      msg: `不支持的操作: ${action}`
    };
  } catch (err) {
    return handleCloudError(err, {
      scope: 'addWarehouseZone',
      fallbackMessage: '库区操作失败，请稍后重试'
    });
  }
};
