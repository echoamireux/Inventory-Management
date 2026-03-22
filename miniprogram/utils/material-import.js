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

function validateImportRow(row, index, subcategoriesByCategory = {}) {
  const rawProductCode = String(row[0] || '').trim();
  const materialName = String(row[1] || '').trim();
  const categoryText = String(row[2] || '').trim();
  const subCategory = String(row[3] || '').trim();
  const hasLegacyNoteColumn = row.length >= 9;
  const unitIndex = hasLegacyNoteColumn ? 5 : 4;
  const supplierIndex = hasLegacyNoteColumn ? 6 : 5;
  const supplierModelIndex = hasLegacyNoteColumn ? 7 : 6;
  let defaultUnit = String(row[unitIndex] || '').trim();
  const supplier = String(row[supplierIndex] || '').trim();
  const supplierModel = String(row[supplierModelIndex] || '').trim();

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

  return {
    rowIndex: index + 2,
    product_code: normalizedCode.ok ? normalizedCode.product_code : '',
    product_code_number: normalizedCode.ok ? normalizedCode.number : '',
    material_name: materialName,
    category,
    sub_category: subCategory,
    default_unit: defaultUnit,
    supplier,
    supplier_model: supplierModel,
    error
  };
}

function buildImportResultMessage(result = {}, previewErrors = []) {
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

  return lines.join('\n');
}

module.exports = {
  normalizeCategoryText,
  validateImportRow,
  buildImportResultMessage
};
