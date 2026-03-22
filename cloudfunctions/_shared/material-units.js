const CHEMICAL_UNITS = ['kg', 'g', 'L', 'mL'];
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
    return 'kg';
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
    return '化材默认单位仅支持 kg / g / L / mL';
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
      ok: true,
      unit: getDefaultUnit(category)
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

function buildUnitFieldState(category, currentUnit) {
  const value = String(currentUnit || '').trim();
  const options = getAllowedUnits(category);
  const isCurrentUnitValid = !!value && options.includes(value);

  return {
    options,
    value: value || getDefaultUnit(category),
    selectedIndex: isCurrentUnitValid ? options.indexOf(value) : 0,
    isCurrentUnitValid
  };
}

module.exports = {
  CHEMICAL_UNITS,
  FILM_UNITS,
  getAllowedUnits,
  getDefaultUnit,
  isAllowedUnit,
  getInvalidUnitMessage,
  normalizeUnitInput,
  buildUnitFieldState
};
