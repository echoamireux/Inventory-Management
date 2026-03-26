const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../cloudfunctions/exportMaterialTemplate/node_modules/jszip');

const {
  INVENTORY_TEMPLATE_HEADERS,
  buildInventoryTemplateSpec
} = require('../cloudfunctions/exportInventoryTemplate/inventory-template');
const {
  buildInventoryTemplateWorkbook,
  buildInventoryTemplateWorkbookBuffer
} = require('../cloudfunctions/exportInventoryTemplate/inventory-template-workbook');
const {
  LEGACY_INVENTORY_TEMPLATE_EXPORT_HINT,
  normalizeInventoryTemplateExportResult
} = require('../miniprogram/utils/inventory-template-export');

test('inventory template export result accepts successful responses with a file id', () => {
  assert.deepEqual(
    normalizeInventoryTemplateExportResult({
      result: {
        success: true,
        fileID: 'cloud://inventory-template.xlsx',
        fileName: '库存入库模板_20260324_1200.xlsx'
      }
    }),
    {
      success: true,
      fileID: 'cloud://inventory-template.xlsx',
      fileName: '库存入库模板_20260324_1200.xlsx'
    }
  );
});

test('inventory template export surfaces a deploy hint when the cloud function is outdated', () => {
  assert.throws(
    () => normalizeInventoryTemplateExportResult({
      result: {
        success: true,
        msg: '模板生成成功'
      }
    }),
    new RegExp(LEGACY_INVENTORY_TEMPLATE_EXPORT_HINT)
  );
});

test('inventory template headers keep label-first structure and consecutive film spec columns', () => {
  assert.deepEqual(INVENTORY_TEMPLATE_HEADERS, [
    '标签编号*',
    '产品代码*',
    '类别*',
    '生产批号*',
    '存储区域*',
    '详细坐标',
    '净含量',
    '包装形式',
    '膜材厚度(μm)',
    '本批次实际幅宽(mm)',
    '长度(m)',
    '供应商',
    '原厂型号',
    '过期日期',
    '长期有效'
  ]);
});

test('inventory template workbook keeps category-driven zone validation compatible with WPS and Excel', async () => {
  const buffer = await buildInventoryTemplateWorkbookBuffer({
    chemicalZones: ['实验室1', '实验室2'],
    filmZones: ['研发仓1', '实验线']
  });

  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

  assert.match(workbookXml, /name="化材_库区">Config!\$A\$2:\$A\$3</);
  assert.match(workbookXml, /name="膜材_库区">Config!\$B\$2:\$B\$3</);

  assert.match(sheetXml, /<formula1>INDIRECT\(\$C4&amp;&quot;_库区&quot;\)<\/formula1>/);
  assert.match(sheetXml, /<formula1>OR\(N4=&quot;&quot;,AND\(ISNUMBER\(N4\),N4&gt;=TODAY\(\)\)\)<\/formula1>/);
});

test('inventory template workbook uses three-tier headers and governed hints aligned with the template columns', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1', '实验室2'],
    filmZones: ['研发仓1', '实验线']
  }));

  const dataSheet = workbook.getWorksheet('库存入库表');
  const helpSheet = workbook.getWorksheet('【必看】填写指导与示例');

  assert.equal(dataSheet.getCell('A1').value, '基础信息');
  assert.equal(dataSheet.getCell('E1').value, '库位信息');
  assert.equal(dataSheet.getCell('G1').value, '化材信息');
  assert.equal(dataSheet.getCell('I1').value, '膜材信息');
  assert.equal(dataSheet.getCell('L1').value, '来源信息');
  assert.equal(dataSheet.getCell('N1').value, '时效信息');
  assert.deepEqual(dataSheet.getRow(2).values.slice(1), INVENTORY_TEMPLATE_HEADERS);
  assert.equal(dataSheet.getRow(3).values[1], '必填');
  assert.equal(dataSheet.getRow(3).values[5], '必填');
  assert.equal(dataSheet.getRow(3).values[7], '化材必填');
  assert.equal(dataSheet.getRow(3).values[9], '膜材条件必填');
  assert.equal(dataSheet.getRow(3).values[10], '膜材必填');
  assert.equal(dataSheet.getRow(3).values[11], '膜材必填');
  assert.equal(dataSheet.getRow(3).values[14], '二选一');
  assert.equal(dataSheet.getRow(3).values[15], '二选一');
  assert.equal(dataSheet.views[0].state, 'frozen');
  assert.equal(dataSheet.views[0].ySplit, 3);
  assert.equal(dataSheet.getColumn(14).numFmt, 'yyyy-mm-dd');

  assert.ok(helpSheet);
  const helpText = String(helpSheet.getColumn(1).values.join('\n'));
  assert.match(String(helpSheet.getCell('A1').value || ''), /【重要：填写说明】/);
  assert.match(String(helpSheet.getCell('A8').value || ''), /字段说明/);
  assert.match(String(helpSheet.getCell('A9').value || ''), /标签编号\*/);
  assert.match(String(helpSheet.getCell('A13').value || ''), /YYYY-MM-DD/);
  assert.match(String(helpSheet.getCell('A14').value || ''), /默认单位由系统按主数据自动带出/);
  assert.match(String(helpSheet.getCell('A17').value || ''), /膜材厚度/);
  assert.doesNotMatch(helpText, /CSV/);
  assert.match(helpText, /直接上传 \.xlsx/);
});
