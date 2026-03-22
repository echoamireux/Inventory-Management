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

  assert.match(sheetXml, /<formula1>INDIRECT\(\$C2&amp;&quot;_子类&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>INDIRECT\(\$C2&amp;&quot;_单位&quot;\)<\/formula1>/);
});

test('help sheet keeps example columns aligned with the actual import table', async () => {
  const workbook = await buildTemplateWorkbook({
    headers: ['产品代码', '物料名称', '类别', '子类别', '默认单位', '供应商', '厂家型号'],
    previewStyledRowCount: 50,
    validationRanges: {
      productCode: 'A2:A3000',
      category: 'C2:C3000',
      subcategory: 'D2:D3000',
      unit: 'E2:E3000'
    },
    validationFormulae: {
      subcategory: 'INDIRECT($C2&"_子类")',
      unit: 'INDIRECT($C2&"_单位")'
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
      ['001', '异丙醇', '化材', '溶剂', 'L', '国药', 'IPA-99']
    ]
  });

  const helpSheet = workbook.getWorksheet('【必看】填写指导与示例');
  const widths = Array.from({ length: 7 }, (_, index) => helpSheet.getColumn(index + 1).width);

  assert.deepEqual(widths, [12, 30, 10, 22, 12, 20, 25]);
  assert.equal(helpSheet.getCell('A1').isMerged, true);
  assert.equal(helpSheet.getCell('G1').isMerged, true);
});
