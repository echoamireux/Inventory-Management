function getPositiveThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeChemicalQuantity(value, unit) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return null;
  }

  switch (String(unit || '').trim()) {
    case 'g':
      return { dimension: 'mass', value: quantity };
    case 'kg':
      return { dimension: 'mass', value: quantity * 1000 };
    case 'mL':
      return { dimension: 'volume', value: quantity };
    case 'L':
      return { dimension: 'volume', value: quantity * 1000 };
    default:
      return null;
  }
}

function isChemicalLowStock(value, unit, alertConfig = {}) {
  const normalized = normalizeChemicalQuantity(value, unit);
  if (!normalized) {
    return false;
  }

  const chemicalConfig = alertConfig.LOW_STOCK && alertConfig.LOW_STOCK.chemical;
  const threshold = getPositiveThreshold(
    normalized.dimension === 'mass'
      ? chemicalConfig && chemicalConfig.mass_g
      : chemicalConfig && chemicalConfig.volume_ml
  );
  return threshold !== null && normalized.value <= threshold;
}

function isFilmLowStock(baseLengthM, alertConfig = {}) {
  const length = Number(baseLengthM);
  const filmConfig = alertConfig.LOW_STOCK && alertConfig.LOW_STOCK.film;
  const threshold = getPositiveThreshold(filmConfig && filmConfig.length_m);
  return Number.isFinite(length) && length >= 0 && threshold !== null && length <= threshold;
}

module.exports = {
  normalizeChemicalQuantity,
  isChemicalLowStock,
  isFilmLowStock
};
