const PRODUCT_CODE_DIGITS = 3;
const CHEMICAL_UNITS = ['kg', 'g', 'L', 'mL'];
const FILM_UNITS = ['m', 'm²'];
const NEW_TEMPLATE_COLUMN_COUNT = 15;
const INVENTORY_TEMPLATE_GROUP_HEADER_ROW = ['基础信息', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '时效信息', ''];
const INVENTORY_TEMPLATE_HEADER_ROW = ['标签编号*', '产品代码*', '类别*', '生产批号*', '存储区域*', '详细坐标', '净含量', '包装形式', '膜材厚度(μm)', '本批次实际幅宽(mm)', '长度(m)', '供应商', '原厂型号', '过期日期', '长期有效'];
const INVENTORY_TEMPLATE_INLINE_HINT_ROW = ['必填', '必填', '必填', '必填', '必填', '选填', '化材必填', '化材选填', '膜材条件必填', '膜材必填', '膜材必填', '选填', '选填', '二选一', '二选一'];
const INVALID_TEMPLATE_HEADER_MSG = '库存入库表字段顺序不正确，请使用系统当前模板中的正式字段行';
const LEGACY_TEMPLATE_RUNTIME_MSG = '当前云函数与前端模板协议不一致，请部署最新版 importInventoryTemplate';
const INVENTORY_TEMPLATE_SCHEMA_VERSION = 'inventory-import-v2';
const EMPTY_INVENTORY_TEMPLATE_ROWS_HINT = '未检测到数据行，请从第 4 行开始填写后直接上传 .xlsx 文件';
const BUILTIN_ZONE_SEEDS = [
  { zone_key: 'builtin:chemical:lab1', name: '实验室1', scope: 'chemical', status: 'active', sort_order: 10 },
  { zone_key: 'builtin:chemical:lab2', name: '实验室2', scope: 'chemical', status: 'active', sort_order: 20 },
  { zone_key: 'builtin:chemical:lab3', name: '实验室3', scope: 'chemical', status: 'active', sort_order: 30 },
  { zone_key: 'builtin:chemical:store-room', name: '物料间', scope: 'chemical', status: 'active', sort_order: 40 },
  { zone_key: 'builtin:film:rnd1', name: '研发仓1', scope: 'film', status: 'active', sort_order: 110 },
  { zone_key: 'builtin:film:rnd2', name: '研发仓2', scope: 'film', status: 'active', sort_order: 120 },
  { zone_key: 'builtin:film:line', name: '实验线', scope: 'film', status: 'active', sort_order: 130 }
];

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatDisplayNumber(value, digits = 3) {
  const rounded = roundNumber(value, digits);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded).replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function normalizePositiveNumber(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }
  const normalized = Number(raw);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function normalizeLabelCodeInput(value) {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) {
    return '';
  }
  if (/^\d{1,6}$/u.test(raw)) {
    return `L${raw.padStart(6, '0')}`;
  }
  const partialMatch = raw.match(/^L(\d{1,6})$/u);
  if (partialMatch) {
    return `L${partialMatch[1].padStart(6, '0')}`;
  }
  return raw;
}

function isValidLabelCode(value) {
  return /^L\d{6}$/u.test(normalizeText(value).toUpperCase());
}

function normalizeInventoryCategoryText(categoryText) {
  const value = normalizeText(categoryText);
  if (value === '化材') {
    return 'chemical';
  }
  if (value === '膜材') {
    return 'film';
  }
  return '';
}

function getProductCodePrefix(category) {
  return category === 'film' ? 'M-' : 'J-';
}

function normalizeProductCodeInput(category, rawInput) {
  const prefix = getProductCodePrefix(category);
  const rawValue = normalizeText(rawInput).toUpperCase();

  if (!rawValue) {
    return { ok: false, msg: '产品代码必填' };
  }

  let digits = rawValue;
  if (rawValue.startsWith('J-') || rawValue.startsWith('M-')) {
    if (!rawValue.startsWith(prefix)) {
      return {
        ok: false,
        msg: category === 'film' ? '膜材产品代码必须使用 M- 前缀' : '化材产品代码必须使用 J- 前缀'
      };
    }
    digits = rawValue.slice(2);
  }

  if (!new RegExp(`^\\d{1,${PRODUCT_CODE_DIGITS}}$`, 'u').test(digits)) {
    return { ok: false, msg: `产品代码必须为 1-${PRODUCT_CODE_DIGITS} 位数字` };
  }

  const number = digits.padStart(PRODUCT_CODE_DIGITS, '0');
  return {
    ok: true,
    number,
    product_code: `${prefix}${number}`
  };
}

