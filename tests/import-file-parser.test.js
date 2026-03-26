const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const {
  DATA_SHEET_NAME: INVENTORY_SHEET_NAME,
  INVENTORY_TEMPLATE_GROUP_HEADERS,
  INVENTORY_TEMPLATE_HEADERS,
  TEMPLATE_INLINE_HINTS: INVENTORY_TEMPLATE_INLINE_HINTS,
  buildInventoryTemplateSpec
} = require('../cloudfunctions/exportInventoryTemplate/inventory-template');
const {
  buildInventoryTemplateWorkbook
} = require('../cloudfunctions/exportInventoryTemplate/inventory-template-workbook');
const {
  DATA_SHEET_NAME: MATERIAL_SHEET_NAME,
  TEMPLATE_HEADERS: MATERIAL_TEMPLATE_HEADERS,
  TEMPLATE_INLINE_HINTS: MATERIAL_TEMPLATE_INLINE_HINTS,
  buildMaterialTemplateSpec
} = require('../cloudfunctions/exportMaterialTemplate/material-template');
const {
  buildTemplateWorkbook
} = require('../cloudfunctions/exportMaterialTemplate/material-template-workbook');
const {
  matchesExpectedHeaderRows,
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta
} = require('../miniprogram/utils/import-file-parser');

const INVENTORY_TEMPLATE_EXPECTED_ROWS = [
  [
    INVENTORY_TEMPLATE_GROUP_HEADERS[0], '', '', '',
    INVENTORY_TEMPLATE_GROUP_HEADERS[1], '',
    INVENTORY_TEMPLATE_GROUP_HEADERS[2], '',
    INVENTORY_TEMPLATE_GROUP_HEADERS[3], '', '',
    INVENTORY_TEMPLATE_GROUP_HEADERS[4], '',
    INVENTORY_TEMPLATE_GROUP_HEADERS[5], ''
  ],
  INVENTORY_TEMPLATE_HEADERS,
  INVENTORY_TEMPLATE_INLINE_HINTS
];

test('shared import parser rejects csv uploads and keeps xlsx as the only supported format', () => {
  assert.throws(() => {
    parseImportTemplateFileBuffer(
      Buffer.from('产品代码,物料名称,类别\n001,异丙醇,化材\n', 'utf8'),
      {
        fileName: '物料导入.csv',
        expectedHeaderRows: [
          ['产品代码', '物料名称', '类别']
        ],
        invalidTemplateMessage: '请使用系统导出的最新版物料导入模板'
      }
    );
  }, (error) => {
    assert.equal(error.code, 'unsupported_extension');
    return true;
  });
});

test('shared import parser reads inventory template xlsx data rows from the governed sheet', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1'],
    filmZones: ['研发仓1']
  }));
  const sheet = workbook.getWorksheet(INVENTORY_SHEET_NAME);
  sheet.getCell('A4').value = 'L000301';
  sheet.getCell('B4').value = '001';
  sheet.getCell('C4').value = '化材';
  sheet.getCell('D4').value = 'AC240301';
  sheet.getCell('E4').value = '实验室1';
  sheet.getCell('F4').value = 'A01';
  sheet.getCell('G4').value = 2;
  sheet.getCell('N4').value = new Date('2027-03-25T00:00:00.000Z');

  const buffer = await workbook.xlsx.writeBuffer();
  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '库存入库模板.xlsx',
    sheetName: INVENTORY_SHEET_NAME,
    expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
    invalidTemplateMessage: '请使用系统导出的最新版库存入库模板'
  });

  assert.equal(rows[3].rowIndex, 4);
  assert.deepEqual(rows[3].values, [
    'L000301', '001', '化材', 'AC240301', '实验室1', 'A01', '2', '', '', '', '', '', '', '2027-03-25', ''
  ]);
  assert.deepEqual(getParsedTemplateMeta(rows), {
    templateKind: 'inventory_import',
    schemaVersion: 'inventory-import-v2',
    headerRowIndex: 2,
    dataStartRowIndex: 4,
    sheetName: INVENTORY_SHEET_NAME
  });
});

