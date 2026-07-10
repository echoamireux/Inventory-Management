const {
  buildFilmInventoryState,
  roundNumber
} = require('./film-quantity');

const QUANTITY_AFFECTING_LOG_TYPES = new Set(['outbound', 'refill', 'adjust']);

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeUnit(value) {
  return normalizeText(value);
}

function isTestMaterialRecord(record = {}) {
  return record.is_test_material === true;
}

function hasMatchingTestMaterialIdentity(existingInventory = {}, candidate = {}) {
  if (!isTestMaterialRecord(existingInventory) && !isTestMaterialRecord(candidate)) {
    return true;
  }

  const existingModel = normalizeText(existingInventory.supplier_model);
  const candidateModel = normalizeText(candidate.supplier_model);
  return !!existingModel && existingModel === candidateModel;
}

function hasMatchingChemicalUnit(existingInventory = {}, candidate = {}) {
  const existingUnit = normalizeUnit(existingInventory.quantity && existingInventory.quantity.unit);
  const candidateUnit = normalizeUnit(
    (candidate.quantity && candidate.quantity.unit) || candidate.quantity_unit || candidate.default_unit
  );
  return !!existingUnit && existingUnit === candidateUnit;
}

function normalizeLogType(type) {
  return normalizeText(type).toLowerCase();
}

function resolveLogTimestamp(record = {}) {
  const raw = record.timestamp || record.create_time || 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isQuantityAffectingLogType(type) {
  return QUANTITY_AFFECTING_LOG_TYPES.has(normalizeLogType(type));
}

function isChemicalRefillEligible(existingInventory = {}, candidate = {}) {
  return normalizeText(existingInventory.category) === 'chemical'
    && normalizeText(existingInventory.status) === 'in_stock'
    && normalizeText(existingInventory.product_code) === normalizeText(candidate.product_code)
    && normalizeText(existingInventory.batch_number) === normalizeText(candidate.batch_number)
    && hasMatchingTestMaterialIdentity(existingInventory, candidate)
    && hasMatchingChemicalUnit(existingInventory, candidate);
}

function buildChemicalRefillUpdate(existingInventory = {}, refillQuantity) {
  const currentQuantity = Number(existingInventory.quantity && existingInventory.quantity.val);
  const increment = Number(refillQuantity);
  if (!Number.isFinite(currentQuantity) || currentQuantity < 0) {
    throw new Error('当前化材库存数量无效，请先完成库存纠错');
  }
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new Error('补料数量必须为有效正数');
  }
  const nextQuantity = roundNumber(currentQuantity + increment, 3);

  return {
    nextQuantity,
    updateData: {
      'quantity.val': nextQuantity,
      'dynamic_attrs.weight_kg': nextQuantity
    }
  };
}

function assertConsistentChemicalUnits(items = []) {
  const chemicalItems = (items || []).filter(item => normalizeText(item && item.category) === 'chemical');
  if (chemicalItems.length === 0) {
    return '';
  }

  const units = new Set(chemicalItems.map(item => normalizeUnit(item && item.quantity && item.quantity.unit)));
  if (units.has('') || units.size !== 1) {
    throw new Error('所选化材库存单位不一致，请先核实库存数据后再操作');
  }
  return Array.from(units)[0];
}

function applyChemicalQuantityDelta(existingInventory = {}, delta) {
  const currentQuantity = normalizeNumber(existingInventory.quantity && existingInventory.quantity.val);
  const nextQuantity = roundNumber(currentQuantity + normalizeNumber(delta), 3);

  if (!(nextQuantity > 0)) {
    throw new Error('纠错后的化材库存数量必须大于 0');
  }

  return {
    nextQuantity,
    updateData: {
      'quantity.val': nextQuantity,
      'dynamic_attrs.weight_kg': nextQuantity
    }
  };
}

function applyFilmQuantityDelta(existingInventory = {}, delta) {
  const quantity = existingInventory.quantity || {};
  const dynamicAttrs = existingInventory.dynamic_attrs || {};
  const widthMm = normalizeNumber(dynamicAttrs.width_mm);
  const displayUnit = normalizeText(quantity.unit) || 'm';
  const currentLengthM = normalizeNumber(dynamicAttrs.current_length_m);
  const initialLengthM = normalizeNumber(dynamicAttrs.initial_length_m) || currentLengthM;
  const safeDelta = normalizeNumber(delta);
  const nextCurrentLengthM = roundNumber(currentLengthM + safeDelta, 3);
  const nextInitialLengthM = roundNumber(initialLengthM + safeDelta, 3);

  if (!(widthMm > 0)) {
    throw new Error('当前膜材缺少有效幅宽，无法执行数量纠错');
  }
  if (!(nextCurrentLengthM > 0) || !(nextInitialLengthM > 0)) {
    throw new Error('纠错后的膜材长度必须大于 0');
  }

  const nextState = buildFilmInventoryState(
    nextCurrentLengthM,
    displayUnit,
    widthMm,
    nextInitialLengthM
  );

  return {
    nextCurrentLengthM: nextState.currentLengthM,
    nextInitialLengthM: nextState.initialLengthM,
    nextDisplayQuantity: nextState.quantityVal,
    nextDisplayUnit: nextState.quantityUnit,
    updateData: {
      'quantity.val': nextState.quantityVal,
      'quantity.unit': nextState.quantityUnit,
      'dynamic_attrs.current_length_m': nextState.currentLengthM,
      'dynamic_attrs.initial_length_m': nextState.initialLengthM
    }
  };
}

module.exports = {
  QUANTITY_AFFECTING_LOG_TYPES,
  normalizeLogType,
  resolveLogTimestamp,
  isQuantityAffectingLogType,
  hasMatchingTestMaterialIdentity,
  hasMatchingChemicalUnit,
  isChemicalRefillEligible,
  buildChemicalRefillUpdate,
  assertConsistentChemicalUnits,
  applyChemicalQuantityDelta,
  applyFilmQuantityDelta
};