function getAllowedUnits(category) {
  return category === 'film' ? FILM_UNITS.slice() : CHEMICAL_UNITS.slice();
}

function normalizeUnitInput(category, unit) {
  const value = normalizeText(unit);
  if (!value) {
    return {
      ok: false,
      msg: '单位必填'
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
    msg: category === 'film'
      ? '膜材默认单位仅支持 m / m²'
      : '化材默认单位仅支持 kg / g / L / mL'
  };
}

function normalizeFilmUnit(unit) {
  const normalized = normalizeText(unit).toLowerCase();
  if (normalized === 'm' || normalized === '米') return 'm';
  if (normalized === 'm²' || normalized === '㎡' || normalized === 'm2' || normalized === '平方米') return 'm²';
  if (normalized === '卷' || normalized === 'roll' || normalized === '卷装') return '卷';
  return normalizeText(unit) || 'm';
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

function getFilmThicknessLockedMessage(thicknessUm) {
  return `当前物料厚度已锁定为 ${thicknessUm} μm，请按主数据入库；如需修改请联系管理员在物料管理中调整`;
}

function resolveFilmThicknessGovernance({ materialThicknessUm, inboundThicknessUm }) {
  const normalizedMaterialThicknessUm = Number(materialThicknessUm) > 0 ? Number(materialThicknessUm) : 0;
  const normalizedInboundThicknessUm = Number(inboundThicknessUm) > 0 ? Number(inboundThicknessUm) : 0;

  if (
    normalizedMaterialThicknessUm
    && normalizedInboundThicknessUm
    && normalizedMaterialThicknessUm !== normalizedInboundThicknessUm
  ) {
    throw new Error(getFilmThicknessLockedMessage(normalizedMaterialThicknessUm));
  }

  return {
    materialThicknessUm: normalizedMaterialThicknessUm,
    inboundThicknessUm: normalizedInboundThicknessUm,
    resolvedThicknessUm: normalizedMaterialThicknessUm || normalizedInboundThicknessUm,
    shouldBackfillMasterThickness: !normalizedMaterialThicknessUm && !!normalizedInboundThicknessUm
  };
}

function extractMaterialThickness(material = {}) {
  const specs = material.specs || {};
  return Number(specs.thickness_um) > 0 ? Number(specs.thickness_um) : 0;
}

function extractMaterialWidth(material = {}) {
  const specs = material.specs || {};
  const width = specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm;
  return Number(width) > 0 ? Number(width) : 0;
}

function composeLocation(zoneName, detail) {
  const safeZoneName = normalizeText(zoneName);
  const safeDetail = normalizeText(detail);
  if (!safeZoneName) {
    return '';
  }
  return safeDetail ? `${safeZoneName} | ${safeDetail}` : safeZoneName;
}

function normalizeDateInput(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return {
      ok: true,
      value: ''
    };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      msg: '过期日期格式不正确'
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  if (parsed.getTime() < today.getTime()) {
    return {
      ok: false,
      msg: '过期日期不能早于当天'
    };
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return {
    ok: true,
    value: `${year}-${month}-${day}`
  };
}

function parseLongTermValue(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return {
      ok: true,
      value: false
    };
  }

  if (['是', 'true', 'TRUE', '1', 'Y', 'y', 'yes', 'YES', '长期有效'].includes(raw)) {
    return {
      ok: true,
      value: true
    };
  }

  if (['否', 'false', 'FALSE', '0', 'N', 'n', 'no', 'NO'].includes(raw)) {
    return {
      ok: true,
      value: false
    };
  }

  return {
    ok: false,
    msg: '长期有效列仅支持填写“是”或留空'
  };
}

function appendNotice(current, next) {
  const safeCurrent = normalizeText(current);
  const safeNext = normalizeText(next);
  if (!safeNext) {
    return safeCurrent;
  }
  if (!safeCurrent) {
    return safeNext;
  }
  if (safeCurrent.includes(safeNext)) {
    return safeCurrent;
  }
  return `${safeCurrent}；${safeNext}`;
}

function normalizeComparableNumber(value, digits = 3) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return '';
  }
  return String(roundNumber(normalized, digits));
}

