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
      ok: false,
      msg: '请选择默认单位'
    };
  }

  if (getAllowedUnits(category).includes(value)) {
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
  normalizeUnitInput
};
