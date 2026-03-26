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

module.exports = {
  roundNumber,
  normalizeFilmUnit,
  getFilmDisplayQuantityFromBaseLength,
  buildFilmInventoryState
};