test('shared import parser accepts cross-realm ArrayBuffer payloads from mini-program runtimes', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1'],
    filmZones: ['研发仓1']
  }));
  const sheet = workbook.getWorksheet(INVENTORY_SHEET_NAME);
  sheet.getCell('A4').value = 'L000301';

  const buffer = await workbook.xlsx.writeBuffer();
  const crossRealmArrayBuffer = vm.runInNewContext('new Uint8Array(bytes).buffer', {
    bytes: Array.from(Buffer.from(buffer))
  });

  assert.equal(crossRealmArrayBuffer instanceof ArrayBuffer, false);

  const rows = parseImportTemplateFileBuffer(crossRealmArrayBuffer, {
    fileName: '库存入库模板.xlsx',
    sheetName: INVENTORY_SHEET_NAME,
    expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
    invalidTemplateMessage: '请使用系统导出的最新版库存入库模板'
  });

  assert.equal(rows[3].values[0], 'L000301');
});

test('shared import parser accepts inventory workbooks when grouped caption rows drift but the governed field row stays intact', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1'],
    filmZones: ['研发仓1']
  }));
  const sheet = workbook.getWorksheet(INVENTORY_SHEET_NAME);
  sheet.getCell('A1').value = '基础信息（WPS重写）';
  sheet.getCell('A3').value = '这是一行被改过的提示';
  sheet.getCell('A4').value = 'L000301';

  const buffer = await workbook.xlsx.writeBuffer();
  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '库存入库模板.xlsx',
    sheetName: INVENTORY_SHEET_NAME,
    expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
    invalidTemplateMessage: '请使用系统导出的最新版库存入库模板'
  });

  assert.equal(rows[3].rowIndex, 4);
  assert.equal(rows[3].values[0], 'L000301');
});

test('shared import parser can still detect xlsx content when the runtime omits the file extension metadata', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1'],
    filmZones: ['研发仓1']
  }));
  const buffer = await workbook.xlsx.writeBuffer();

  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '',
    sheetName: INVENTORY_SHEET_NAME,
    expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
    invalidTemplateMessage: '请使用系统导出的最新版库存入库模板'
  });

  assert.equal(rows[1].values[0], '标签编号*');
});

test('shared import parser reads material template xlsx data rows from the governed sheet', async () => {
  const workbook = await buildTemplateWorkbook(buildMaterialTemplateSpec({
    chemicalSubcategories: ['溶剂'],
    filmSubcategories: ['保护膜']
  }));
  const sheet = workbook.getWorksheet(MATERIAL_SHEET_NAME);
  sheet.getCell('A3').value = '001';
  sheet.getCell('B3').value = '异丙醇';
  sheet.getCell('C3').value = '化材';
  sheet.getCell('D3').value = '溶剂';
  sheet.getCell('E3').value = 'L';
  sheet.getCell('F3').value = '铁桶';

  const buffer = await workbook.xlsx.writeBuffer();
  const rows = parseImportTemplateFileBuffer(buffer, {
    fileName: '标准物料导入模板.xlsx',
    sheetName: MATERIAL_SHEET_NAME,
    expectedHeaderRows: [
      MATERIAL_TEMPLATE_HEADERS,
      MATERIAL_TEMPLATE_INLINE_HINTS
    ],
    invalidTemplateMessage: '请使用系统导出的最新版物料导入模板'
  });

  assert.equal(rows[2].rowIndex, 3);
  assert.deepEqual(rows[2].values, ['001', '异丙醇', '化材', '溶剂', 'L', '铁桶', '', '', '', '']);
  assert.deepEqual(getParsedTemplateMeta(rows), {
    templateKind: 'material_import',
    schemaVersion: 'material-import-v1',
    headerRowIndex: 1,
    dataStartRowIndex: 3,
    sheetName: MATERIAL_SHEET_NAME
  });
});