function buildChemicalDuplicateSignature(productCode, batchNumber, quantityVal, quantityUnit) {
  const safeProductCode = normalizeText(productCode);
  const safeBatchNumber = normalizeText(batchNumber);
  const safeQuantityVal = normalizeComparableNumber(quantityVal);
  const safeQuantityUnit = normalizeText(quantityUnit);

  if (!safeProductCode || !safeBatchNumber || !safeQuantityVal || !safeQuantityUnit) {
    return '';
  }

  return ['chemical', safeProductCode, safeBatchNumber, safeQuantityVal, safeQuantityUnit].join('|');
}

function buildFilmDuplicateSignature(productCode, batchNumber, lengthM, widthMm, quantityUnit) {
  const safeProductCode = normalizeText(productCode);
  const safeBatchNumber = normalizeText(batchNumber);
  const safeLengthM = normalizeComparableNumber(lengthM);
  const safeWidthMm = normalizeComparableNumber(widthMm);
  const safeQuantityUnit = normalizeText(quantityUnit);

  if (!safeProductCode || !safeBatchNumber || !safeLengthM || !safeWidthMm || !safeQuantityUnit) {
    return '';
  }

  return ['film', safeProductCode, safeBatchNumber, safeLengthM, safeWidthMm, safeQuantityUnit].join('|');
}

function buildPreviewDuplicateSignature(row = {}) {
  if (row.category === 'film') {
    return buildFilmDuplicateSignature(
      row.product_code,
      row.batch_number,
      row.length_m,
      row.batch_width_mm,
      row.quantity_unit
    );
  }

  return buildChemicalDuplicateSignature(
    row.product_code,
    row.batch_number,
    row.net_content,
    row.quantity_unit
  );
}

function buildInventoryDuplicateSignature(item = {}, fallbackCategory = '') {
  const category = normalizeText(item.category || fallbackCategory);
  const quantity = item.quantity || {};
  const dynamicAttrs = item.dynamic_attrs || {};

  if (category === 'film') {
    return buildFilmDuplicateSignature(
      item.product_code,
      item.batch_number,
      dynamicAttrs.current_length_m,
      dynamicAttrs.width_mm,
      quantity.unit
    );
  }

  return buildChemicalDuplicateSignature(
    item.product_code,
    item.batch_number,
    quantity.val,
    quantity.unit
  );
}

function buildPotentialDuplicateWarning(row = {}, currentInventoryByProductCode = new Map()) {
  const signature = buildPreviewDuplicateSignature(row);
  if (!signature) {
    return '';
  }

  const productCode = normalizeText(row.product_code);
  const candidates = productCode
    ? (currentInventoryByProductCode.get(productCode) || [])
    : [];

  const matches = candidates.filter((item) => (
    normalizeText(item.status || 'in_stock') === 'in_stock'
    && buildInventoryDuplicateSignature(item, row.category) === signature
  ));

  if (!matches.length) {
    return '';
  }

  const labels = matches
    .map(item => normalizeLabelCodeInput(item.unique_code))
    .filter(Boolean)
    .slice(0, 3);

  if (matches.length === 1) {
    const labelText = labels[0] ? `（标签编号：${labels[0]}）` : '';
    return `当前在库已有 1 条同产品代码、同批号、同数量记录${labelText}，请确认不是重复导入`;
  }

  const labelSummary = labels.length
    ? `（标签编号：${labels.join('、')}${matches.length > 3 ? ` 等 ${matches.length} 条` : ''}）`
    : '';

  return `当前在库已有 ${matches.length} 条同产品代码、同批号、同数量记录${labelSummary}，请确认不是重复导入`;
}

function isArchivedMaterial(material = {}) {
  return ['archived', 'deleted'].includes(normalizeText(material.status));
}

function isInventoryTemplateGroupHeaderRow(row = []) {
  return INVENTORY_TEMPLATE_GROUP_HEADER_ROW.every((value, index) => normalizeText(row[index]) === value);
}

function isInventoryTemplateHeaderRow(row = []) {
  return INVENTORY_TEMPLATE_HEADER_ROW.every((value, index) => normalizeText(row[index]) === value);
}

function isInventoryTemplateInlineHintRow(row = []) {
  return INVENTORY_TEMPLATE_INLINE_HINT_ROW.every((value, index) => normalizeText(row[index]) === value);
}

