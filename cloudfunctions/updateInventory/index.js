// cloudfunctions/updateInventory/index.js
const cloud = require('wx-server-sdk');
const {
  getFilmDisplayState,
  getFilmDisplayQuantityFromBaseLength,
  roundNumber
} = require('./film-quantity');
const { sortInventoryAllocationCandidates } = require('./inventory-allocation');
const { assertActiveUserAccess } = require('./auth');
const {
  shouldBlockTestMaterialProductOnlyWithdrawal
} = require('./test-material-withdrawal');
const {
  assertConsistentChemicalUnits,
  parseChemicalQuantity,
  parsePositiveIntegerMeters
} = require('./inventory-quantity');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded
} = require('./operation-receipts');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const PRECISION = 1000; // 3 decimal places for calculation safety

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return res.data && res.data.length > 0 ? res.data[0] : null;
}

async function loadWithdrawCandidates({ unique_code, product_code, batch_no, supplier_model }) {
  if (unique_code) {
    const res = await db.collection('inventory')
      .where({ unique_code, status: 'in_stock' })
      .limit(1)
      .get();
    return sortInventoryAllocationCandidates(res.data || []);
  }

  if (product_code && batch_no) {
    const where = {
      product_code,
      batch_number: batch_no,
      status: 'in_stock'
    };
    if (supplier_model) {
      where.supplier_model = supplier_model;
    }
    return sortInventoryAllocationCandidates(await loadInventoryCandidatesByPage({
      ...where
    }));
  }

  if (product_code) {
    return sortInventoryAllocationCandidates(await loadInventoryCandidatesByPage({
      product_code,
      status: 'in_stock'
    }));
  }

  return [];
}

