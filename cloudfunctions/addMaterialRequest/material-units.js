const CHEMICAL_UNITS = ['g', 'kg', 'mL', 'L'];
const FILM_UNITS = ['m', 'm²'];

function getAllowedUnits(category) {
  if (category === 'chemical') {
    return [...CHEMICAL_UNITS];
  }
  if (category === 'film') {
    return [...FILM_UNITS];
  }
  return [];
}

function getDefaultUnit(category) {
  if (category === 'chemical') {
    return 'g';
  }
  if (category === 'film') {
    return 'm';
  }
  return '';
}

function isAllowedUnit(category, unit) {
  const value = String(unit || '').trim();
  if (!value) {
    return false;
  }
  return getAllowedUnits(category).includes(value);
}

function getInvalidUnitMessage(category) {
  if (category === 'chemical') {
    return '化材默认单位仅支持 g / kg / mL / L';
  }
  if (category === 'film') {
    return '膜材默认单位仅支持 m / m²';
  }
  return '默认单位不合法';
}

function normalizeUnitInput(category, unit) {
  const value = String(unit || '').trim();
  if (!value) {
    return {
      ok: false,
      msg: '请选择默认单位'
    };
  }

  if (isAllowedUnit(category, value)) {
    return {
      ok: true,
      unit: value
    };
  }

  return {
    ok: false,
    msg: getInvalidUnitMessage(category)
  };
}

module.exports = {
  CHEMICAL_UNITS,
  FILM_UNITS,
  getAllowedUnits,
  getDefaultUnit,
  isAllowedUnit,
  getInvalidUnitMessage,
  normalizeUnitInput
};
