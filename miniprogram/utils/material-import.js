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
  return String(row[0] || '').trim() === '必填'
    && String(row[5] || '').includes('化材选填')
    && String(row[6] || '').includes('膜材必填')
    && String(row[7] || '').includes('膜材选填');
}

function appendWarning(existingWarning = '', nextWarning = '') {
  const current = String(existingWarning || '').trim();
  const incoming = String(nextWarning || '').trim();
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (current.includes(incoming)) {
    return current;
  }
  return `${current}；${incoming}`;
}

function buildComparableSignature(item = {}) {
  return JSON.stringify({
    material_name: String(item.material_name || '').trim(),
    category: item.category || '',
    sub_category: String(item.sub_category || '').trim(),
    default_unit: String(item.default_unit || '').trim(),
    package_type: String(item.package_type || '').trim(),
    thickness_um: item.thickness_um == null ? null : Number(item.thickness_um),
    standard_width_mm: item.standard_width_mm == null ? null : Number(item.standard_width_mm),
    supplier: String(item.supplier || '').trim(),
    supplier_model: String(item.supplier_model || '').trim()
  });
}

function applyImportDuplicateGuards(rows = []) {
  const nextRows = Array.isArray(rows)
    ? rows.map(item => ({ ...item }))
    : [];
  const rowsByProductCode = new Map();
  const rowsByNumericCode = new Map();

  nextRows.forEach((item, index) => {
    if (!item || !item.product_code) {
      return;
    }
    const productCode = String(item.product_code).trim();
    const productCodeNumber = String(item.product_code_number || '').trim();

    if (!rowsByProductCode.has(productCode)) {
      rowsByProductCode.set(productCode, []);
    }
    rowsByProductCode.get(productCode).push(index);

    if (productCodeNumber) {
      if (!rowsByNumericCode.has(productCodeNumber)) {
        rowsByNumericCode.set(productCodeNumber, []);
      }
      rowsByNumericCode.get(productCodeNumber).push(index);
    }
  });

  rowsByProductCode.forEach((indexes, productCode) => {
    if (indexes.length < 2) {
      return;
    }

    const validIndexes = indexes.filter(index => !nextRows[index].error);
    if (validIndexes.length < 2) {
      return;
    }

    const signatures = new Set(validIndexes.map(index => buildComparableSignature(nextRows[index])));
    if (signatures.size === 1) {
      const warning = `产品代码 ${productCode} 在本次导入文件中重复，导入时将仅保留第一条，其余重复行自动跳过`;
      validIndexes.forEach((index) => {
        nextRows[index].warning = appendWarning(nextRows[index].warning, warning);
      });
      return;
    }

    const error = `产品代码 ${productCode} 在本次导入文件中重复，且主数据字段不一致，请统一后再导入`;
    validIndexes.forEach((index) => {
      nextRows[index].error = error;
      nextRows[index].warning = '';
    });
  });

  rowsByNumericCode.forEach((indexes, codeNumber) => {
    if (indexes.length < 2) {
      return;
    }

    const categories = Array.from(new Set(indexes
      .map(index => nextRows[index].category)
      .filter(Boolean)));
    if (categories.length < 2) {
      return;
    }

    const warning = `编号 ${codeNumber} 同时出现在化材和膜材中，请确认类别填写无误`;
    indexes.forEach((index) => {
      if (nextRows[index].error) {
        return;
      }
      nextRows[index].warning = appendWarning(nextRows[index].warning, warning);
    });
  });

  return nextRows;
}

function decorateImportPreviewRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const error = String(item && item.error ? item.error : '').trim();
    const warning = String(item && item.warning ? item.warning : '').trim();

    return {
      ...item,
      error,
      warning,
      hasError: !!error,
      hasWarning: !!warning
    };
  });
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
  applyImportDuplicateGuards,
  decorateImportPreviewRows,
  validateImportRow,
  buildImportResultMessage
};
