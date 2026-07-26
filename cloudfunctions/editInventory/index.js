const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const {
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildInventoryLocationPayload,
  resolveInventoryLocationText
} = require('./warehouse-zones');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded
} = require('./operation-receipts');
const {
  parseChemicalQuantity,
  parsePositiveIntegerMeters,
  buildInventoryLogIdentityFields
} = require('./inventory-quantity');
const { writeInventoryAuditEvent } = require('./audit-events');

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

function resolveCurrentBaseQuantity(item = {}) {
  if (item.category === 'film') {
    if (item.dynamic_attrs && item.dynamic_attrs.current_length_m !== undefined) {
      return Number(item.dynamic_attrs.current_length_m) || 0;
    }
    return Number(item.length_m || (item.quantity && item.quantity.val)) || 0;
  }

  if (item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
    return Number(item.dynamic_attrs.weight_kg) || 0;
  }
  return Number(item.quantity && item.quantity.val) || 0;
}

function buildStocktakeUpdatePayload(item = {}, nextBaseQuantity) {
  const roundedNextBase = roundNumber(nextBaseQuantity, 3);
  if (item.category === 'film') {
    const dynamicAttrs = item.dynamic_attrs || {};
    const widthMm = Number(dynamicAttrs.width_mm) || 0;
    const initialLengthM = Number(dynamicAttrs.initial_length_m) || roundedNextBase;
    const quantityUnit = item.quantity && item.quantity.unit ? item.quantity.unit : 'm';
    return {
      updateData: {
        'dynamic_attrs.current_length_m': roundedNextBase,
        'quantity.val': getFilmDisplayQuantityFromBaseLength(
          roundedNextBase,
          quantityUnit,
          widthMm,
          initialLengthM
        ),
        update_time: db.serverDate()
      },
      logUnit: 'm'
    };
  }

  const quantityUnit = item.quantity && item.quantity.unit ? item.quantity.unit : 'kg';
  return {
    updateData: {
      'quantity.val': roundedNextBase,
      'dynamic_attrs.weight_kg': roundedNextBase,
      update_time: db.serverDate()
    },
    logUnit: quantityUnit
  };
}

