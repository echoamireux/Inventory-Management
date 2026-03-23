// cloudfunctions/updateInventory/index.js
const cloud = require('wx-server-sdk');
const {
  getFilmDisplayState,
  getFilmDisplayQuantityFromBaseLength,
  roundNumber
} = require('./film-quantity');
const { sortInventoryAllocationCandidates } = require('./inventory-allocation');
const { assertActiveUserAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 浮点数精度阈值（用于库存量比较）
const EPSILON = 0.001;
const PRECISION = 1000; // 3 decimal places for calculation safety

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return res.data && res.data.length > 0 ? res.data[0] : null;
}

async function loadWithdrawCandidates({ unique_code, product_code, batch_no }) {
  if (unique_code) {
    const res = await db.collection('inventory')
      .where({ unique_code })
      .limit(1)
      .get();
    return sortInventoryAllocationCandidates(res.data || []);
  }

  if (product_code && batch_no) {
    const res = await db.collection('inventory')
      .where({
        product_code,
        batch_number: batch_no,
        status: 'in_stock'
      })
      .get();
    return sortInventoryAllocationCandidates(res.data || []);
  }

  return [];
}

async function loadPreferredFilmUnit(items = []) {
  const firstFilmItem = (items || []).find(item => item.category === 'film' && item.product_code);
  if (!firstFilmItem) {
    return '';
  }

  try {
    const res = await db.collection('materials')
      .where({ product_code: firstFilmItem.product_code })
      .field({ default_unit: true })
      .limit(1)
      .get();

    if (res.data && res.data.length > 0) {
      return String(res.data[0].default_unit || '').trim();
    }
  } catch (err) {
    console.warn('Load film default unit failed', err);
  }

  return '';
}

async function reloadTransactionCandidates(transaction, candidateIds = []) {
  const items = [];
  for (const candidateId of candidateIds) {
    const res = await transaction.collection('inventory').doc(candidateId).get();
    if (res.data) {
      items.push(res.data);
    }
  }
  return sortInventoryAllocationCandidates(items);
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
    unique_code,
    product_code,
    batch_no,
    withdraw_amount,
    quantity,
    type,
    note
  } = event;

  if ((quantity !== undefined || type !== undefined) && withdraw_amount === undefined) {
    return {
      success: false,
      msg: '旧快捷出入库协议已停用，请使用正式入库流程或库存详情页领用'
    };
  }

  if (!withdraw_amount || Number(withdraw_amount) <= 0) {
    return { success: false, msg: 'Invalid amount' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行领用');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const totalNeed = Number(withdraw_amount);
    const candidateItems = await loadWithdrawCandidates({
      unique_code,
      product_code,
      batch_no
    });
    const candidateIds = candidateItems.map(item => item._id);
    const preferredFilmUnit = await loadPreferredFilmUnit(candidateItems);

    const result = await db.runTransaction(async transaction => {
      const itemsToProcess = await reloadTransactionCandidates(transaction, candidateIds);
      if (itemsToProcess.length === 0) {
        throw new Error('No available inventory found for this selection.');
      }

      let remainingNeed = totalNeed;
      const logs = [];
      const newStockMap = new Map();

      for (const item of itemsToProcess) {
        if (remainingNeed <= EPSILON) break;

        const isFilm = item.category === 'film';
        const currentStock = isFilm
          ? Number(item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0
          : Number(item.quantity && item.quantity.val) || 0;

        let deduct = Math.min(currentStock, remainingNeed);
        deduct = Math.floor(deduct * PRECISION) / PRECISION;
        if (deduct <= 0) {
          continue;
        }

        let newStock = currentStock - deduct;
        newStock = roundNumber(newStock);

        remainingNeed -= deduct;
        remainingNeed = Math.round(remainingNeed * PRECISION) / PRECISION;

        newStockMap.set(item._id, {
          newStock,
          isFilm,
          unit: item.quantity && item.quantity.unit,
          widthMm: item.dynamic_attrs && item.dynamic_attrs.width_mm,
          initialLengthM: item.dynamic_attrs && item.dynamic_attrs.initial_length_m
        });

        const updateData = { update_time: db.serverDate() };
        let newStatus = item.status;

        if (isFilm) {
          updateData['dynamic_attrs.current_length_m'] = newStock;
          updateData['quantity.val'] = getFilmDisplayQuantityFromBaseLength(
            newStock,
            item.quantity.unit,
            item.dynamic_attrs && item.dynamic_attrs.width_mm,
            item.dynamic_attrs && item.dynamic_attrs.initial_length_m
          );
          if (newStock <= 0.1) newStatus = 'used';
        } else {
          updateData['quantity.val'] = newStock;
          if (item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
            updateData['dynamic_attrs.weight_kg'] = newStock;
          }
          if (newStock <= 0.001) newStatus = 'used';
        }
        updateData.status = newStatus;

        await transaction.collection('inventory').doc(item._id).update({ data: updateData });

        logs.push({
          material_id: item.material_id,
          inventory_id: item._id,
          material_name: item.material_name,
          category: item.category,
          product_code: item.product_code,
          unique_code: item.unique_code,
          type: 'outbound',
          quantity_change: -deduct,
          unit: isFilm ? 'm' : (item.quantity.unit || 'kg'),
          spec_change_unit: isFilm ? 'm' : (item.quantity.unit || 'kg'),
          operator: event.operator_name || 'System',
          operator_id: OPENID,
          _openid: OPENID,
          timestamp: db.serverDate(),
          description: `${note || '领料'} (系统分配: ${String(item.unique_code || '').slice(-6)})`
        });
      }

      if (remainingNeed > EPSILON) {
        throw new Error(`库存不足，总可用: ${(totalNeed - remainingNeed).toFixed(2)}，需求: ${totalNeed}`);
      }

      for (const log of logs) {
        await transaction.collection('inventory_log').add({ data: log });
      }

      let totalRemaining = 0;
      let unit = 'kg';
      let displayRemaining = 0;
      let displayUnit = 'kg';

      for (const item of itemsToProcess) {
        const stockInfo = newStockMap.get(item._id);
        if (stockInfo) {
          totalRemaining += stockInfo.newStock;
          if (stockInfo.isFilm) {
            displayRemaining += getFilmDisplayQuantityFromBaseLength(
              stockInfo.newStock,
              preferredFilmUnit || stockInfo.unit,
              stockInfo.widthMm,
              stockInfo.initialLengthM
            );
            displayUnit = preferredFilmUnit || stockInfo.unit || 'm';
            unit = 'm';
          } else {
            displayRemaining += stockInfo.newStock;
            displayUnit = stockInfo.unit || 'kg';
            unit = stockInfo.unit || 'kg';
          }
        } else if (item.category === 'film') {
          const filmState = getFilmDisplayState(
            item,
            preferredFilmUnit || item.default_unit || (item.quantity && item.quantity.unit)
          );
          totalRemaining += filmState.baseLengthM;
          displayRemaining += filmState.displayQuantity;
          displayUnit = filmState.displayUnit;
          unit = 'm';
        } else {
          const quantityVal = Number(item.quantity && item.quantity.val) || 0;
          totalRemaining += quantityVal;
          displayRemaining += quantityVal;
          displayUnit = (item.quantity && item.quantity.unit) || 'kg';
          unit = (item.quantity && item.quantity.unit) || 'kg';
        }
      }

      return {
        success: true,
        remaining: Number(totalRemaining.toFixed(2)),
        unit,
        displayRemaining: Number(displayRemaining.toFixed(2)),
        displayUnit
      };
    });

    return result;
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
