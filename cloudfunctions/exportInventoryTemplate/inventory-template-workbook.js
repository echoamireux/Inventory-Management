let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (_error) {
  ExcelJS = require('../exportMaterialTemplate/node_modules/exceljs');
}

const {
  INVENTORY_TEMPLATE_HEADERS,
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  buildInventoryTemplateSpec
} = require('./inventory-template');

const TEMPLATE_COLUMNS = [
  { key: 'unique_code', width: 14 },
  { key: 'product_code', width: 14 },
  { key: 'category', width: 10 },
  { key: 'batch_number', width: 18 },
  { key: 'zone_name', width: 18 },
  { key: 'location_detail', width: 16 },
  { key: 'net_content', width: 12 },
  { key: 'package_type', width: 16 },
  { key: 'thickness_um', width: 16 },
  { key: 'batch_width_mm', width: 20 },
  { key: 'length_m', width: 12 },
  { key: 'supplier', width: 18 },
  { key: 'supplier_model', width: 18 },
  { key: 'expiry_date', width: 14 },
  { key: 'is_long_term_valid', width: 12 }
];

function buildThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'D1D5DB' } },
    left: { style: 'thin', color: { argb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
    right: { style: 'thin', color: { argb: 'D1D5DB' } }
  };
}

function decorateGroupHeaderRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: '1E3A8A' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'DBEAFE' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = buildThinBorder();
  });
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
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { size: 10, color: { argb: '475569' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'EFF6FF' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = buildThinBorder();
  });
}

function applyPreviewRowStyle(sheet, rowIndex, columnCount) {
  for (let col = 1; col <= columnCount; col += 1) {
    const cell = sheet.getRow(rowIndex).getCell(col);
    cell.border = buildThinBorder();
    cell.alignment = { vertical: 'middle' };
  }
}

function defineConfigRanges(workbook, configSheet, spec) {
  const configColumns = [
    {
      key: spec.definedNames.chemicalZones.name,
      values: spec.zoneOptions.chemical,
      definedName: spec.definedNames.chemicalZones
    },
    {
      key: spec.definedNames.filmZones.name,
      values: spec.zoneOptions.film,
      definedName: spec.definedNames.filmZones
    }
  ];

  configColumns.forEach((column, index) => {
    const col = index + 1;
    configSheet.getRow(1).getCell(col).value = column.key;
    column.values.forEach((value, rowIndex) => {
      configSheet.getRow(rowIndex + 2).getCell(col).value = value;
    });
    workbook.definedNames.add(column.definedName.range, column.definedName.name);
  });

  // Hidden protocol markers let import parsers distinguish template kind/version
  // without relying only on visible captions that spreadsheet apps may rewrite.
  configSheet.getCell('X1').value = 'template_kind';
  configSheet.getCell('Y1').value = spec.templateKind || 'inventory_import';
  configSheet.getCell('X2').value = 'schema_version';
  configSheet.getCell('Y2').value = spec.schemaVersion || 'inventory-import-v2';
}

function applyRangeValidations(sheet, spec) {
  sheet.dataValidations.add(spec.validationRanges.labelCode, {
    type: 'custom',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请输入 L + 6位数字，例如 L000123。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '标签编号无效',
    error: '标签编号必须为 L + 6 位数字。',
    formulae: ['AND(LEFT(A4,1)="L",LEN(A4)=7,ISNUMBER(VALUE(RIGHT(A4,6))))']
  });

  sheet.dataValidations.add(spec.validationRanges.productCode, {
    type: 'custom',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请输入 3 位数字，例如 001。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '产品代码无效',
    error: '产品代码必须填写 3 位数字，例如 001。',
    formulae: ['AND(ISNUMBER(VALUE(B4)),LEN(B4)=3)']
  });

  sheet.dataValidations.add(spec.validationRanges.category, {
    type: 'list',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请选择 化材 或 膜材。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '类别无效',
    error: '类别只能为“化材”或“膜材”。',
    formulae: ['"化材,膜材"']
  });

  sheet.dataValidations.add(spec.validationRanges.zone, {
    type: 'list',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请先选择类别，再从当前启用库区中选择。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '存储区域无效',
    error: '请从下拉列表中选择当前启用的存储区域。',
    formulae: [spec.validationFormulae.zone]
  });

  sheet.dataValidations.add(spec.validationRanges.expiryDate, {
    type: 'custom',
    allowBlank: true,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '若不是长期有效，请按 YYYY-MM-DD 填写不早于当天的过期日期。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '日期无效',
    error: '请输入有效的 YYYY-MM-DD 日期，且不能早于当天。',
    formulae: [spec.validationFormulae.expiryDate]
  });

  sheet.dataValidations.add(spec.validationRanges.longTerm, {
    type: 'list',
    allowBlank: true,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '仅长期有效时填写“是”。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '长期有效填写无效',
    error: '长期有效列仅支持填写“是”或留空。',
    formulae: ['"是"']
  });

  [
    spec.validationRanges.netContent,
    spec.validationRanges.thicknessUm,
    spec.validationRanges.batchWidthMm,
    spec.validationRanges.lengthM
  ].forEach((range) => {
    sheet.dataValidations.add(range, {
      type: 'decimal',
      operator: 'greaterThan',
      formulae: [0],
      allowBlank: true,
      showInputMessage: true,
      promptTitle: '填写提示',
      prompt: '如填写，请输入大于 0 的数值。',
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: '数值无效',
      error: '请输入大于 0 的数值。'
    });
  });
}

