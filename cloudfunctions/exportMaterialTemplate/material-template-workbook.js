const ExcelJS = require('exceljs');
const {
  TEMPLATE_HEADERS,
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  buildMaterialTemplateSpec
} = require('./material-template');

const IMPORT_TEMPLATE_COLUMNS = [
  { header: TEMPLATE_HEADERS[0], key: 'product_code', width: 14 },
  { header: TEMPLATE_HEADERS[1], key: 'material_name', width: 30 },
  { header: TEMPLATE_HEADERS[2], key: 'category', width: 10 },
  { header: TEMPLATE_HEADERS[3], key: 'sub_category', width: 22 },
  { header: TEMPLATE_HEADERS[4], key: 'default_unit', width: 12 },
  { header: TEMPLATE_HEADERS[5], key: 'package_type', width: 18 },
  { header: TEMPLATE_HEADERS[6], key: 'thickness_um', width: 18 },
  { header: TEMPLATE_HEADERS[7], key: 'standard_width_mm', width: 18 },
  { header: TEMPLATE_HEADERS[8], key: 'supplier', width: 20 },
  { header: TEMPLATE_HEADERS[9], key: 'supplier_model', width: 25 }
];

function buildHeaderFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1E3A8A' }
  };
}

function buildThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'D1D5DB' } },
    left: { style: 'thin', color: { argb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
    right: { style: 'thin', color: { argb: 'D1D5DB' } }
  };
}

function defineConfigRanges(workbook, configSheet, spec) {
  const configColumns = [
    {
      key: spec.definedNames.chemicalSubcategories.name,
      values: spec.subcategoryOptions.chemical,
      definedName: spec.definedNames.chemicalSubcategories
    },
    {
      key: spec.definedNames.filmSubcategories.name,
      values: spec.subcategoryOptions.film,
      definedName: spec.definedNames.filmSubcategories
    },
    {
      key: spec.definedNames.chemicalUnits.name,
      values: spec.unitOptions.chemical,
      definedName: spec.definedNames.chemicalUnits
    },
    {
      key: spec.definedNames.filmUnits.name,
      values: spec.unitOptions.film,
      definedName: spec.definedNames.filmUnits
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
}

function decorateHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.fill = buildHeaderFill();
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

function applyRangeValidations(sheet, spec) {
  const productCodeAnchor = (spec.validationRanges.productCode.match(/\d+/) || ['2'])[0];
  sheet.dataValidations.add(spec.validationRanges.productCode, {
    type: 'custom',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请输入 3 位数字，如 001。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '无效的代码格式',
    error: '必须且只能输入 3 位纯数字，不足请用 0 补齐，例如 001。',
    formulae: [`AND(ISNUMBER(VALUE(A${productCodeAnchor})),LEN(A${productCodeAnchor})=3)`]
  });
  sheet.dataValidations.add(spec.validationRanges.category, {
    type: 'list',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请选择 化材 或 膜材。',
    showErrorMessage: true,
    errorTitle: '输入无效',
    error: '系统只能识别“化材”或“膜材”，请从下拉中选择。',
    formulae: ['"化材,膜材"']
  });
  sheet.dataValidations.add(spec.validationRanges.subcategory, {
    type: 'list',
    allowBlank: false,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请先选择类别，再从正式子类别下拉中选择。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '子类别无效',
    error: '请先选择正确的大类，再从系统维护好的正式子类别中选择。',
    formulae: [spec.validationFormulae.subcategory]
  });
  sheet.dataValidations.add(spec.validationRanges.unit, {
    type: 'list',
    allowBlank: true,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '请先选择类别，再从该大类允许的标准单位中选择。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '单位无效',
    error: '请从下拉中选择该大类允许的标准单位。',
    formulae: [spec.validationFormulae.unit]
  });
  sheet.dataValidations.add(spec.validationRanges.thicknessUm, {
    type: 'decimal',
    operator: 'greaterThan',
    formulae: [0],
    allowBlank: true,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '仅膜材必填；化材请留空。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '厚度无效',
    error: '请输入大于 0 的膜材厚度数值。'
  });
  sheet.dataValidations.add(spec.validationRanges.standardWidthMm, {
    type: 'decimal',
    operator: 'greaterThan',
    formulae: [0],
    allowBlank: true,
    showInputMessage: true,
    promptTitle: '填写提示',
    prompt: '仅膜材选填；填写则写入主数据默认幅宽。',
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '默认幅宽无效',
    error: '若填写默认幅宽，请输入大于 0 的数值。'
  });
}

async function buildTemplateWorkbook(specInput) {
  const spec = specInput || buildMaterialTemplateSpec();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(DATA_SHEET_NAME);
  const configSheet = workbook.addWorksheet(CONFIG_SHEET_NAME, {
    state: 'hidden'
  });
  const helpSheet = workbook.addWorksheet(HELP_SHEET_NAME);

  sheet.columns = IMPORT_TEMPLATE_COLUMNS;
  helpSheet.columns = IMPORT_TEMPLATE_COLUMNS.map((column) => ({ width: column.width }));
  decorateHeaderRow(sheet.getRow(1));
  const inlineHintRow = sheet.getRow(2);
  (spec.inlineHints || []).forEach((value, index) => {
    inlineHintRow.getCell(index + 1).value = value;
  });
  decorateInlineHintRow(inlineHintRow);
  sheet.getColumn(1).numFmt = '@';
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  defineConfigRanges(workbook, configSheet, spec);
  applyRangeValidations(sheet, spec);

  for (let rowIndex = 3; rowIndex <= spec.previewStyledRowCount; rowIndex += 1) {
    applyPreviewRowStyle(sheet, rowIndex, TEMPLATE_HEADERS.length);
  }

  spec.helpLines.forEach((line, index) => {
    const rowNumber = index + 1;
    helpSheet.mergeCells(`A${rowNumber}:J${rowNumber}`);
    const cell = helpSheet.getRow(rowNumber).getCell(1);
    cell.value = line;
    cell.font = line && (line.startsWith('【') || line.startsWith('▶'))
      ? { bold: true, size: line.startsWith('【') ? 12 : 11, color: { argb: line.startsWith('【') ? '1E3B70' : '374151' } }
      : { size: 10, color: { argb: '4B5563' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const headerRowIndex = spec.helpLines.length + 1;
  helpSheet.addRow([]);
  const helpHeader = helpSheet.addRow(spec.headers);
  decorateHeaderRow(helpHeader);
  spec.exampleRows.forEach((row) => {
    const excelRow = helpSheet.addRow(row);
    excelRow.eachCell((cell) => {
      cell.border = buildThinBorder();
      cell.font = { color: { argb: '6B7280' } };
    });
  });
  helpSheet.getRow(headerRowIndex + 1).height = 22;

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

async function buildTemplateWorkbookBuffer(options) {
  const spec = buildMaterialTemplateSpec(options);
  const workbook = await buildTemplateWorkbook(spec);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildTemplateWorkbook,
  buildTemplateWorkbookBuffer
};
