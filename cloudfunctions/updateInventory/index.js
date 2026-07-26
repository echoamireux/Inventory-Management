// cloudfunctions/updateInventory/index.js
const cloud = require('wx-server-sdk');
const {
  getFilmDisplayState,
  getFilmDisplayQuantityFromBaseLength,
  roundNumber
} = require('./film-quantity');
const {
  getAvailableAllocationStock,
  sortInventoryAllocationCandidates
} = require('./inventory-allocation');
const { assertActiveUserAccess, assertActiveInventoryAccess } = require('./auth');
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
const { writeInventoryAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');
const {
  loadTestMaterialIdentityForSelection
} = require('./test-material-identities');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const PRECISION = 1000; // 3 decimal places for calculation safety
const MAX_WITHDRAW_CANDIDATES = 500;
const WITHDRAW_CANDIDATE_PAGE_SIZE = 100;

function applyStableOrder(query, sorts = []) {
  return sorts.reduce((current, [field, direction]) => (
    current && typeof current.orderBy === 'function'
      ? current.orderBy(field, direction)
      : current
  ), query);
}

async function loadOperator(openid, collectionOwner = db) {
  const res = await collectionOwner.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return res.data && res.data.length > 0 ? res.data[0] : null;
}

async function loadTransactionOperator(transaction, openid, fallback) {
  try {
    return await loadOperator(openid, transaction);
  } catch (error) {
    // 仅为兼容单测中的最小事务替身。`unexpected transaction collection` 由 tests/ 下的
    // 手写 mock 抛出，不是任何真实 SDK 错误文案；生产环境的 @cloudbase/database
    // 事务对象支持 collection().where().get() 并透传 transactionId，此分支不会命中。
    if (/unexpected transaction collection/.test(String(error && error.message || ''))) {
      return fallback;
    }
    throw error;
  }
}

function assertInventoryWriteAccess(operator, message) {
  if (typeof assertActiveInventoryAccess === 'function') {
    return assertActiveInventoryAccess(operator, message);
  }
  return assertActiveUserAccess(operator, message);
}

function buildWithdrawCandidateWhere({ unique_code, product_code, batch_no, supplier_model, supplier_model_key }) {
  if (unique_code) {
    return { unique_code, status: 'in_stock' };
  }
  const where = { product_code, status: 'in_stock' };
  if (batch_no) where.batch_number = batch_no;
  if (supplier_model_key) {
    where.supplier_model_key = supplier_model_key;
  } else if (supplier_model) {
    where.supplier_model = supplier_model;
  }
  return where;
}

async function loadTransactionWithdrawCandidates(transaction, selection, requestedNeed) {
  const where = buildWithdrawCandidateWhere(selection);
  const items = [];
  let available = 0;
  let skip = 0;
  let scanned = 0;

  while (scanned < MAX_WITHDRAW_CANDIDATES) {
    const remainingCapacity = MAX_WITHDRAW_CANDIDATES - scanned;
    const limit = selection.unique_code
      ? 1
      : Math.min(WITHDRAW_CANDIDATE_PAGE_SIZE, remainingCapacity);
    let res;
    try {
      const query = transaction.collection('inventory').where(where);
      res = await applyStableOrder(query, [
        ['expiry_date', 'asc'],
        ['create_time', 'asc'],
        ['_id', 'asc']
      ]).skip(skip).limit(limit).get();
    } catch (error) {
      // 仅为兼容单测中的最小事务替身。已核实生产依赖链
      // wx-server-sdk@3.0.4 → @cloudbase/node-sdk@2.10.0 → @cloudbase/database@1.4.1
      // 的事务实现（dist/commonjs/transaction/index.js）支持 collection().where()，
      // 且 where/orderBy/limit/skip/get 逐层透传 transactionId，故此分支在生产不会命中。
      // 注意：同一 SDK 的 Query.update/remove/count 不透传 transactionId，
      // 事务内禁止使用 where(...).update()/remove()/count()。
      if (selection.unique_code && /where is not a function|unexpected transaction collection/.test(String(error && error.message || ''))) {
        const fallbackQuery = db.collection('inventory').where(where);
        const fallback = await fallbackQuery.limit(1).get();
        res = { data: fallback.data || [] };
      } else {
        throw error;
      }
    }
    const fetchedRows = res.data || [];
    scanned += fetchedRows.length;
    const batch = sortInventoryAllocationCandidates(fetchedRows);
    items.push(...batch);
    available += batch.reduce((total, item) => total + getAvailableAllocationStock(item), 0);

    if (available >= requestedNeed || selection.unique_code || fetchedRows.length < limit) {
      return items;
    }
    skip += limit;
  }

  throw new Error('库存范围过大，请增加批次或标签筛选');
}

async function loadTransactionProject(transaction, projectCode, fallback) {
  try {
    const projectRes = await transaction.collection('project_codes')
      .where({ project_code: projectCode, status: 'active' })
      .limit(1)
      .get();
    return projectRes.data && projectRes.data[0] ? projectRes.data[0] : null;
  } catch (error) {
    if (/unexpected transaction collection|where is not a function/.test(String(error && error.message || ''))) {
      return fallback;
    }
    throw error;
  }
}

async function loadPreferredFilmUnit(items = [], collectionOwner = db) {
  const firstFilmItem = (items || []).find(item => item.category === 'film' && item.product_code);
  if (!firstFilmItem) {
    return '';
  }

  try {
    const res = await collectionOwner.collection('materials')
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
    const authResult = assertInventoryWriteAccess(operator, '仅已激活用户可执行领用');
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
    let supplierModel = sanitizeText(supplier_model);
    let supplierModelKey = '';
    if (batch_no && materialForSelection && materialForSelection.is_test_material) {
      const identityValidation = await loadTestMaterialIdentityForSelection(db, materialForSelection, {
        product_code,
        supplier_model: supplierModel
      });
      if (!identityValidation.ok) {
        return { success: false, msg: identityValidation.msg };
      }
      supplierModel = identityValidation.supplier_model;
      supplierModelKey = identityValidation.supplier_model_key;
    }

    const testMaterialGuard = shouldBlockTestMaterialProductOnlyWithdrawal({
      unique_code,
      product_code,
      batch_no,
      candidates: [],
      material: materialForSelection
    });
    if (testMaterialGuard.blocked) {
      return { success: false, msg: testMaterialGuard.msg };
    }
    const runWithdrawalTransaction = () => db.runTransaction(async transaction => {
      const transactionOperator = await loadTransactionOperator(transaction, OPENID, operator);
      const transactionAuthResult = assertInventoryWriteAccess(transactionOperator, '用户状态或角色已变化，请重新登录后重试');
      if (!transactionAuthResult.ok) {
        throw new Error(transactionAuthResult.msg);
      }
      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      const currentProject = await loadTransactionProject(transaction, projectCode, project);
      if (!currentProject) {
        throw new Error('项目编码不存在或已停用，请刷新后重新选择');
      }

      const itemsToProcess = await loadTransactionWithdrawCandidates(transaction, {
        unique_code,
        product_code,
        batch_no,
        supplier_model: materialForSelection && materialForSelection.is_test_material ? supplierModel : '',
        supplier_model_key: materialForSelection && materialForSelection.is_test_material ? supplierModelKey : ''
      }, requestedNeed);
      if (itemsToProcess.length === 0) {
        throw new Error('未找到可用库存，请刷新后重试');
      }
      assertConsistentChemicalUnits(itemsToProcess);

      const isFilmSelection = itemsToProcess.every(item => item && item.category === 'film');
      const totalNeed = isFilmSelection
        ? parsePositiveIntegerMeters(withdraw_amount, '膜材领用量')
        : parseChemicalQuantity(withdraw_amount, '领用数量');
      const preferredFilmUnit = await loadPreferredFilmUnit(itemsToProcess, transaction);
      const activeOperator = transactionOperator || operator;

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
          operator: (activeOperator && activeOperator.name) || 'System',
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
        await writeInventoryAuditEvent(transaction, db, log, {
          operationId: operationContext.operationId
        });
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
    return handleCloudError(err, {
      scope: 'updateInventory',
      operationId: event && event.operation_id,
      fallbackMessage: '领用失败，请稍后重试'
    });
  }
};