function normalizeInventoryTemplateValues(rawValues = []) {
  const values = (Array.isArray(rawValues) ? rawValues : []).map(value => normalizeText(value));
  return Array.from({ length: NEW_TEMPLATE_COLUMN_COUNT }, (_, index) => values[index] || '');
}

function summarizeHeader(values = []) {
  return normalizeInventoryTemplateValues(values)
    .map(value => value || '∅')
    .join(' | ');
}

function buildInventoryTemplateHeaderError(rows = []) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(item => item && Array.isArray(item.values))
    .map((item) => ({
      rowIndex: Number(item.rowIndex) || 0,
      values: normalizeInventoryTemplateValues(item.values)
    }))
    .filter(item => item.values.some(value => normalizeText(value)));
  const fallbackRow = candidates[1] || candidates[0] || { rowIndex: 0, values: [] };

  return {
    ok: false,
    code: 'header_mismatch',
    msg: INVALID_TEMPLATE_HEADER_MSG,
    details: {
      headerRowIndex: fallbackRow.rowIndex || 0,
      expectedHeader: INVENTORY_TEMPLATE_HEADER_ROW.slice(),
      actualHeader: fallbackRow.values.slice(0, INVENTORY_TEMPLATE_HEADER_ROW.length),
      actualHeaderSummary: summarizeHeader(fallbackRow.values)
    }
  };
}

function detectInventoryTemplateStructure(rawRows = []) {
  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map((item) => {
      if (item && Array.isArray(item.values)) {
        return {
          rowIndex: Number(item.rowIndex) || 0,
          values: normalizeInventoryTemplateValues(item.values)
        };
      }
      if (Array.isArray(item)) {
        return {
          rowIndex: 0,
          values: normalizeInventoryTemplateValues(item)
        };
      }
      return null;
    })
    .filter(Boolean)
    .filter(item => item.values.some(value => normalizeText(value)));

  if (!rows.length) {
    return {
      rows,
      headerRowIndex: 0,
      dataStartRowIndex: 4
    };
  }

  const headerRow = rows.find(item => isInventoryTemplateHeaderRow(item.values));
  if (!headerRow) {
    return {
      rows,
      error: buildInventoryTemplateHeaderError(rows)
    };
  }

  const rowMap = new Map(rows.map(item => [item.rowIndex, item]));
  let cursor = headerRow.rowIndex;
  const nextRow = rowMap.get(headerRow.rowIndex + 1);
  if (nextRow && !nextRow.values[0].match(/^L\d{6}$/u)) {
    cursor += 1;
  }

  return {
    rows,
    headerRowIndex: headerRow.rowIndex,
    dataStartRowIndex: cursor + 1
  };
}

function resolveMaterialDefaultUnit(category, material = {}) {
  return normalizeUnitInput(category, material.default_unit);
}

function normalizePreviewRowInput(rawRow = {}, fallbackIndex = 0) {
  const rawValues = Array.isArray(rawRow.values)
    ? rawRow.values
    : (Array.isArray(rawRow) ? rawRow : []);
  return {
    rowIndex: Number(rawRow.rowIndex) || fallbackIndex + 2,
    values: normalizeInventoryTemplateValues(rawValues)
  };
}

function validateInventoryTemplateHeaderRows(rawRows = []) {
  const structure = detectInventoryTemplateStructure(rawRows);
  if (structure.error) {
    return structure.error;
  }

  return {
    ok: true,
    msg: '',
    code: '',
    details: {
      headerRowIndex: structure.headerRowIndex || 0,
      dataStartRowIndex: structure.dataStartRowIndex || 4
    }
  };
}

function buildEmptyInventoryTemplatePreviewResult() {
  return {
    success: false,
    msg: EMPTY_INVENTORY_TEMPLATE_ROWS_HINT
  };
}

