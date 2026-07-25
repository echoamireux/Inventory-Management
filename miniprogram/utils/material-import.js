const {
  getAllowedUnits,
  getDefaultUnit,
  normalizeUnitInput
} = require('./material-units');
const {
  normalizeProductCodeInput
} = require('./product-code');

function normalizeTestMaterialFlag(value) {
  if (value === true) {
    return { ok: true, value: true };
  }
  if (value === false || value === undefined || value === null) {
    return { ok: true, value: false };
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return { ok: true, value: false };
  }
  if (['是', 'true', 'TRUE', '1', 'Y', 'y', 'yes', 'YES'].includes(raw)) {
    return { ok: true, value: true };
  }
  if (['否', 'false', 'FALSE', '0', 'N', 'n', 'no', 'NO'].includes(raw)) {
    return { ok: true, value: false };
  }

  return {
    ok: false,
    value: false,
    msg: '是否测试料仅支持填写“是”或“否”'
  };
}

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

function normalizeTestMaterialSupplierModel(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/\s*([-/])\s*/gu, '$1');
}

const MATERIAL_IMPORT_COLUMN_INDEX = {
  is_test_material: 0,
  category: 1,
  code_prefix: 2,
  product_code_number: 3,
  material_name: 4,
  sub_category: 5,
  default_unit: 6,
  package_type: 7,
  thickness_um: 8,
  standard_width_mm: 9,
  supplier: 10,
  supplier_model: 11
};

function isTemplateInlineHintRow(row = []) {
  return String(row[MATERIAL_IMPORT_COLUMN_INDEX.is_test_material] || '').includes('是/否')
    && String(row[MATERIAL_IMPORT_COLUMN_INDEX.category] || '').trim() === '必填'
    && String(row[MATERIAL_IMPORT_COLUMN_INDEX.package_type] || '').includes('化材选填')
    && String(row[MATERIAL_IMPORT_COLUMN_INDEX.thickness_um] || '').includes('膜材必填')
    && String(row[MATERIAL_IMPORT_COLUMN_INDEX.standard_width_mm] || '').includes('膜材选填');
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
  const isTestMaterial = !!item.is_test_material;
  return JSON.stringify({
    material_name: String(item.material_name || '').trim(),
    category: item.category || '',
    sub_category: String(item.sub_category || '').trim(),
    default_unit: String(item.default_unit || '').trim(),
    package_type: String(item.package_type || '').trim(),
    thickness_um: item.thickness_um == null ? null : Number(item.thickness_um),
    standard_width_mm: item.standard_width_mm == null ? null : Number(item.standard_width_mm),
    supplier: String(item.supplier || '').trim(),
    supplier_model: String(item.supplier_model || '').trim(),
    is_test_material: isTestMaterial
  });
}

function applyImportDuplicateGuards(rows = []) {
  const nextRows = Array.isArray(rows)
    ? rows.map(item => ({ ...item }))
    : [];
  const rowsByIdentityKey = new Map();
  const rowsByNumericCode = new Map();

  nextRows.forEach((item, index) => {
    if (!item || !item.product_code) {
      return;
    }
    const productCode = String(item.product_code).trim();
    const productCodeNumber = String(item.product_code_number || '').trim();
    const isTestMaterial = !!item.is_test_material;
    const supplierModel = normalizeTestMaterialSupplierModel(item.supplier_model);
    const identityKey = isTestMaterial
      ? `${productCode}::test-model::${supplierModel}`
      : productCode;

    if (!rowsByIdentityKey.has(identityKey)) {
      rowsByIdentityKey.set(identityKey, []);
    }
    rowsByIdentityKey.get(identityKey).push(index);

    if (productCodeNumber) {
      if (!rowsByNumericCode.has(productCodeNumber)) {
        rowsByNumericCode.set(productCodeNumber, []);
      }
      rowsByNumericCode.get(productCodeNumber).push(index);
    }
  });

  rowsByIdentityKey.forEach((indexes) => {
    if (indexes.length < 2) {
      return;
    }

    const validIndexes = indexes.filter(index => !nextRows[index].error);
    if (validIndexes.length < 2) {
      return;
    }

    const signatures = new Set(validIndexes.map(index => buildComparableSignature(nextRows[index])));
    const firstRow = nextRows[validIndexes[0]] || {};
    const identityLabel = firstRow.is_test_material
      ? `测试料 ${firstRow.product_code} + 原厂型号 ${firstRow.supplier_model || '-'}`
      : `产品代码 ${firstRow.product_code}`;
    if (signatures.size === 1) {
      const warning = `${identityLabel} 在本次导入文件中重复，导入时将仅保留第一条，其余重复行自动跳过`;
      validIndexes.forEach((index) => {
        nextRows[index].warning = appendWarning(nextRows[index].warning, warning);
      });
      return;
    }

    const conflictFieldLabel = firstRow.is_test_material ? '字段' : '主数据字段';
    const error = `${identityLabel} 在本次导入文件中重复，且${conflictFieldLabel}不一致，请统一后再导入`;
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
    const productCode = String(item && item.product_code ? item.product_code : '').trim();
    const rowIndex = Number(item && item.rowIndex ? item.rowIndex : 0) || 0;
    const previewKey = [rowIndex, productCode, error || 'ok', warning || 'clear'].join(':');

    return {
      ...item,
      error,
      warning,
      previewKey,
      hasError: !!error,
      hasWarning: !!warning
    };
  });
}

