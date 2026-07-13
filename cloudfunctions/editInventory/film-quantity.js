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

function buildFilmInventoryState(baseLengthM, displayUnit, widthMm, initialLengthM) {
  const normalizedUnit = normalizeFilmUnit(displayUnit);
  const safeBaseLength = roundNumber(baseLengthM);
  const safeInitialLengthM = Number(initialLengthM) > 0 ? Number(initialLengthM) : safeBaseLength;

  return {
    quantityVal: getFilmDisplayQuantityFromBaseLength(
      safeBaseLength,
      normalizedUnit,
      widthMm,
      safeInitialLengthM
    ),
    quantityUnit: normalizedUnit,
    currentLengthM: safeBaseLength,
    initialLengthM: roundNumber(safeInitialLengthM)
  };
}

function getFilmDisplayState(item, preferredUnit) {
  const dynamicAttrs = item && item.dynamic_attrs ? item.dynamic_attrs : {};
  const specs = item && item.specs ? item.specs : {};
  const quantity = item && item.quantity ? item.quantity : {};
  const fallbackLength = item && item.length_m !== undefined ? item.length_m : 0;
  const fallbackDefaultUnit = item && item.default_unit ? item.default_unit : 'm';
  const baseLengthM = Number(
    dynamicAttrs.current_length_m !== undefined ? dynamicAttrs.current_length_m : fallbackLength
  ) || 0;
  const widthMm = Number(
    dynamicAttrs.width_mm !== undefined
      ? dynamicAttrs.width_mm
      : (specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm)
  ) || 0;
  const initialLengthM = Number(
    dynamicAttrs.initial_length_m !== undefined ? dynamicAttrs.initial_length_m : (fallbackLength || baseLengthM)
  ) || 0;
  const unit = normalizeFilmUnit(preferredUnit || quantity.unit || fallbackDefaultUnit || 'm');

  return {
    baseLengthM: roundNumber(baseLengthM),
    widthMm,
    initialLengthM: roundNumber(initialLengthM),
    displayUnit: unit,
    displayQuantity: getFilmDisplayQuantityFromBaseLength(baseLengthM, unit, widthMm, initialLengthM)
  };
}

function summarizeFilmDisplayQuantities(items, preferredUnit) {
  const list = items || [];
  const firstItem = list[0] || {};
  const firstQuantity = firstItem.quantity || {};
  const displayUnit = normalizeFilmUnit(preferredUnit || firstQuantity.unit || firstItem.default_unit || 'm');
  let totalBaseLengthM = 0;
  let totalDisplayQuantity = 0;

  for (let i = 0; i < list.length; i += 1) {
    const filmState = getFilmDisplayState(list[i], displayUnit);
    totalBaseLengthM += filmState.baseLengthM;
    totalDisplayQuantity += filmState.displayQuantity;
  }

  return {
    baseLengthM: roundNumber(totalBaseLengthM, 2),
    displayQuantity: roundNumber(totalDisplayQuantity, displayUnit === '卷' ? 3 : 2),
    displayUnit
  };
}

module.exports = {
  roundNumber,
  normalizeFilmUnit,
  getFilmDisplayQuantityFromBaseLength,
  buildFilmInventoryState,
  getFilmDisplayState,
  summarizeFilmDisplayQuantities
};
