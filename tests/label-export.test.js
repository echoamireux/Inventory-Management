const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LABEL_EXPORT_TEMPLATE_TYPES,
  buildLabelExportFileName,
  buildLabelExportRow,
  buildLabelExportWorkbook,
  sortLabelExportRecordsBySelection
} = require('../cloudfunctions/exportLabelData/label-export-report');
const {
  LEGACY_LABEL_EXPORT_HINT,
  normalizeLabelExportResult
} = require('../miniprogram/utils/label-export');

test('label export result accepts successful responses with a file id', () => {
  assert.deepEqual(
    normalizeLabelExportResult({
      result: {
        success: true,
        fileID: 'cloud://label-export.xlsx',
        fileName: '膜材信息标签_20260324_1530.xlsx'
      }
    }),
    {
      success: true,
      fileID: 'cloud://label-export.xlsx',
      fileName: '膜材信息标签_20260324_1530.xlsx'
    }
  );
});

test('label export result surfaces a deploy hint when the cloud function is outdated', () => {
  assert.throws(
    () => normalizeLabelExportResult({
      result: {
        success: true,
        msg: '生成成功'
      }
    }),
    new RegExp(LEGACY_LABEL_EXPORT_HINT)
  );
});

test('label export keeps template types explicit and business-readable', () => {
  assert.deepEqual(LABEL_EXPORT_TEMPLATE_TYPES, {
    film: '膜材信息标签',
    chemical_std: '化材标准瓶信息标签',
    chemical_mini: '化材小瓶信息标签'
  });
});

test('label export file names include the selected template label and CST timestamp', () => {
  const exportedAt = new Date('2026-03-24T07:22:52.000Z');

  assert.equal(
    buildLabelExportFileName('film', exportedAt),
    '膜材信息标签_20260324_1522.xlsx'
  );
  assert.equal(
    buildLabelExportFileName('chemical_std', exportedAt),
    '化材标准瓶信息标签_20260324_1522.xlsx'
  );
});

test('film label export row keeps only the governed print fields and resolves latest film specs', () => {
  const row = buildLabelExportRow('film', {
    unique_code: 'L000201',
    product_code: 'M-001',
    material_name: 'PET离型基膜50u',
    sub_category: '基材-PET',
    batch_number: 'PET2601',
    dynamic_attrs: {
      width_mm: 520
    },
    expiry_date: new Date('2026-07-01T00:00:00.000Z')
  }, {
    material: {
      specs: {
        thickness_um: 50,
        standard_width_mm: 510
      }
    }
  });

  assert.deepEqual(row, {
    标签编号: 'L000201',
    产品代码: 'M-001',
    物料名称: 'PET离型基膜50u',
    子类别: '基材-PET',
    厚度: '50 μm',
    幅宽: '520 mm',
    批次: 'PET2601',
    过期日期: '2026-07-01'
  });
});

test('chemical label export rows stay minimal for standard and mini bottle templates', () => {
  const standardRow = buildLabelExportRow('chemical_std', {
    unique_code: 'L000101',
    product_code: 'J-001',
    material_name: '丙酮分析纯'
  }, {});
  const miniRow = buildLabelExportRow('chemical_mini', {
    unique_code: 'L000105',
    product_code: 'J-003',
    material_name: '固化剂B'
  }, {});

  assert.deepEqual(standardRow, {
    标签编号: 'L000101',
    产品代码: 'J-001',
    物料名称: '丙酮分析纯'
  });
  assert.deepEqual(miniRow, {
    标签编号: 'L000105',
    产品代码: 'J-003'
  });
});

test('label export preserves the user-selected record order when generating print data', () => {
  const records = [
    { _id: 'id-2', unique_code: 'L000102' },
    { _id: 'id-1', unique_code: 'L000101' },
    { _id: 'id-3', unique_code: 'L000103' }
  ];

  const ordered = sortLabelExportRecordsBySelection(records, ['id-1', 'id-3', 'id-2']);

  assert.deepEqual(
    ordered.map(item => item.unique_code),
    ['L000101', 'L000103', 'L000102']
  );
});

test('label export workbook uses one business-readable sheet per selected template', async () => {
  const workbook = await buildLabelExportWorkbook({
    templateType: 'film',
    exportedAt: new Date('2026-03-24T07:22:52.000Z'),
    rows: [
      {
        标签编号: 'L000201',
        产品代码: 'M-001',
        物料名称: 'PET离型基膜50u',
        子类别: '基材-PET',
        厚度: '50 μm',
        幅宽: '520 mm',
        批次: 'PET2601',
        过期日期: '2026-07-01'
      }
    ]
  });

  const sheet = workbook.getWorksheet('膜材信息标签');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, '膜材信息标签');
  assert.match(String(sheet.getCell('A2').value || ''), /导出时间：2026-03-24 15:22:52/);
  assert.deepEqual(sheet.getRow(4).values.slice(1), [
    '标签编号',
    '产品代码',
    '物料名称',
    '子类别',
    '厚度',
    '幅宽',
    '批次',
    '过期日期'
  ]);
  assert.equal(sheet.getCell('A5').value, 'L000201');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 4);
});