function collectInventoryImportLookupKeys(rawRows = []) {
  const productCodes = new Set();
  const uniqueCodes = new Set();

  (Array.isArray(rawRows) ? rawRows : []).forEach((item, index) => {
    const row = normalizePreviewRowInput(item, index);
    if (
      isInventoryTemplateGroupHeaderRow(row.values)
      || isInventoryTemplateHeaderRow(row.values)
      || isInventoryTemplateInlineHintRow(row.values)
    ) {
      return;
    }

    const uniqueCode = normalizeLabelCodeInput(row.values[0]);
    if (uniqueCode && isValidLabelCode(uniqueCode)) {
      uniqueCodes.add(uniqueCode);
    }

    const category = normalizeInventoryCategoryText(row.values[2]);
    if (!category) {
      return;
    }
    const normalizedCode = normalizeProductCodeInput(category, row.values[1]);
    if (normalizedCode.ok) {
      productCodes.add(normalizedCode.product_code);
    }
  });

  return {
    productCodes: Array.from(productCodes),
    uniqueCodes: Array.from(uniqueCodes)
  };
}

function buildZoneMapsByCategory(records = []) {
  const normalized = BUILTIN_ZONE_SEEDS
    .concat(Array.isArray(records) ? records : [])
    .filter(item => normalizeText(item.name))
    .filter(item => normalizeText(item.status || 'active') === 'active')
    .sort((left, right) => {
      const leftOrder = Number(left.sort_order || 0);
      const rightOrder = Number(right.sort_order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return normalizeText(left.zone_key || left.name).localeCompare(normalizeText(right.zone_key || right.name));
    });

  const result = {
    chemical: new Map(),
    film: new Map()
  };

  normalized.forEach((item) => {
    const scope = normalizeText(item.scope || 'global');
    const name = normalizeText(item.name);
    const record = {
      zone_key: normalizeText(item.zone_key || item._id || name),
      name,
      scope: scope || 'global'
    };

    if ((scope === 'chemical' || scope === 'global') && !result.chemical.has(name)) {
      result.chemical.set(name, record);
    }
    if ((scope === 'film' || scope === 'global') && !result.film.has(name)) {
      result.film.set(name, record);
    }
  });

  return result;
}

function buildInventoryImportPreviewRow(rawRow = {}, context = {}) {
  const { rowIndex, values } = normalizePreviewRowInput(rawRow);
  const row = {
    rowIndex,
    unique_code: '',
    product_code: '',
    material_id: '',
    material_name: '',
    sub_category: '',
    category: '',
    batch_number: '',
    zone_name: '',
    zone_key: '',
    location_detail: '',
    location: '',
    expiry_date: '',
    is_long_term_valid: false,
    net_content: null,
    quantity_unit: '',
    thickness_um: null,
    batch_width_mm: null,
    length_m: null,
    package_type: '',
    supplier: '',
    supplier_model: '',
    quantity_summary: '',
    error: '',
    warning: ''
  };

  const uniqueCode = normalizeLabelCodeInput(values[0]);
  const category = normalizeInventoryCategoryText(values[2]);
  const longTerm = parseLongTermValue(values[14]);
  const expiryDate = normalizeDateInput(values[13]);

  row.unique_code = uniqueCode || values[0];
  row.category = category;
  row.batch_number = values[3];
  row.zone_name = values[4];
  row.location_detail = values[5];
  row.supplier = values[11];
  row.supplier_model = values[12];
  row.package_type = values[7];

  if (!row.unique_code) {
    row.error = '标签编号必填';
    return row;
  }
  if (!isValidLabelCode(row.unique_code)) {
    row.error = '标签编号格式不正确，应为 L + 6位数字';
    return row;
  }
  if ((context.duplicateUniqueCodes || new Set()).has(row.unique_code)) {
    row.error = `标签编号 ${row.unique_code} 在文件内重复`;
    return row;
  }
  // 标签已存在时的处理：优先检查 existingInventoryByUniqueCode（含在库实体），其次 fallback 到 existingUniqueCodes
  const existingInventoryMap = context.existingInventoryByUniqueCode || new Map();
  const existingItem = existingInventoryMap.get(row.unique_code);

  if (existingItem) {
    // 化材补料条件：在库 + 同产品代码 + 同批号
    if (
      category === 'chemical'
      && normalizeText(existingItem.status) === 'in_stock'
      && normalizeText(existingItem.category) === 'chemical'
    ) {
      const codeCheck = normalizeProductCodeInput(category, values[1]);
      if (
        codeCheck.ok
        && normalizeText(existingItem.product_code) === normalizeText(codeCheck.product_code)
        && normalizeText(existingItem.batch_number) === normalizeText(values[3])
      ) {
        // 化材 refill 流程：标记为补料入库
        row.submit_action = 'refill';
        row.refill_inventory_id = existingItem._id;
        row.warning = appendNotice(row.warning, `标签 ${row.unique_code} 在库，将按补料入库处理`);
        // 不 return，继续后续验证
      } else {
        row.error = `标签编号 ${row.unique_code} 已存在，请勿重复入库`;
        return row;
      }
    } else if (category === 'film') {
      // 膜材不支持补料，保持报错
      row.error = `标签编号 ${row.unique_code} 已存在，膜材不支持补料入库`;
      return row;
    } else {
      row.error = `标签编号 ${row.unique_code} 已存在，请勿重复入库`;
      return row;
    }
  } else if ((context.existingUniqueCodes || new Set()).has(row.unique_code)) {
    // fallback：existingUniqueCodes 有但 existingInventoryByUniqueCode 无详情
    row.error = `标签编号 ${row.unique_code} 已存在，请勿重复入库`;
    return row;
  }
  if (!category) {
    row.error = '类别必须为"化材"或"膜材"';
    return row;
  }

  const normalizedCode = normalizeProductCodeInput(category, values[1]);
  if (!normalizedCode.ok) {
    row.error = normalizedCode.msg;
    return row;
  }
  row.product_code = normalizedCode.product_code;

  const material = (context.materialsByCode || new Map()).get(row.product_code);
  if (!material) {
    row.error = `产品代码 ${row.product_code} 未在标准库中找到，请先完成物料建档后再导入`;
    return row;
  }
  if (isArchivedMaterial(material)) {
    row.error = `产品代码 ${row.product_code} 已归档，请先联系管理员恢复`;
    return row;
  }

  row.material_id = normalizeText(material._id);
  row.material_name = normalizeText(material.material_name || material.name);
  row.sub_category = normalizeText(material.sub_category);

  if (!row.batch_number) {
    row.error = '请填写生产批号';
    return row;
  }

  const zoneMap = ((context.zoneMapsByCategory || {})[category]) || new Map();
  const zoneRecord = zoneMap.get(row.zone_name);
  if (!zoneRecord) {
    row.error = '存储区域无效，请选择当前启用库区';
    return row;
  }
  row.zone_key = zoneRecord.zone_key;
  row.location = composeLocation(zoneRecord.name, row.location_detail);

  if (!longTerm.ok) {
    row.error = longTerm.msg;
    return row;
  }
  if (!expiryDate.ok) {
    row.error = expiryDate.msg;
    return row;
  }
  if (expiryDate.value && longTerm.value) {
    row.error = '过期日期和长期有效不能同时填写';
    return row;
  }
  if (!expiryDate.value && !longTerm.value) {
    row.error = '请填写过期日期或标记长期有效';
    return row;
  }
  row.expiry_date = expiryDate.value;
  row.is_long_term_valid = longTerm.value;

  const normalizedUnit = resolveMaterialDefaultUnit(category, material);
  if (!normalizedUnit.ok) {
    row.error = normalizedUnit.msg;
    return row;
  }
  row.quantity_unit = normalizedUnit.unit;

  if (category === 'chemical') {
    row.net_content = normalizePositiveNumber(values[6]);
    if (row.net_content == null) {
      row.error = '化材必须填写净含量';
      return row;
    }
    row.quantity_summary = `${formatDisplayNumber(row.net_content, 3)} ${row.quantity_unit}`;
    row.warning = appendNotice(
      row.warning,
      buildPotentialDuplicateWarning(row, context.currentInventoryByProductCode)
    );
    return row;
  }

  row.thickness_um = normalizePositiveNumber(values[8]);
  row.batch_width_mm = normalizePositiveNumber(values[9]);
  row.length_m = normalizePositiveNumber(values[10]);

  if (row.batch_width_mm == null) {
    row.error = '膜材必须填写本批次实际幅宽(mm)';
    return row;
  }
  if (row.length_m == null) {
    row.error = '膜材必须填写长度(m)';
    return row;
  }

  try {
    const thicknessGovernance = resolveFilmThicknessGovernance({
      materialThicknessUm: extractMaterialThickness(material),
      inboundThicknessUm: row.thickness_um
    });

    if (!thicknessGovernance.resolvedThicknessUm) {
      row.error = '膜材主数据缺少厚度，请填写膜材厚度(μm)';
      return row;
    }

    row.thickness_um = thicknessGovernance.resolvedThicknessUm;
    if (thicknessGovernance.shouldBackfillMasterThickness) {
      row.warning = appendNotice(row.warning, `当前主数据缺少厚度，本次入库后将补齐主数据厚度为 ${formatDisplayNumber(row.thickness_um)} μm`);
    }

    if (!extractMaterialWidth(material) && row.batch_width_mm > 0) {
      row.warning = appendNotice(row.warning, `当前主数据缺少默认幅宽，本次入库后将补齐主数据默认幅宽为 ${formatDisplayNumber(row.batch_width_mm)} mm`);
    }
  } catch (error) {
    row.error = error.message || '膜材厚度校验失败';
    return row;
  }

  const filmState = buildFilmInventoryState(
    row.length_m,
    row.quantity_unit,
    row.batch_width_mm,
    row.length_m
  );
  row.quantity_summary = filmState.quantityUnit === 'm'
    ? `${formatDisplayNumber(filmState.quantityVal, 2)} m`
    : `${formatDisplayNumber(filmState.quantityVal, 2)} ${filmState.quantityUnit}（基准长度 ${formatDisplayNumber(row.length_m, 2)} m）`;
  row.warning = appendNotice(
    row.warning,
    buildPotentialDuplicateWarning(row, context.currentInventoryByProductCode)
  );
  return row;
}

function decorateInventoryImportPreviewRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const error = normalizeText(item.error);
    const warning = normalizeText(item.warning);
    const submitAction = normalizeText(item.submit_action || 'create') || 'create';
    const noticeType = error
      ? 'error'
      : (
        submitAction === 'refill' && warning
          ? 'refill'
          : (warning ? 'warning' : '')
      );
    const noticeText = error || warning || '';

    return {
      ...item,
      submit_action: submitAction,
      error,
      warning,
      noticeType,
      noticeText,
      isRefillCandidate: submitAction === 'refill' && !error,
      hasError: !!error,
      hasWarning: !!warning,
      previewKey: [
        Number(item.rowIndex) || 0,
        normalizeText(item.unique_code || item.product_code),
        error || 'ok',
        warning || 'clear'
      ].join(':')
    };
  });
}