function parseStocktakeQuantity(item = {}, value) {
  if (item.category === 'film') {
    return parsePositiveIntegerMeters(value, '剩余长度');
  }
  return parseChemicalQuantity(value, '当前数量');
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
        const locationUpdateKeys = new Set(['zone_key', 'location_detail', 'location_detail_key']);
        const widthUpdateKeys = new Set(['width_mm', 'adjust_reason']);
        const stocktakeUpdateKeys = new Set(['stocktake_quantity', 'adjust_reason']);
        const isLocationUpdate = updateKeys.length > 0 && updateKeys.every(key => locationUpdateKeys.has(key));
        const isWidthUpdate = updateKeys.includes('width_mm') && updateKeys.every(key => widthUpdateKeys.has(key));
        const isStocktakeUpdate = updateKeys.includes('stocktake_quantity') && updateKeys.every(key => stocktakeUpdateKeys.has(key));

        if (!isLocationUpdate && !isWidthUpdate && !isStocktakeUpdate) {
          throw new Error(`Unsupported update fields: ${updateKeys.join(', ')}`);
        }

        if (isLocationUpdate) {
          const authResult = assertActiveUserAccess(operator, '仅已激活用户可移库');
          if (!authResult.ok) {
            throw new Error(authResult.msg);
          }
        } else if (isWidthUpdate) {
          const authResult = assertAdminMutationAccess(operator, '仅管理员可修正膜材幅宽');
          if (!authResult.ok) {
            throw new Error(authResult.msg);
          }
        } else {
          const authResult = assertAdminMutationAccess(operator, '仅管理员可盘点调整');
          if (!authResult.ok) {
            throw new Error(authResult.msg);
          }
        }
        const operationContext = buildOperationReceiptContext({
          openid: OPENID,
          operationId: event.operation_id,
          requestPayload: {
            inventory_id,
            updates
          }
        });
        const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
        if (operationReceipt.reused) {
          return operationReceipt.response;
        }

        const invRes = await transaction.collection('inventory').doc(inventory_id).get();
        if (!invRes.data) {
          throw new Error('Inventory not found');
        }

        const item = invRes.data;
        if (item.status !== 'in_stock') {
          throw new Error('仅在库库存允许编辑');
        }

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

          const widthAdjustLog = {
              material_id: item.material_id,
              inventory_id,
              material_name: item.material_name,
              category: item.category,
              product_code: item.product_code,
              unique_code: item.unique_code,
              ...buildInventoryLogIdentityFields(item),
              type: 'adjust',
              quantity_change: 0,
              action: 'width_adjust',
              spec_change_unit: quantityUnit,
              description: `幅宽由 [${oldWidthMm || '--'} mm] 修正为 [${nextWidthMm} mm]${reasonText}`,
              operator: (operator && operator.name) || 'System',
              operator_id: OPENID,
              _openid: OPENID,
              timestamp: db.serverDate()
          };
          await transaction.collection('inventory_log').add({ data: widthAdjustLog });
          await writeInventoryAuditEvent(transaction, db, widthAdjustLog, {
            operationId: operationContext.operationId
          });

          const response = { success: true };
          await markOperationReceiptSucceeded(transaction, db, operationContext, response);
          return response;
        }

        if (isStocktakeUpdate) {
          const nextBaseQuantity = parseStocktakeQuantity(item, updates.stocktake_quantity);

          const oldBaseQuantity = resolveCurrentBaseQuantity(item);
          const delta = roundNumber(nextBaseQuantity - oldBaseQuantity, 3);
          const stocktakePayload = buildStocktakeUpdatePayload(item, nextBaseQuantity);
          const adjustReason = String(updates.adjust_reason || '').trim();
          const reasonText = adjustReason ? `；原因：${adjustReason}` : '';

          await transaction.collection('inventory').doc(inventory_id).update({
            data: stocktakePayload.updateData
          });

          const stocktakeLog = {
              material_id: item.material_id,
              inventory_id,
              material_name: item.material_name,
              category: item.category,
              product_code: item.product_code,
              unique_code: item.unique_code,
              ...buildInventoryLogIdentityFields(item),
              type: 'adjust',
              quantity_change: delta,
              action: 'stocktake_adjust',
              spec_change_unit: stocktakePayload.logUnit,
              description: `盘点调整：当前数量由 [${roundNumber(oldBaseQuantity, 3)} ${stocktakePayload.logUnit}] 调整为 [${roundNumber(nextBaseQuantity, 3)} ${stocktakePayload.logUnit}]，差额 ${delta} ${stocktakePayload.logUnit}${reasonText}`,
              operator: (operator && operator.name) || 'System',
              operator_id: OPENID,
              _openid: OPENID,
              timestamp: db.serverDate()
          };
          await transaction.collection('inventory_log').add({ data: stocktakeLog });
          await writeInventoryAuditEvent(transaction, db, stocktakeLog, {
            operationId: operationContext.operationId
          });

          const response = { success: true };
          await markOperationReceiptSucceeded(transaction, db, operationContext, response);
          return response;
        }

        const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
        const detailRecords = await ensureBuiltinLocationDetails(db, zoneRecords);
        const detailMapByZone = buildLocationDetailMapByZone(detailRecords);
        const zoneMap = buildZoneMap(filterZoneRecordsByCategory(zoneRecords, item.category));
        const locationPayload = buildInventoryLocationPayload({
          zoneKey: updates.zone_key,
          locationDetailKey: updates.location_detail_key,
          locationDetail: updates.location_detail
        }, zoneMap, detailMapByZone);
        const oldLocation = resolveInventoryLocationText(item, zoneMap, detailMapByZone) || '未知';
        const newLocation = locationPayload.location_text || '未知';

        await transaction.collection('inventory').doc(inventory_id).update({
            data: {
              ...locationPayload,
              update_time: db.serverDate()
            }
        });

        const transferLog = {
            material_id: item.material_id,
            inventory_id,
            material_name: item.material_name,
            category: item.category,
            product_code: item.product_code,
            unique_code: item.unique_code,
            ...buildInventoryLogIdentityFields(item),
            type: 'transfer',
            quantity_change: 0,
            action: 'transfer',
            description: `位置由 [${oldLocation}] 变更为 [${newLocation}]`,
            operator: (operator && operator.name) || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate()
        };
        await transaction.collection('inventory_log').add({ data: transferLog });
        await writeInventoryAuditEvent(transaction, db, transferLog, {
          operationId: operationContext.operationId
        });

        const response = { success: true };
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
        return response;
     });

     return result;

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