function setRowValues(row, values = []) {
  values.forEach((value, index) => {
    row.getCell(index + 1).value = value;
  });
}

function setGroupHeaderValues(row, values = []) {
  const anchors = [1, 5, 7, 9, 12, 14];
  values.forEach((value, index) => {
    const columnIndex = anchors[index];
    if (columnIndex) {
      row.getCell(columnIndex).value = value;
    }
  });
}

function applyGroupHeaderMerges(sheet) {
  sheet.mergeCells('A1:D1');
  sheet.mergeCells('E1:F1');
  sheet.mergeCells('G1:H1');
  sheet.mergeCells('I1:K1');
  sheet.mergeCells('L1:M1');
  sheet.mergeCells('N1:O1');
}

async function buildInventoryTemplateWorkbook(specInput) {
  const spec = specInput || buildInventoryTemplateSpec();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(DATA_SHEET_NAME);
  const configSheet = workbook.addWorksheet(CONFIG_SHEET_NAME, { state: 'hidden' });
  const helpSheet = workbook.addWorksheet(HELP_SHEET_NAME);

  sheet.columns = TEMPLATE_COLUMNS.map(column => ({ key: column.key, width: column.width }));
  helpSheet.columns = TEMPLATE_COLUMNS.map(column => ({ width: column.width }));

  sheet.getColumn(1).numFmt = '@';
  sheet.getColumn(2).numFmt = '@';
  sheet.getColumn(14).numFmt = 'yyyy-mm-dd';

  setGroupHeaderValues(sheet.getRow(1), spec.groupHeaders);
  applyGroupHeaderMerges(sheet);
  decorateGroupHeaderRow(sheet.getRow(1));

  setRowValues(sheet.getRow(2), spec.headers);
  decorateHeaderRow(sheet.getRow(2));

  setRowValues(sheet.getRow(3), spec.inlineHints || []);
  decorateInlineHintRow(sheet.getRow(3));

  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  defineConfigRanges(workbook, configSheet, spec);
  applyRangeValidations(sheet, spec);

  for (let rowIndex = 4; rowIndex <= spec.previewStyledRowCount; rowIndex += 1) {
    applyPreviewRowStyle(sheet, rowIndex, INVENTORY_TEMPLATE_HEADERS.length);
  }

  spec.helpLines.forEach((line, index) => {
    const rowNumber = index + 1;
    helpSheet.mergeCells(`A${rowNumber}:O${rowNumber}`);
    const cell = helpSheet.getRow(rowNumber).getCell(1);
    cell.value = line;
    cell.font = line && (line.startsWith('【') || line.startsWith('▶'))
      ? { bold: true, size: line.startsWith('【') ? 12 : 11, color: { argb: line.startsWith('【') ? '1E3B70' : '374151' } }
      : { size: 10, color: { argb: '4B5563' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const helpHeaderSpacer = helpSheet.addRow([]);
  helpSheet.getRow(helpHeaderSpacer.number).height = 8;
  const helpHeaderRow = helpSheet.addRow(spec.headers);
  decorateHeaderRow(helpHeaderRow);
  spec.exampleRows.forEach((row) => {
    const excelRow = helpSheet.addRow(row);
    excelRow.eachCell((cell) => {
      cell.border = buildThinBorder();
      cell.font = { color: { argb: '6B7280' } };
    });
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

async function buildInventoryTemplateWorkbookBuffer(options) {
  const spec = buildInventoryTemplateSpec(options);
  const workbook = await buildInventoryTemplateWorkbook(spec);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildInventoryTemplateWorkbook,
  buildInventoryTemplateWorkbookBuffer
};