function buildInventoryImportPayload(item = {}, material = {}) {
  const rowLabel = `第${Number(item.rowIndex) || 0}行`;
  const category = item.category === 'film' ? 'film' : 'chemical';
  const productCode = normalizeText(material.product_code || item.product_code);
  const uniqueCode = normalizeLabelCodeInput(item.unique_code);
  const materialName = normalizeText(material.material_name || material.name || item.material_name);
  const subCategory = normalizeText(material.sub_category || item.sub_category);
  const supplier = normalizeText(material.supplier || item.supplier);
  const supplierModel = normalizeText(material.supplier_model || item.supplier_model);
  const batchNumber = normalizeText(item.batch_number);
  const zoneKey = normalizeText(item.zone_key);
  const locationDetail = normalizeText(item.location_detail);
  const location = normalizeText(item.location) || composeLocation(item.zone_name, locationDetail);
  const expiryDate = normalizeText(item.expiry_date);
  const isLongTermValid = !!item.is_long_term_valid;
  const normalizedUnit = resolveMaterialDefaultUnit(category, material);

  if (!material || !material._id) {
    throw new Error(`${rowLabel}对应的物料主数据不存在`);
  }
  if (!uniqueCode || !isValidLabelCode(uniqueCode)) {
    throw new Error(`${rowLabel}标签编号格式不正确，应为 L + 6位数字`);
  }
  if (!batchNumber) {
    throw new Error(`${rowLabel}缺少生产批号`);
  }
  if (!zoneKey || !location) {
    throw new Error(`${rowLabel}缺少有效库位信息`);
  }
  if (!expiryDate && !isLongTermValid) {
    throw new Error(`${rowLabel}必须填写过期日期或明确设为长期有效`);
  }
  if (expiryDate && isLongTermValid) {
    throw new Error(`${rowLabel}过期日期和长期有效不能同时设置`);
  }
  if (!normalizedUnit.ok) {
    throw new Error(`${rowLabel}${normalizedUnit.msg}`);
  }

  const inventoryData = {
    material_id: material._id,
    material_name: materialName,
    category,
    subcategory_key: normalizeText(material.subcategory_key),
    sub_category: subCategory,
    product_code: productCode,
    unique_code: uniqueCode,
    supplier,
    supplier_model: supplierModel,
    batch_number: batchNumber,
    zone_key: zoneKey,
    location_detail: locationDetail,
    location_text: location,
    location,
    status: 'in_stock',
    quantity: {
      val: 0,
      unit: normalizedUnit.unit
    }
  };

  if (expiryDate) {
    const normalizedExpiry = normalizeDateInput(expiryDate);
    if (!normalizedExpiry.ok) {
      throw new Error(`${rowLabel}${normalizedExpiry.msg}`);
    }
    inventoryData.expiry_date = new Date(normalizedExpiry.value);
  }
  if (isLongTermValid) {
    inventoryData.is_long_term_valid = true;
  }

  let masterSpecBackfill;
  let logQuantityChange = 0;
  let logUnit = inventoryData.quantity.unit || '份';

  if (category === 'film') {
    const resolvedWidthMm = normalizePositiveNumber(item.batch_width_mm);
    const thicknessGovernance = resolveFilmThicknessGovernance({
      materialThicknessUm: extractMaterialThickness(material),
      inboundThicknessUm: normalizePositiveNumber(item.thickness_um)
    });
    const resolvedThicknessUm = thicknessGovernance.resolvedThicknessUm;
    const baseLengthM = normalizePositiveNumber(item.length_m);
    const currentMasterWidth = extractMaterialWidth(material);

    if (!resolvedWidthMm) {
      throw new Error(`${rowLabel}膜材缺少本批次实际幅宽`);
    }
    if (!resolvedThicknessUm) {
      throw new Error(`${rowLabel}膜材缺少厚度`);
    }
    if (!baseLengthM) {
      throw new Error(`${rowLabel}膜材缺少长度`);
    }

    const filmState = buildFilmInventoryState(
      baseLengthM,
      item.quantity_unit,
      resolvedWidthMm,
      baseLengthM
    );

    if (thicknessGovernance.shouldBackfillMasterThickness || !currentMasterWidth) {
      masterSpecBackfill = {};
      if (thicknessGovernance.shouldBackfillMasterThickness) {
        masterSpecBackfill.thickness_um = resolvedThicknessUm;
      }
      if (!currentMasterWidth) {
        masterSpecBackfill.standard_width_mm = resolvedWidthMm;
      }
    }

    inventoryData.quantity.val = filmState.quantityVal;
    inventoryData.quantity.unit = filmState.quantityUnit;
    inventoryData.dynamic_attrs = {
      current_length_m: filmState.currentLengthM,
      initial_length_m: filmState.initialLengthM,
      width_mm: resolvedWidthMm,
      thickness_um: resolvedThicknessUm,
      current_roll_diameter_mm: 0
    };

    logQuantityChange = filmState.currentLengthM;
    logUnit = 'm';
  } else {
    const quantityVal = normalizePositiveNumber(item.net_content);
    if (!quantityVal) {
      throw new Error(`${rowLabel}化材缺少净含量`);
    }
    inventoryData.quantity.val = quantityVal;
    inventoryData.quantity.unit = item.quantity_unit;
    inventoryData.dynamic_attrs = {
      weight_kg: quantityVal
    };
    logQuantityChange = quantityVal;
    logUnit = normalizedUnit.unit;
  }

  return {
    inventoryData,
    masterSpecBackfill,
    logData: {
      type: 'inbound',
      material_id: material._id,
      material_name: materialName,
      category,
      product_code: productCode,
      unique_code: uniqueCode,
      quantity_change: logQuantityChange,
      spec_change_unit: logUnit,
      unit: logUnit,
      description: '模板导入入库'
    }
  };
}

module.exports = {
  EMPTY_INVENTORY_TEMPLATE_ROWS_HINT,
  INVALID_TEMPLATE_HEADER_MSG,
  buildEmptyInventoryTemplatePreviewResult,
  isInventoryTemplateGroupHeaderRow,
  isInventoryTemplateHeaderRow,
  isInventoryTemplateInlineHintRow,
  validateInventoryTemplateHeaderRows,
  normalizeInventoryCategoryText,
  normalizeLabelCodeInput,
  collectInventoryImportLookupKeys,
  buildZoneMapsByCategory,
  buildInventoryImportPreviewRow,
  decorateInventoryImportPreviewRows,
  buildInventoryImportPayload
};
