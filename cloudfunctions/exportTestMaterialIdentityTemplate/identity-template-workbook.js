let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (_error) {
  ExcelJS = require('../exportMaterialTemplate/node_modules/exceljs');
}

const DATA_SHEET_NAME = '测试料型号库';
const CONFIG_SHEET_NAME = 'Config';
const HELP_SHEET_NAME = '【必看】填写说明';
const TEMPLATE_KIND = 'test_material_identity_import';
const TEMPLATE_SCHEMA_VERSION = 'test-material-identity-import-v1';
const TEMPLATE_HEADERS = ['测试料产品代码*', '原厂型号*'];
const TEMPLATE_INLINE_HINTS = [
  '必填，从下拉选择已启用测试料主数据',
  '必填；保留大小写，系统会整理全角和多余空格'
];
const TEMPLATE_DATA_START_ROW = 3;
const TEMPLATE_MAX_IMPORT_ROWS = 100;
const TEMPLATE_MAX_ROW = TEMPLATE_DATA_START_ROW + TEMPLATE_MAX_IMPORT_ROWS - 1;
const TEMPLATE_PREVIEW_STYLED_ROW_COUNT = TEMPLATE_MAX_ROW;

function normalizeProductCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function collectSelectableTestMaterials(records = []) {
  const byCode = new Map();
  (Array.isArray(records) ? records : []).forEach((item) => {
    const productCode = normalizeProductCode(item && item.product_code);
    if (!productCode) {
      return;
    }
    if (item && item.status && item.status !== 'active') {
      return;
    }
    if (!item || !item.is_test_material) {
      return;
    }
    if (!byCode.has(productCode)) {
      byCode.set(productCode, {
        product_code: productCode,
        material_name: normalizeText(item.material_name || item.name)
      });
    }
  });
  return Array.from(byCode.values()).sort((left, right) => (
    left.product_code.localeCompare(right.product_code, 'zh-Hans-CN')
  ));
}

function buildThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'D1D5DB' } },
    left: { style: 'thin', color: { argb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
    right: { style: 'thin', color: { argb: 'D1D5DB' } }
  };
}

function decorateHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E3A8A' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = buildThinBorder();
  });
}

function decorateInlineHintRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { size: 10, color: { argb: '475569' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'EFF6FF' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = buildThinBorder();
  });
}

