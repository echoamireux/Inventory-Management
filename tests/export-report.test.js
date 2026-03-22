const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPORT_HEADERS,
  EXPORT_SHEET_NAME,
  buildInventoryExportFileName,
  formatExportDateTime,
  buildInventoryExportRow,
  buildInventoryExportWorkbook
} = require('../cloudfunctions/_shared/export-report');

test('export report file name and datetime are formatted in business-readable CST style', () => {
  const exportedAt = new Date('2026-03-21T07:22:52.000Z');

  assert.equal(formatExportDateTime(exportedAt), '2026-03-21 15:22:52');
  assert.equal(buildInventoryExportFileName(exportedAt), '库存明细报表_20260321_1522.xlsx');
});

test('export report row keeps governed field labels and avoids fake chemical spec values', () => {
  const row = buildInventoryExportRow({
    material_name: '化材-1',
    product_code: 'J-001',
    unique_code: 'L000001',
    category: 'chemical',
    subcategory_key: 'builtin:chemical:adhesive',
    sub_category: '主胶',
    supplier: '供应商A',
    supplier_model: 'A-100',
    batch_number: '20260523',
    expiry_date: new Date('2026-05-21T00:00:00.000Z'),
    quantity: { val: 20, unit: 'kg' },
    zone_key: 'builtin:chemical:lab2',
    location_detail: 'A-01',
    create_time: new Date('2026-03-21T07:22:52.000Z')
  }, {
    material: {},
    zoneMap: new Map([
      ['builtin:chemical:lab2', { zone_key: 'builtin:chemical:lab2', name: '实验室2' }]
    ]),
    subcategoryMap: new Map([
      ['builtin:chemical:adhesive', { subcategory_key: 'builtin:chemical:adhesive', name: '主胶' }]
    ])
  });

  assert.deepEqual(row, {
    productCode: 'J-001',
    materialName: '化材-1',
    uniqueCode: 'L000001',
    categoryLabel: '化材',
    subcategoryLabel: '主胶',
    batchNumber: '20260523',
    currentStock: 20,
    unit: 'kg',
    zoneLabel: '实验室2',
    locationDetail: 'A-01',
    chemicalPackageType: '--',
    filmWidthMm: '--',
    filmThicknessUm: '--',
    supplier: '供应商A',
    supplierModel: 'A-100',
    expiryDate: '2026-05-21',
    statusLabel: '在库',
    inboundTime: '2026-03-21 15:22:52'
  });
});

test('export report row distinguishes explicit long-term validity from missing expiry data', () => {
  const longTermRow = buildInventoryExportRow({
    material_name: '保护膜-1',
    product_code: 'M-005',
    unique_code: 'L000004',
    category: 'film',
    sub_category: '保护膜',
    is_long_term_valid: true,
    quantity: { val: 246, unit: 'm²' },
    dynamic_attrs: {
      current_length_m: 200,
      initial_length_m: 200,
      width_mm: 1230
    }
  }, {
    material: {
      default_unit: 'm²'
    },
    zoneMap: new Map(),
    subcategoryMap: new Map()
  });

  const missingExpiryRow = buildInventoryExportRow({
    material_name: '保护膜-2',
    product_code: 'M-006',
    unique_code: 'L000005',
    category: 'film',
    sub_category: '保护膜',
    quantity: { val: 100, unit: 'm' },
    dynamic_attrs: {
      current_length_m: 100,
      initial_length_m: 100,
      width_mm: 1000
    }
  }, {
    material: {
      default_unit: 'm'
    },
    zoneMap: new Map(),
    subcategoryMap: new Map()
  });

  assert.equal(longTermRow.expiryDate, '长期有效');
  assert.equal(missingExpiryRow.expiryDate, '未设置过期日');
});

test('export report row prefers the latest master thickness while keeping batch width as the display truth', () => {
  const row = buildInventoryExportRow({
    material_name: '膜材-1',
    product_code: 'M-005',
    unique_code: 'L000003',
    category: 'film',
    quantity: { val: 246, unit: 'm²' },
    dynamic_attrs: {
      current_length_m: 200,
      initial_length_m: 200,
      width_mm: 1230,
      thickness_um: 20
    }
  }, {
    material: {
      default_unit: 'm²',
      specs: {
        thickness_um: 25
      }
    },
    zoneMap: new Map(),
    subcategoryMap: new Map()
  });

  assert.equal(row.filmWidthMm, 1230);
  assert.equal(row.filmThicknessUm, 25);
});

test('export workbook uses Chinese sheet title, professional header rows, and frozen panes', async () => {
  const workbook = await buildInventoryExportWorkbook({
    exportedAt: new Date('2026-03-21T07:22:52.000Z'),
    filters: {
      categoryLabel: '化材',
      searchVal: 'J-001'
    },
    rows: [
      {
        productCode: 'J-001',
        materialName: '化材-1',
        uniqueCode: 'L000001',
        categoryLabel: '化材',
        subcategoryLabel: '主胶',
        batchNumber: '20260523',
        currentStock: 20,
        unit: 'kg',
        zoneLabel: '实验室2',
        locationDetail: 'A-01',
        chemicalPackageType: '铁桶',
        filmWidthMm: '--',
        filmThicknessUm: '--',
        supplier: '--',
        supplierModel: '--',
        expiryDate: '2026-05-21',
        statusLabel: '在库',
        inboundTime: '2026-03-21 15:22:52'
      }
    ]
  });

  const sheet = workbook.getWorksheet(EXPORT_SHEET_NAME);

  assert.equal(sheet.name, '库存明细');
  assert.equal(sheet.getCell('A1').value, '库存明细报表');
  assert.match(sheet.getCell('A2').value, /导出时间：2026-03-21 15:22:52/);
  assert.match(sheet.getCell('A3').value, /筛选条件：类别=化材；搜索词=J-001/);
  assert.deepEqual(sheet.getRow(5).values.slice(1), EXPORT_HEADERS);
  assert.equal(sheet.autoFilter.from.row, 5);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 5);
  assert.equal(sheet.views[0].xSplit, 1);
  assert.equal(sheet.getCell('A6').value, 'J-001');
  assert.equal(sheet.getCell('B6').value, '化材-1');
  assert.equal(sheet.getCell('I6').value, '实验室2');
  assert.equal(sheet.getCell('J6').value, 'A-01');
  assert.equal(sheet.getCell('K6').value, '铁桶');
});

test('export workbook hides redundant filter summary when exporting the unfiltered total table', async () => {
  const workbook = await buildInventoryExportWorkbook({
    exportedAt: new Date('2026-03-21T07:22:52.000Z'),
    filters: {},
    rows: []
  });

  const sheet = workbook.getWorksheet(EXPORT_SHEET_NAME);

  assert.deepEqual(EXPORT_HEADERS, [
    '产品代码',
    '物料名称',
    '标签编号',
    '类别',
    '子类别',
    '生产批号',
    '当前库存',
    '单位',
    '库区',
    '详细坐标',
    '化材包装形式',
    '膜材幅宽(mm)',
    '膜材厚度(μm)',
    '供应商',
    '原厂型号',
    '过期日期',
    '状态',
    '入库时间'
  ]);
  assert.equal(sheet.getCell('A3').value, null);
  assert.equal(sheet.getCell('A4').value, '产品代码');
  assert.equal(sheet.autoFilter.from.row, 4);
  assert.equal(sheet.views[0].ySplit, 4);
});
