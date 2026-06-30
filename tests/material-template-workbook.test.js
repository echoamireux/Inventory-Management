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
    filmSubcategories: ['基材-PET', '保护膜']
  });

  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  assert.match(workbookXml, /<definedNames>/);
  assert.match(workbookXml, /name="化材_子类">Config!\$A\$2:\$A\$3</);
  assert.match(workbookXml, /name="膜材_子类">Config!\$B\$2:\$B\$3</);
  assert.match(workbookXml, /name="化材_单位">Config!\$C\$2:\$C\$5</);
  assert.match(workbookXml, /name="膜材_单位">Config!\$D\$2:\$D\$3</);

  assert.match(sheetXml, /<formula1>INDIRECT\(\$C3&amp;&quot;_子类&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>INDIRECT\(\$C3&amp;&quot;_单位&quot;\)<\/formula1>/);
});

test('help sheet keeps example columns aligned with the actual import table', async () => {
  const workbook = await buildTemplateWorkbook({
    headers: ['产品代码', '物料名称', '类别', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号', '是否测试料'],
    previewStyledRowCount: 50,
    inlineHints: ['两类必填', '两类必填', '两类必填', '两类必填', '两类必填', '化材选填 / 膜材留空', '膜材必填 / 化材留空', '膜材选填 / 化材留空', '两类选填', '测试料必填', '选填'],
    validationRanges: {
      productCode: 'A3:A3000',
      category: 'C3:C3000',
      subcategory: 'D3:D3000',
      unit: 'E3:E3000',
      thicknessUm: 'G3:G3000',
      standardWidthMm: 'H3:H3000'
    },
    validationFormulae: {
      subcategory: 'INDIRECT($C3&"_子类")',
      unit: 'INDIRECT($C3&"_单位")'
    },
    unitOptions: {
      chemical: ['kg', 'g', 'L', 'mL'],
      film: ['m', 'm²']
    },
    subcategoryOptions: {
      chemical: ['主胶', '树脂'],
      film: ['基材-PET', '保护膜']
    },
    definedNames: {
      chemicalSubcategories: { name: '化材_子类', range: 'Config!$A$2:$A$3' },
      filmSubcategories: { name: '膜材_子类', range: 'Config!$B$2:$B$3' },
      chemicalUnits: { name: '化材_单位', range: 'Config!$C$2:$C$5' },
      filmUnits: { name: '膜材_单位', range: 'Config!$D$2:$D$3' }
    },
    helpLines: [
      '【重要：填写说明】',
      '',
      '1. 请先使用本系统导出的最新模板，不要复用旧模板。',
      '▶ 字段说明'
    ],
    exampleRows: [
      ['001', '异丙醇', '化材', '溶剂', 'L', '铁桶', '', '', '国药', 'IPA-99', '否']
    ]
  });

  const helpSheet = workbook.getWorksheet('【必看】填写指导与示例');
  const widths = Array.from({ length: 11 }, (_, index) => helpSheet.getColumn(index + 1).width);

  assert.deepEqual(widths, [14, 30, 10, 22, 12, 18, 18, 18, 20, 25, 14]);
  assert.equal(helpSheet.getCell('A1').isMerged, true);
  assert.equal(helpSheet.getCell('K1').isMerged, true);
});

test('data sheet adds inline hint row, freezes the first two rows, and exposes input prompts', async () => {
  const workbook = await buildTemplateWorkbook({
    headers: ['产品代码', '物料名称', '类别', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号', '是否测试料'],
    inlineHints: ['必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '测试料必填', '选填'],
    previewStyledRowCount: 50,
    validationRanges: {
      productCode: 'A3:A3000',
      category: 'C3:C3000',
      subcategory: 'D3:D3000',
      unit: 'E3:E3000',
      thicknessUm: 'G3:G3000',
      standardWidthMm: 'H3:H3000'
    },
    validationFormulae: {
      subcategory: 'INDIRECT($C3&"_子类")',
      unit: 'INDIRECT($C3&"_单位")'
    },
    unitOptions: {
      chemical: ['kg', 'g', 'L', 'mL'],
      film: ['m', 'm²']
    },
    subcategoryOptions: {
      chemical: ['主胶', '树脂'],
      film: ['基材-PET', '保护膜']
    },
    definedNames: {
      chemicalSubcategories: { name: '化材_子类', range: 'Config!$A$2:$A$3' },
      filmSubcategories: { name: '膜材_子类', range: 'Config!$B$2:$B$3' },
      chemicalUnits: { name: '化材_单位', range: 'Config!$C$2:$C$5' },
      filmUnits: { name: '膜材_单位', range: 'Config!$D$2:$D$3' }
    },
    helpLines: ['【重要：填写说明】'],
    exampleRows: []
  });

  const sheet = workbook.getWorksheet('物料导入表');

  assert.deepEqual(sheet.getRow(2).values.slice(1), ['必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '测试料必填', '选填']);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 2);
  assert.equal(sheet.getRow(2).height, 22);
  assert.equal(sheet.dataValidations.model['A3:A3000'].promptTitle, '填写提示');
  assert.match(sheet.dataValidations.model['A3:A3000'].prompt, /请输入 3 位数字/);
  assert.match(sheet.dataValidations.model['H3:H3000'].prompt, /仅膜材选填/);
});