function applyPreviewRowStyle(sheet, rowIndex, columnCount) {
  for (let col = 1; col <= columnCount; col += 1) {
    const cell = sheet.getRow(rowIndex).getCell(col);
    cell.border = buildThinBorder();
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

function buildTestMaterialIdentityTemplateSpec({ testMaterials = [] } = {}) {
  const selectableMaterials = collectSelectableTestMaterials(testMaterials);
  const testMaterialCodes = selectableMaterials.map(item => item.product_code);
  const listEndRow = Math.max(2, selectableMaterials.length + 1);

  return {
    dataSheetName: DATA_SHEET_NAME,
    configSheetName: CONFIG_SHEET_NAME,
    helpSheetName: HELP_SHEET_NAME,
    templateKind: TEMPLATE_KIND,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    headers: TEMPLATE_HEADERS.slice(),
    inlineHints: TEMPLATE_INLINE_HINTS.slice(),
    maxRow: TEMPLATE_MAX_ROW,
    maxImportRows: TEMPLATE_MAX_IMPORT_ROWS,
    previewStyledRowCount: TEMPLATE_PREVIEW_STYLED_ROW_COUNT,
    selectableMaterials,
    testMaterialCodes,
    validationRanges: {
      productCode: `A${TEMPLATE_DATA_START_ROW}:A${TEMPLATE_MAX_ROW}`,
      supplierModel: `B${TEMPLATE_DATA_START_ROW}:B${TEMPLATE_MAX_ROW}`
    },
    definedNames: {
      testMaterialCodes: {
        name: '测试料_产品代码',
        range: `Config!$A$2:$A$${listEndRow}`
      }
    },
    helpLines: [
      '【填写说明】',
      '',
      '1. 请先在物料主数据中维护并启用测试料代码壳，再导出本模板。',
      '2. A 列必须从下拉中选择已启用测试料产品代码，不能手输未建档代码。',
      '3. B 列填写真实原厂型号；系统保留大小写差异，但会整理全角字符、常见横杠和多余空格。',
      '4. 同一测试料产品代码下可维护多个原厂型号；单次上传最多 100 行，可分批多次上传。',
      '',
      `当前可选测试料产品代码：${testMaterialCodes.length ? testMaterialCodes.join(' / ') : '无'}`
    ]
  };
}

function defineConfigRanges(workbook, configSheet, spec) {
  configSheet.getRow(1).getCell(1).value = spec.definedNames.testMaterialCodes.name;
  configSheet.getRow(1).getCell(2).value = '物料名称';
  spec.selectableMaterials.forEach((item, index) => {
    const row = configSheet.getRow(index + 2);
    row.getCell(1).value = item.product_code;
    row.getCell(2).value = item.material_name;
  });
  workbook.definedNames.add(
    spec.definedNames.testMaterialCodes.range,
    spec.definedNames.testMaterialCodes.name
  );

  configSheet.getCell('X1').value = 'template_kind';
  configSheet.getCell('Y1').value = spec.templateKind;
  configSheet.getCell('X2').value = 'schema_version';
  configSheet.getCell('Y2').value = spec.schemaVersion;
}

function applyRangeValidations(sheet, spec) {
  sheet.dataValidations.add(spec.validationRanges.productCode, {
    type: 'list',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请从系统当前已启用的测试料产品代码中选择。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '测试料产品代码无效',
    error: '请从下拉列表选择已启用测试料产品代码，不要手动输入未维护代码。',
    formulae: [spec.definedNames.testMaterialCodes.name]
  });
  sheet.dataValidations.add(spec.validationRanges.supplierModel, {
    type: 'custom',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请输入真实原厂型号；保留大小写，系统只整理全角字符和多余空格。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '原厂型号缺失',
    error: '测试料原厂型号必填。',
    formulae: [`LEN(TRIM(B${TEMPLATE_DATA_START_ROW}))>0`]
  });
}

async function buildTestMaterialIdentityWorkbook(specInput) {
  const spec = specInput || buildTestMaterialIdentityTemplateSpec();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(DATA_SHEET_NAME);
  const configSheet = workbook.addWorksheet(CONFIG_SHEET_NAME, {
    state: 'hidden'
  });
  const helpSheet = workbook.addWorksheet(HELP_SHEET_NAME);

  sheet.columns = [
    { header: TEMPLATE_HEADERS[0], key: 'product_code', width: 20 },
    { header: TEMPLATE_HEADERS[1], key: 'supplier_model', width: 34 }
  ];
  helpSheet.columns = sheet.columns.map(column => ({ width: column.width }));
  decorateHeaderRow(sheet.getRow(1));

  const hintRow = sheet.getRow(2);
  spec.inlineHints.forEach((value, index) => {
    hintRow.getCell(index + 1).value = value;
  });
  decorateInlineHintRow(hintRow);
  sheet.getColumn(1).numFmt = '@';
  sheet.getColumn(2).numFmt = '@';
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  defineConfigRanges(workbook, configSheet, spec);
  applyRangeValidations(sheet, spec);

  for (let rowIndex = TEMPLATE_DATA_START_ROW; rowIndex <= spec.previewStyledRowCount; rowIndex += 1) {
    applyPreviewRowStyle(sheet, rowIndex, TEMPLATE_HEADERS.length);
  }

  spec.helpLines.forEach((line, index) => {
    const rowNumber = index + 1;
    helpSheet.mergeCells(`A${rowNumber}:B${rowNumber}`);
    const cell = helpSheet.getRow(rowNumber).getCell(1);
    cell.value = line;
    cell.font = line && line.startsWith('【')
      ? { bold: true, size: 12, color: { argb: '1E3B70' } }
      : { size: 10, color: { argb: '4B5563' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const helpHeader = helpSheet.addRow(TEMPLATE_HEADERS);
  decorateHeaderRow(helpHeader);
  const example = spec.selectableMaterials[0] || { product_code: 'J-999', material_name: '测试料主数据' };
  const exampleRow = helpSheet.addRow([
    example.product_code,
    'MODEL-A'
  ]);
  exampleRow.eachCell((cell) => {
    cell.border = buildThinBorder();
    cell.font = { color: { argb: '6B7280' } };
  });

  await configSheet.protect('', {
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false
  });

  workbook.views = [{ activeTab: 0 }];
  return workbook;
}

async function buildTestMaterialIdentityWorkbookBuffer(options) {
  const spec = buildTestMaterialIdentityTemplateSpec(options);
  const workbook = await buildTestMaterialIdentityWorkbook(spec);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  TEMPLATE_KIND,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_HEADERS,
  TEMPLATE_INLINE_HINTS,
  TEMPLATE_MAX_IMPORT_ROWS,
  buildTestMaterialIdentityTemplateSpec,
  buildTestMaterialIdentityWorkbook,
  buildTestMaterialIdentityWorkbookBuffer
};
