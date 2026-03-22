const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminAccess } = require('./auth');
const {
  ensureBuiltinZones,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildInventoryLocationPayload,
  resolveInventoryLocationText
} = require('./warehouse-zones');

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeFilmUnit(unit) {
  const normalized = String(unit || 'm').trim().toLowerCase();

  if (normalized === 'm' || normalized === '米') return 'm';
  if (normalized === 'm²' || normalized === '㎡' || normalized === 'm2' || normalized === '平方米') return 'm²';
  if (normalized === 'roll' || normalized === '卷' || normalized === '卷装') return '卷';

  return String(unit || 'm').trim() || 'm';
}

function getFilmDisplayQuantityFromBaseLength(baseLengthM, displayUnit, widthMm, initialLengthM) {
  const normalizedUnit = normalizeFilmUnit(displayUnit);
  const safeBaseLength = roundNumber(baseLengthM);
  const safeWidthMm = Number(widthMm) || 0;
  const safeInitialLengthM = Number(initialLengthM) || 0;

  if (normalizedUnit === 'm²') {
    return roundNumber(safeBaseLength * (safeWidthMm / 1000), 2);
  }

  if (normalizedUnit === '卷') {
    if (safeInitialLengthM > 0) {
      return roundNumber(safeBaseLength / safeInitialLengthM, 3);
    }
    return safeBaseLength > 0 ? 1 : 0;
  }

  return roundNumber(safeBaseLength, 2);
}

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { inventory_id, updates } = event;

  if (!inventory_id || !updates) {
    return { success: false, msg: 'Missing parameters' };
  }

  try {
     const result = await db.runTransaction(async transaction => {
        const userRes = await transaction.collection('users').where({ _openid: OPENID }).get();
        const operator = userRes.data[0];
        const updateKeys = Object.keys(updates || {});
        const locationUpdateKeys = new Set(['zone_key', 'location_detail']);
        const widthUpdateKeys = new Set(['width_mm', 'adjust_reason']);
        const isLocationUpdate = updateKeys.length > 0 && updateKeys.every(key => locationUpdateKeys.has(key));
        const isWidthUpdate = updateKeys.includes('width_mm') && updateKeys.every(key => widthUpdateKeys.has(key));

        if (!isLocationUpdate && !isWidthUpdate) {
          throw new Error(`Unsupported update fields: ${updateKeys.join(', ')}`);
        }

        if (isLocationUpdate) {
          const authResult = assertActiveUserAccess(operator, '仅已激活用户可移库');
          if (!authResult.ok) {
            throw new Error(authResult.msg);
          }
        } else {
          const authResult = assertAdminAccess(operator, '仅管理员可修正膜材幅宽');
          if (!authResult.ok) {
            throw new Error(authResult.msg);
          }
        }

        const invRes = await transaction.collection('inventory').doc(inventory_id).get();
        if (!invRes.data) {
          throw new Error('Inventory not found');
        }

        const item = invRes.data;
        if (isWidthUpdate) {
          if (item.category !== 'film') {
            throw new Error('仅膜材记录支持修正幅宽');
          }

          const nextWidthMm = Number(updates.width_mm);
          if (!Number.isFinite(nextWidthMm) || nextWidthMm <= 0) {
            throw new Error('请输入有效的幅宽');
          }

          const oldWidthMm = Number(item.dynamic_attrs && item.dynamic_attrs.width_mm) || 0;
          const baseLengthM = Number(
            item.dynamic_attrs && item.dynamic_attrs.current_length_m !== undefined
              ? item.dynamic_attrs.current_length_m
              : item.length_m
          ) || 0;
          const initialLengthM = Number(
            item.dynamic_attrs && item.dynamic_attrs.initial_length_m !== undefined
              ? item.dynamic_attrs.initial_length_m
              : baseLengthM
          ) || 0;
          const quantityUnit = item.quantity && item.quantity.unit ? item.quantity.unit : 'm';
          const updatedQuantityVal = getFilmDisplayQuantityFromBaseLength(
            baseLengthM,
            quantityUnit,
            nextWidthMm,
            initialLengthM
          );
          const adjustReason = String(updates.adjust_reason || '').trim();
          const reasonText = adjustReason ? `；原因：${adjustReason}` : '';

          await transaction.collection('inventory').doc(inventory_id).update({
            data: {
              'dynamic_attrs.width_mm': nextWidthMm,
              'quantity.val': updatedQuantityVal,
              update_time: db.serverDate()
            }
          });

          await transaction.collection('inventory_log').add({
            data: {
              material_id: item.material_id,
              inventory_id,
              material_name: item.material_name,
              category: item.category,
              product_code: item.product_code,
              unique_code: item.unique_code,
              type: 'adjust',
              quantity_change: 0,
              action: '修正幅宽',
              spec_change_unit: quantityUnit,
              description: `幅宽由 [${oldWidthMm || '--'} mm] 修正为 [${nextWidthMm} mm]${reasonText}`,
              operator: event.operator_name || 'System',
              operator_id: OPENID,
              _openid: OPENID,
              timestamp: db.serverDate()
            }
          });

          return { success: true };
        }

        const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
        const zoneMap = buildZoneMap(filterZoneRecordsByCategory(zoneRecords, item.category));
        const locationPayload = buildInventoryLocationPayload({
          zoneKey: updates.zone_key,
          locationDetail: updates.location_detail
        }, zoneMap);
        const oldLocation = resolveInventoryLocationText(item, zoneMap) || '未知';
        const newLocation = locationPayload.location_text || '未知';

        await transaction.collection('inventory').doc(inventory_id).update({
            data: {
              ...locationPayload,
              update_time: db.serverDate()
            }
        });

        await transaction.collection('inventory_log').add({
          data: {
            material_id: item.material_id,
            inventory_id,
            material_name: item.material_name,
            category: item.category,
            product_code: item.product_code,
            unique_code: item.unique_code,
            type: 'transfer',
            quantity_change: 0,
            action: '移库',
            description: `位置由 [${oldLocation}] 变更为 [${newLocation}]`,
            operator: event.operator_name || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate()
          }
        });

        return { success: true };
     });

     return result;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