function validateImportRow(row, index, subcategoriesByCategory = {}, productCodePrefixes = []) {
  const oldTemplateLooksLikely = /^[A-Z]{1,4}-\d{3}$/i.test(String(row[0] || '').trim())
    && !!normalizeCategoryText(String(row[2] || '').trim());
  if (oldTemplateLooksLikely) {
    return {
      rowIndex: index + 2,
      product_code: '',
      product_code_prefix: '',
      product_code_number: '',
      material_name: String(row[1] || '').trim(),
      category: normalizeCategoryText(String(row[2] || '').trim()),
      sub_category: String(row[3] || '').trim(),
      default_unit: '',
      package_type: '',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '',
      supplier_model: '',
      is_test_material: false,
      warning: '',
      error: '请使用最新版物料导入模板：产品代码已拆分为“代码前缀”和“产品编号”两列'
    };
  }

  const testMaterialFlag = normalizeTestMaterialFlag(row[MATERIAL_IMPORT_COLUMN_INDEX.is_test_material]);
  const categoryText = String(row[MATERIAL_IMPORT_COLUMN_INDEX.category] || '').trim();
  const rawCodePrefix = String(row[MATERIAL_IMPORT_COLUMN_INDEX.code_prefix] || '').trim();
  const rawProductCodeNumber = String(row[MATERIAL_IMPORT_COLUMN_INDEX.product_code_number] || '').trim();
  const materialName = String(row[MATERIAL_IMPORT_COLUMN_INDEX.material_name] || '').trim();
  const subCategory = String(row[MATERIAL_IMPORT_COLUMN_INDEX.sub_category] || '').trim();
  let defaultUnit = String(row[MATERIAL_IMPORT_COLUMN_INDEX.default_unit] || '').trim();
  const packageType = String(row[MATERIAL_IMPORT_COLUMN_INDEX.package_type] || '').trim();
  const thicknessUm = normalizeOptionalNumber(row[MATERIAL_IMPORT_COLUMN_INDEX.thickness_um]);
  const standardWidthMm = normalizeOptionalNumber(row[MATERIAL_IMPORT_COLUMN_INDEX.standard_width_mm]);
  const supplier = String(row[MATERIAL_IMPORT_COLUMN_INDEX.supplier] || '').trim();
  const supplierModel = String(row[MATERIAL_IMPORT_COLUMN_INDEX.supplier_model] || '').trim();
  let warning = '';

  let error = null;
  const category = normalizeCategoryText(categoryText);

  if (!category) {
    error = '类别必须为"化材"或"膜材"';
  }

  const normalizedCode = error
    ? { ok: false, msg: error }
    : normalizeProductCodeInput(category, rawProductCodeNumber, {
      prefix: rawCodePrefix,
      allowedPrefixes: productCodePrefixes,
      strictPrefix: true
    });

  if (!error && !rawCodePrefix) {
    error = '代码前缀必填';
  } else if (!error && !/^[A-Z]{1,4}$/i.test(rawCodePrefix)) {
    error = '代码前缀只能填写 1-4 位大写英文字母，例如 J、JP、LAB';
  }

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
    warning = '默认幅宽未填写，后续需在首次入库或主数据管理中补齐';
  }

  if (!error && !testMaterialFlag.ok) {
    error = testMaterialFlag.msg;
  }
  if (!error && testMaterialFlag.value && !normalizeTestMaterialSupplierModel(supplierModel)) {
    error = '测试料原厂型号必填';
  }

  return {
    rowIndex: index + 2,
    product_code: normalizedCode.ok ? normalizedCode.product_code : '',
    product_code_prefix: normalizedCode.ok ? normalizedCode.prefix : '',
    product_code_number: normalizedCode.ok ? normalizedCode.number : '',
    material_name: materialName,
    category,
    sub_category: subCategory,
    default_unit: defaultUnit,
    package_type: category === 'chemical' ? packageType : '',
    thickness_um: category === 'film' ? thicknessUm : null,
    standard_width_mm: category === 'film' ? standardWidthMm : null,
    supplier,
    supplier_model: testMaterialFlag.value ? normalizeTestMaterialSupplierModel(supplierModel) : supplierModel,
    is_test_material: testMaterialFlag.value,
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
  MATERIAL_IMPORT_COLUMN_INDEX,
  normalizeCategoryText,
  isTemplateInlineHintRow,
  applyImportDuplicateGuards,
  decorateImportPreviewRows,
  validateImportRow,
  buildImportResultMessage
};
