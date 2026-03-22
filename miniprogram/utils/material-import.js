const {
  getAllowedUnits,
  getDefaultUnit,
  normalizeUnitInput
} = require('./material-units');
const {
  normalizeProductCodeInput
} = require('./product-code');

function normalizeCategoryText(categoryText) {
  if (String(categoryText || '').trim() === '膜材') {
    return 'film';
  }
  if (String(categoryText || '').trim() === '化材') {
    return 'chemical';
  }
  return '';
}

function normalizeOptionalNumber(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) {
    return null;
  }

  const normalized = Number(raw);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
}

function isTemplateInlineHintRow(row = []) {
  return String(row[0] || '').trim() === '两类必填'
    && String(row[6] || '').includes('膜材必填')
    && String(row[7] || '').includes('膜材选填');
}

function validateImportRow(row, index, subcategoriesByCategory = {}) {
  const rawProductCode = String(row[0] || '').trim();
  const materialName = String(row[1] || '').trim();
  const categoryText = String(row[2] || '').trim();
  const subCategory = String(row[3] || '').trim();
  const usesMasterTemplate = row.length >= 10;
  let defaultUnit = String(row[4] || '').trim();
  const packageType = String((usesMasterTemplate ? row[5] : '') || '').trim();
  const thicknessUm = normalizeOptionalNumber(usesMasterTemplate ? row[6] : '');
  const standardWidthMm = normalizeOptionalNumber(usesMasterTemplate ? row[7] : '');
  const supplier = String((usesMasterTemplate ? row[8] : row[5]) || '').trim();
  const supplierModel = String((usesMasterTemplate ? row[9] : row[6]) || '').trim();
  let warning = '';

  let error = null;
  const category = normalizeCategoryText(categoryText);

  if (!category) {
    error = '类别必须为"化材"或"膜材"';
  }

  const normalizedCode = error
    ? { ok: false, msg: error }
    : normalizeProductCodeInput(category, rawProductCode);

  if (!error && !normalizedCode.ok) {
    error = normalizedCode.msg;
  } else if (!materialName) {
    error = '物料名称必填';
  } else if (!subCategory) {
    error = '子类别必填';
  }

  const validSubs = category ? (subcategoriesByCategory[category] || []) : [];
  if (!error && !validSubs.includes(subCategory)) {
    error = '子类别无效，请填写系统内已启用的正式子类别';
  }

  if (!error) {
    const normalizedUnit = normalizeUnitInput(category, defaultUnit);
    if (!normalizedUnit.ok) {
      const validUnits = getAllowedUnits(category);
      error = `单位无效，请选择：${validUnits.join('、')}`;
    } else {
      defaultUnit = normalizedUnit.unit || getDefaultUnit(category);
    }
  }

  if (!error && category === 'film' && thicknessUm === null) {
    error = '膜材厚度必填';
  }

  if (!error && category === 'film' && standardWidthMm === null) {
    warning = '默认幅宽未填写，后续需在首次入库或物料管理中补齐';
  }

  return {
    rowIndex: index + 2,
    product_code: normalizedCode.ok ? normalizedCode.product_code : '',
    product_code_number: normalizedCode.ok ? normalizedCode.number : '',
    material_name: materialName,
    category,
    sub_category: subCategory,
    default_unit: defaultUnit,
    package_type: category === 'chemical' ? packageType : '',
    thickness_um: category === 'film' ? thicknessUm : null,
    standard_width_mm: category === 'film' ? standardWidthMm : null,
    supplier,
    supplier_model: supplierModel,
    warning,
    error
  };
}

function buildImportResultMessage(result = {}, previewErrors = [], previewWarnings = []) {
  const created = Number(result.created || 0);
  const skipped = Number(result.skipped || 0);
  const runtimeErrors = Number(result.errors || 0);
  const errors = runtimeErrors + previewErrors.length;
  const results = Array.isArray(result.results) ? result.results : [];

  const lines = [`成功导入 ${created} 条`];
  if (skipped > 0) {
    lines.push(`跳过 ${skipped} 条重复或无需新建的数据`);
  }
  if (errors > 0) {
    lines.push(`失败 ${errors} 条`);
  }

  const detailLines = results
    .filter(item => item.status === 'skipped' || item.status === 'error')
    .map((item) => {
      const rowLabel = item.rowIndex ? `第 ${item.rowIndex} 行` : '未知行';
      const codeLabel = item.product_code || '-';
      const statusLabel = item.status === 'skipped' ? '已跳过' : '失败';
      const reason = item.reason || '未说明原因';
      return `${rowLabel} | ${codeLabel} | ${statusLabel}：${reason}`;
    });

  previewErrors.forEach((item) => {
    const rowLabel = item.rowIndex ? `第 ${item.rowIndex} 行` : '未知行';
    const codeLabel = item.product_code || item.product_code_number || '-';
    const reason = item.error || '预校验失败';
    detailLines.push(`${rowLabel} | ${codeLabel} | 失败：${reason}`);
  });

  const warningLines = previewWarnings.map((item) => {
    const rowLabel = item.rowIndex ? `第 ${item.rowIndex} 行` : '未知行';
    const codeLabel = item.product_code || item.product_code_number || '-';
    const reason = item.warning || '请补充完善后续主数据';
    return `${rowLabel} | ${codeLabel} | 提醒：${reason}`;
  });

  const visibleDetails = detailLines.slice(0, 20);
  const hiddenCount = detailLines.length - visibleDetails.length;

  if (visibleDetails.length > 0) {
    lines.push('');
    lines.push('明细：');
    lines.push(...visibleDetails);
    if (hiddenCount > 0) {
      lines.push(`……其余 ${hiddenCount} 条请分批处理或缩小单次导入范围后重试`);
    }
  }

  if (warningLines.length > 0) {
    lines.push('');
    lines.push('提醒：');
    lines.push(...warningLines);
  }

  return lines.join('\n');
}

module.exports = {
  normalizeCategoryText,
  isTemplateInlineHintRow,
  validateImportRow,
  buildImportResultMessage
};
