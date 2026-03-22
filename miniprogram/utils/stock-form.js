function getMaterialSubmitValidationMessage(form = {}) {
  const batchNumber = String(form.batch_number || '').trim();
  const zoneKey = String(form.zone_key || '').trim();

  if (!batchNumber) {
    return '请填写生产批号';
  }

  if (!zoneKey) {
    return '请选择存储区域';
  }

  return '';
}

function hasFilledValue(value) {
  return String(value == null ? '' : value).trim() !== '';
}

function getCategorySpecificValidationMessage(category, form = {}) {
  const isFilm = category === 'film';
  const hasExplicitValidity = !!form.is_long_term_valid || hasFilledValue(form.expiry_date);

  if (isFilm) {
    if (!hasFilledValue(form.thickness_um)) {
      return '请填写厚度';
    }

    if (!hasFilledValue(form.width_mm)) {
      return '请填写宽度';
    }

    if (!hasFilledValue(form.length_m)) {
      return '请填写长度';
    }

    if (!hasFilledValue(form.unit)) {
      return '请选择计价单位';
    }

    if (!hasExplicitValidity) {
      return '请选择过期日期';
    }

    return '';
  }

  if (!hasFilledValue(form.net_content)) {
    return '请填写净含量';
  }

  if (!hasFilledValue(form.unit)) {
    return '请选择单位';
  }

  if (!hasExplicitValidity) {
    return '请选择过期日期';
  }

  return '';
}

module.exports = {
  getMaterialSubmitValidationMessage,
  getCategorySpecificValidationMessage
};
