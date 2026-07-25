const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../cloudfunctions/exportMaterialTemplate/node_modules/jszip');

const {
  buildTemplateWorkbook,
  buildTemplateWorkbookBuffer
} = require('../cloudfunctions/exportMaterialTemplate/material-template-workbook');

test('generated workbook writes defined names and validation formulas compatible with WPS/Excel', async () => {
  const buffer = await buildTemplateWorkbookBuffer({
    chemicalSubcategories: ['主胶', '树脂'],
    filmSubcategories: ['基材-PET', '保护膜'],
    codePrefixes: [
      { prefix: 'J', category: 'chemical', status: 'active', sort_order: 10 },
      { prefix: 'S', category: 'chemical', status: 'active', sort_order: 20 },
      { prefix: 'Y', category: 'chemical', status: 'active', sort_order: 30 },
      { prefix: 'M', category: 'film', status: 'active', sort_order: 40 }
    ]
  });

  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  assert.match(workbookXml, /<definedNames>/);
  assert.match(workbookXml, /name="化材_子类">Config!\$A\$2:\$A\$3</);
  assert.match(workbookXml, /name="膜材_子类">Config!\$B\$2:\$B\$3</);
  assert.match(workbookXml, /name="化材_单位">Config!\$C\$2:\$C\$5</);
  assert.match(workbookXml, /name="膜材_单位">Config!\$D\$2:\$D\$3</);
  assert.match(workbookXml, /name="化材_前缀">Config!\$E\$2:\$E\$4</);
  assert.match(workbookXml, /name="膜材_前缀">Config!\$F\$2(?:<\/definedName>|:\$F\$2<\/definedName>)/);
  assert.match(workbookXml, /name="化材_包装形式">Config!\$G\$2:\$G\$6</);

  assert.match(sheetXml, /<formula1>INDIRECT\(\$B3&amp;&quot;_前缀&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>INDIRECT\(\$B3&amp;&quot;_子类&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>INDIRECT\(\$B3&amp;&quot;_单位&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>化材_包装形式<\/formula1>/);
});

test('help sheet keeps example columns aligned with the actual import table', async () => {
  const workbook = await buildTemplateWorkbook({
    headers: ['是否测试料', '类别', '代码前缀', '产品编号', '物料名称', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号'],
    previewStyledRowCount: 50,
    inlineHints: ['是/否，空白=否', '必填', '必填', '必填', '必填', '必填', '必填', '化材选填 / 膜材留空', '膜材必填 / 化材留空', '膜材选填 / 化材留空', '两类选填', '两类选填'],
    validationRanges: {
      testMaterialFlag: 'A3:A3000',
      category: 'B3:B3000',
      codePrefix: 'C3:C3000',
      productCodeNumber: 'D3:D3000',
      subcategory: 'F3:F3000',
      unit: 'G3:G3000',
      packageType: 'H3:H3000',
      thicknessUm: 'I3:I3000',
      standardWidthMm: 'J3:J3000',
      supplierModel: 'L3:L3000'
    },
    validationFormulae: {
      codePrefix: 'INDIRECT($B3&"_前缀")',
      subcategory: 'INDIRECT($B3&"_子类")',
      unit: 'INDIRECT($B3&"_单位")'
    },
    unitOptions: {
      chemical: ['g', 'kg', 'mL', 'L'],
      film: ['m', 'm²']
    },
    packageTypeOptions: ['瓶装', '桶装', '袋装', '卷装', '盒装'],
    subcategoryOptions: {
      chemical: ['主胶', '树脂'],
      film: ['基材-PET', '保护膜']
    },
    definedNames: {
      chemicalSubcategories: { name: '化材_子类', range: 'Config!$A$2:$A$3' },
      filmSubcategories: { name: '膜材_子类', range: 'Config!$B$2:$B$3' },
      chemicalUnits: { name: '化材_单位', range: 'Config!$C$2:$C$5' },
      filmUnits: { name: '膜材_单位', range: 'Config!$D$2:$D$3' },
      chemicalCodePrefixes: { name: '化材_前缀', range: 'Config!$E$2:$E$4' },
      filmCodePrefixes: { name: '膜材_前缀', range: 'Config!$F$2:$F$2' },
      chemicalPackageTypes: { name: '化材_包装形式', range: 'Config!$G$2:$G$6' }
    },
    codePrefixOptions: ['J', 'S', 'Y', 'M'],
    helpLines: [
      '【重要：填写说明】',
      '',
      '1. 请先使用本系统导出的最新模板，不要复用旧模板。',
      '▶ 字段说明'
    ],
    exampleRows: [
      ['否', '化材', 'J', '001', '异丙醇', '溶剂', 'L', '桶装', '', '', '国药', 'IPA-99']
    ]
  });

  const helpSheet = workbook.getWorksheet('【必看】填写指导与示例');
  const widths = Array.from({ length: 12 }, (_, index) => helpSheet.getColumn(index + 1).width);

  assert.deepEqual(widths, [18, 10, 12, 12, 30, 22, 12, 18, 18, 18, 20, 30]);
  assert.equal(helpSheet.getCell('A1').isMerged, true);
  assert.equal(helpSheet.getCell('L1').isMerged, true);
});

test('data sheet adds inline hint row, freezes the first two rows, and exposes input prompts', async () => {
  const workbook = await buildTemplateWorkbook({
    headers: ['是否测试料', '类别', '代码前缀', '产品编号', '物料名称', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号'],
    inlineHints: ['是/否，空白=否', '必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '正式料选填/测试料必填'],
    previewStyledRowCount: 50,
    validationRanges: {
      testMaterialFlag: 'A3:A3000',
      category: 'B3:B3000',
      codePrefix: 'C3:C3000',
      productCodeNumber: 'D3:D3000',
      subcategory: 'F3:F3000',
      unit: 'G3:G3000',
      packageType: 'H3:H3000',
      thicknessUm: 'I3:I3000',
      standardWidthMm: 'J3:J3000',
      supplierModel: 'L3:L3000'
    },
    validationFormulae: {
      codePrefix: 'INDIRECT($B3&"_前缀")',
      subcategory: 'INDIRECT($B3&"_子类")',
      unit: 'INDIRECT($B3&"_单位")'
    },
    unitOptions: {
      chemical: ['g', 'kg', 'mL', 'L'],
      film: ['m', 'm²']
    },
    packageTypeOptions: ['瓶装', '桶装', '袋装', '卷装', '盒装'],
    subcategoryOptions: {
      chemical: ['主胶', '树脂'],
      film: ['基材-PET', '保护膜']
    },
    definedNames: {
      chemicalSubcategories: { name: '化材_子类', range: 'Config!$A$2:$A$3' },
      filmSubcategories: { name: '膜材_子类', range: 'Config!$B$2:$B$3' },
      chemicalUnits: { name: '化材_单位', range: 'Config!$C$2:$C$5' },
      filmUnits: { name: '膜材_单位', range: 'Config!$D$2:$D$3' },
      chemicalCodePrefixes: { name: '化材_前缀', range: 'Config!$E$2:$E$4' },
      filmCodePrefixes: { name: '膜材_前缀', range: 'Config!$F$2:$F$2' },
      chemicalPackageTypes: { name: '化材_包装形式', range: 'Config!$G$2:$G$6' }
    },
    codePrefixOptions: ['J', 'S', 'Y', 'M'],
    helpLines: ['【重要：填写说明】'],
    exampleRows: []
  });

  const sheet = workbook.getWorksheet('物料导入表');

  assert.deepEqual(sheet.getRow(2).values.slice(1), ['是/否，空白=否', '必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '正式料选填/测试料必填']);
  assert.equal(sheet.getColumn(1).alignment.horizontal, 'center');
  assert.equal(sheet.getColumn(12).alignment.horizontal, 'center');
  assert.equal(sheet.getCell('A3').alignment.horizontal, 'center');
  assert.equal(sheet.getCell('E3').alignment.horizontal, 'center');
  assert.equal(sheet.getCell('L3').alignment.horizontal, 'center');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 2);
  assert.equal(sheet.getRow(2).height, 22);
  assert.equal(sheet.dataValidations.model['A3:A3000'].formulae[0], '"是,否"');
  assert.match(sheet.dataValidations.model['A3:A3000'].prompt, /原厂型号必填/);
  assert.equal(sheet.dataValidations.model['C3:C3000'].formulae[0], 'INDIRECT($B3&"_前缀")');
  assert.match(sheet.dataValidations.model['C3:C3000'].prompt, /请先选择本行类别/);
  assert.equal(sheet.dataValidations.model['D3:D3000'].promptTitle, '填写提示');
  assert.match(sheet.dataValidations.model['D3:D3000'].prompt, /请输入 1-3 位数字/);
  assert.match(sheet.dataValidations.model['D3:D3000'].prompt, /已维护测试料代码/);
  assert.equal(sheet.dataValidations.model['H3:H3000'].formulae[0], '化材_包装形式');
  assert.match(sheet.dataValidations.model['H3:H3000'].prompt, /仅化材选填/);
  assert.match(sheet.dataValidations.model['J3:J3000'].prompt, /仅膜材选填/);
  assert.equal(sheet.dataValidations.model['L3:L3000'].type, 'custom');
  assert.equal(sheet.dataValidations.model['L3:L3000'].formulae[0], 'OR($A3<>"是",LEN(TRIM(L3))>0)');
  assert.match(sheet.dataValidations.model['L3:L3000'].prompt, /正式物料选填；测试料必填/);
  assert.match(sheet.dataValidations.model['L3:L3000'].error, /原厂型号必须填写/);
});