async function loadInventoryCandidatesByPage(where, pageSize = 100) {
  let skip = 0;
  let items = [];

  while (true) {
    const res = await db.collection('inventory')
      .where(where)
      .skip(skip)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    items = items.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return items;
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

async function loadMaterialByProductCode(productCode) {
  const normalizedCode = String(productCode || '').trim();
  if (!normalizedCode) {
    return null;
  }

  try {
    const res = await db.collection('materials')
      .where({ product_code: normalizedCode })
      .field({ is_test_material: true, status: true })
      .limit(1)
      .get();
    return res.data && res.data[0] ? res.data[0] : null;
  } catch (err) {
    console.warn('Load material test flag failed', err);
    return null;
  }
}

async function reloadTransactionCandidates(transaction, candidateIds = []) {
  const items = [];
  for (const candidateId of candidateIds) {
    const res = await transaction.collection('inventory').doc(candidateId).get();
    if (res.data) {
      items.push(res.data);
    }
  }
  return sortInventoryAllocationCandidates(items.filter(item => item.status === 'in_stock'));
}

async function loadActiveProject(projectCode) {
  const res = await db.collection('project_codes').where({
    project_code: projectCode,
    status: 'active'
  }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function buildWithdrawDescription(projectCode, projectName, withdrawNote, uniqueCode) {
  const projectLabel = projectCode
    ? `${projectCode}${projectName ? ` - ${projectName}` : ''}`
    : '未填写项目编码';
  const noteText = withdrawNote ? `；备注：${withdrawNote}` : '';
  return `领料项目：${projectLabel}${noteText} (系统分配: ${String(uniqueCode || '').slice(-6)})`;
}

function isRetryableTransactionConflict(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '').toLowerCase();
  return /transaction|conflict|version|事务|冲突|版本/.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
    unique_code,
    product_code,
    batch_no,
    supplier_model,
    withdraw_amount,
    quantity,
    type,
    project_code,
    withdraw_note
  } = event;

  if ((quantity !== undefined || type !== undefined) && withdraw_amount === undefined) {
    return {
      success: false,
      msg: '旧快捷出入库协议已停用，请使用正式入库流程或库存详情页领用'
    };
  }

  const requestedNeed = Number(withdraw_amount);
  if (!Number.isFinite(requestedNeed) || requestedNeed <= 0) {
    return { success: false, msg: '领用数量必须为有效正数' };
  }

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可执行领用');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const projectCode = sanitizeText(project_code).toUpperCase();
    const withdrawNote = sanitizeText(withdraw_note);
    if (!projectCode) {
      return { success: false, msg: '请选择项目编码' };
    }
    const project = await loadActiveProject(projectCode);
    if (!project) {
      return { success: false, msg: '项目编码不存在或已停用，请刷新后重新选择' };
    }
    const projectName = sanitizeText(project.project_name);
    const operationContext = buildOperationReceiptContext({
      openid: OPENID,
      operationId: event.operation_id,
      requestPayload: {
        unique_code,
        product_code,
        batch_no,
        supplier_model,
        withdraw_amount,
        project_code: projectCode,
        withdraw_note: withdrawNote
      }
    });

    const materialForSelection = (!unique_code && product_code)
      ? await loadMaterialByProductCode(product_code)
      : null;
    const supplierModel = sanitizeText(supplier_model);
    if (batch_no && materialForSelection && materialForSelection.is_test_material && !supplierModel) {
      return { success: false, msg: '测试料按批次领用时必须选择原厂型号' };
    }

    const candidateItems = await loadWithdrawCandidates({
      unique_code,
      product_code,
      batch_no,
      supplier_model: materialForSelection && materialForSelection.is_test_material ? supplierModel : ''
    });
    const candidateIds = candidateItems.map(item => item._id);
    const testMaterialGuard = shouldBlockTestMaterialProductOnlyWithdrawal({
      unique_code,
      product_code,
      batch_no,
      candidates: candidateItems,
      material: materialForSelection
    });
    if (testMaterialGuard.blocked) {
      return { success: false, msg: testMaterialGuard.msg };
    }
    assertConsistentChemicalUnits(candidateItems);
    const isFilmSelection = candidateItems.length > 0
      && candidateItems.every(item => item && item.category === 'film');
    const totalNeed = isFilmSelection
      ? parsePositiveIntegerMeters(withdraw_amount, '膜材领用量')
      : parseChemicalQuantity(withdraw_amount, '领用数量');
    const preferredFilmUnit = await loadPreferredFilmUnit(candidateItems);

    const runWithdrawalTransaction = () => db.runTransaction(async transaction => {
      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      const itemsToProcess = await reloadTransactionCandidates(transaction, candidateIds);
      if (itemsToProcess.length === 0) {
        throw new Error('No available inventory found for this selection.');
      }
      assertConsistentChemicalUnits(itemsToProcess);

      let remainingNeed = totalNeed;
      const logs = [];
      const newStockMap = new Map();

      for (const item of itemsToProcess) {
        if (remainingNeed <= 0) break;

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
          if (newStock === 0) newStatus = 'used';
        } else {
          updateData['quantity.val'] = newStock;
          if (item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
            updateData['dynamic_attrs.weight_kg'] = newStock;
          }
          if (newStock === 0) newStatus = 'used';
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
          operator: (operator && operator.name) || 'System',
          operator_id: OPENID,
          _openid: OPENID,
          project_code: projectCode,
          project_name: projectName,
          withdraw_note: withdrawNote,
          note: projectCode,
          timestamp: db.serverDate(),
          description: buildWithdrawDescription(projectCode, projectName, withdrawNote, item.unique_code)
        });
      }

      if (remainingNeed > 0) {
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

      // 根据调用模式确定剩余量的范围描述
      const remainingScope = unique_code
        ? '本标签'
        : (batch_no ? '本批次' : '该产品');

      const response = {
        success: true,
        remaining: Number(totalRemaining.toFixed(2)),
        unit,
        displayRemaining: Number(displayRemaining.toFixed(2)),
        displayUnit,
        remainingScope
      };
      await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      return response;
    });

    let lastTransactionError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await runWithdrawalTransaction();
      } catch (err) {
        lastTransactionError = err;
        if (!isRetryableTransactionConflict(err) || attempt >= 3) {
          throw err;
        }
        await wait(attempt * 80);
      }
    }

    throw lastTransactionError;
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