test('shared import parser distinguishes binary payload failures from template-header failures', () => {
  assert.throws(() => {
    parseImportTemplateFileBuffer({
      byteLength: 128
    }, {
      fileName: '库存入库模板.xlsx',
      sheetName: INVENTORY_SHEET_NAME,
      expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
      invalidTemplateMessage: '请重新导出最新库存入库模板后填写'
    });
  }, (error) => {
    assert.equal(error.code, 'unsupported_binary_payload');
    assert.equal(error.message, '文件内容读取失败');
    return true;
  });
});

test('shared import parser rejects workbooks that do not contain the governed data sheet', () => {
  const XLSX = require('../miniprogram/utils/xlsx.mini.min.js');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['foo']]), 'Sheet1');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  assert.throws(() => {
    parseImportTemplateFileBuffer(buffer, {
      fileName: '标准物料导入模板.xlsx',
      sheetName: MATERIAL_SHEET_NAME,
      expectedHeaderRows: [
        MATERIAL_TEMPLATE_HEADERS,
        MATERIAL_TEMPLATE_INLINE_HINTS
      ],
      invalidTemplateMessage: '请使用系统导出的最新版物料导入模板'
    });
  }, (error) => {
    assert.equal(error.code, 'missing_sheet');
    assert.equal(error.message, '请使用系统导出的最新版物料导入模板');
    assert.match(JSON.stringify(error.details || {}), /Sheet1/);
    return true;
  });
});

test('shared import parser reports a structured header_mismatch when the governed field row changes order', async () => {
  const workbook = await buildInventoryTemplateWorkbook(buildInventoryTemplateSpec({
    chemicalZones: ['实验室1'],
    filmZones: ['研发仓1']
  }));
  const sheet = workbook.getWorksheet(INVENTORY_SHEET_NAME);
  const swapped = INVENTORY_TEMPLATE_HEADERS.slice();
  [swapped[4], swapped[13]] = [swapped[13], swapped[4]];
  swapped.forEach((value, index) => {
    sheet.getCell(2, index + 1).value = value;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  assert.throws(() => {
    parseImportTemplateFileBuffer(buffer, {
      fileName: '库存入库模板.xlsx',
      sheetName: INVENTORY_SHEET_NAME,
      expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
      invalidTemplateMessage: '请使用系统导出的最新版库存入库模板'
    });
  }, (error) => {
    assert.equal(error.code, 'header_mismatch');
    assert.equal(error.message, '请使用系统导出的最新版库存入库模板');
    assert.match(JSON.stringify(error.details || {}), /过期日期/);
    return true;
  });
});

test('shared import parser accepts the user-provided inventory workbook as a valid template regression sample when available locally', {
  skip: !fs.existsSync('/Users/heyu/Desktop/库存入库模板_20260325_1023.xlsx')
}, () => {
  const rows = parseImportTemplateFileBuffer(
    fs.readFileSync('/Users/heyu/Desktop/库存入库模板_20260325_1023.xlsx'),
    {
      fileName: '库存入库模板_20260325_1023.xlsx',
      sheetName: INVENTORY_SHEET_NAME,
      expectedHeaderRows: INVENTORY_TEMPLATE_EXPECTED_ROWS,
      invalidTemplateMessage: '请重新导出最新库存入库模板后填写'
    }
  );

  assert.equal(rows[0].values[0], '基础信息');
  assert.equal(rows[1].values[0], '标签编号*');
  assert.equal(rows[3].values[0], 'L000001');
});

test('shared import parser can match expected header rows exactly', () => {
  assert.equal(
    matchesExpectedHeaderRows([
      { rowIndex: 1, values: MATERIAL_TEMPLATE_HEADERS },
      { rowIndex: 2, values: MATERIAL_TEMPLATE_INLINE_HINTS }
    ], [
      MATERIAL_TEMPLATE_HEADERS,
      MATERIAL_TEMPLATE_INLINE_HINTS
    ]),
    true
  );
});
