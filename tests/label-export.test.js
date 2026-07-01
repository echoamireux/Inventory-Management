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
  buildNextLabelCodes,
  buildPreprintLabelRecords,
  buildPreprintLabelExportRow,
  assertPreprintPayload,
  buildPreprintRequestSignature
} = require('../cloudfunctions/exportLabelData/preprint-labels');
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
      fileName: '膜材信息标签_20260324_1530.xlsx',
      raw: {
        success: true,
        fileID: 'cloud://label-export.xlsx',
        fileName: '膜材信息标签_20260324_1530.xlsx'
      }
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

test('label export result exposes failed cloud payload for recoverable preprint errors', () => {
  assert.throws(
    () => normalizeLabelExportResult({
      result: {
        success: false,
        code: 'PREPRINT_EXPORT_FAILED',
        job_id: 'preprint-job-1',
        records: [{ unique_code: 'L000001' }],
        msg: '标签已生成，但 Excel 导出失败'
      }
    }),
    (error) => {
      assert.equal(error.message, '标签已生成，但 Excel 导出失败');
      assert.equal(error.result.code, 'PREPRINT_EXPORT_FAILED');
      assert.equal(error.result.job_id, 'preprint-job-1');
      assert.equal(error.result.records[0].unique_code, 'L000001');
      return true;
    }
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
  assert.equal(
    buildLabelExportFileName('film', exportedAt, { startLabelCode: 'L000033' }),
    '标签打印_膜材信息标签_L000033_20260324_152252.xlsx'
  );
});

test('film label export row keeps only static preprint fields and resolves latest film specs', () => {
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
    二维码内容: 'L000201',
    产品代码: 'M-001',
    物料名称: 'PET离型基膜50u',
    子类别: '基材-PET',
    原厂型号: '',
    厚度: '50 μm',
    幅宽: '520 mm'
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(row, '批次'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, '过期日期'));
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
    二维码内容: 'L000101',
    产品代码: 'J-001',
    物料名称: '丙酮分析纯',
    原厂型号: ''
  });
  assert.deepEqual(miniRow, {
    标签编号: 'L000105',
    二维码内容: 'L000105',
    产品代码: 'J-003',
    原厂型号: ''
  });
});

test('label export includes source model and sample note for test materials', () => {
  const filmRow = buildLabelExportRow('film', {
    unique_code: 'L000901',
    product_code: 'M-999',
    material_name: '测试料-膜材',
    sub_category: '保护膜',
    batch_number: 'TEST-F01',
    is_test_material: true,
    supplier_model: 'TEST-FILM-01',
    sample_note: '客户A送样，雾面白膜',
    dynamic_attrs: {
      width_mm: 520,
      thickness_um: 50
    },
    is_long_term_valid: true
  }, {});
  const chemicalRow = buildLabelExportRow('chemical_std', {
    unique_code: 'L000902',
    product_code: 'J-999',
    material_name: '测试料-化材',
    is_test_material: true,
    supplier_model: 'TEST-CHEM-01',
    sample_note: '透明液体，客户B打样'
  }, {});

  assert.equal(filmRow.原厂型号, 'TEST-FILM-01');
  assert.equal(chemicalRow.原厂型号, 'TEST-CHEM-01');
  assert.equal(filmRow.样品说明, '客户A送样，雾面白膜');
  assert.equal(chemicalRow.样品说明, '透明液体，客户B打样');
});

test('preprint label code generator skips inventory and historical preprint codes', () => {
  assert.deepEqual(
    buildNextLabelCodes({
      count: 4,
      existingCodes: ['L000001', 'L000003'],
      startNumber: 1
    }),
    ['L000002', 'L000004', 'L000005', 'L000006']
  );
});

test('preprint label records snapshot material fields and require model for test materials', () => {
  assert.throws(() => {
    assertPreprintPayload({
      templateType: 'chemical_std',
      count: 1,
      material: {
        _id: 'mat-test',
        product_code: 'J-999',
        material_name: '测试料-化材',
        category: 'chemical',
        is_test_material: true
      },
      form: {}
    });
  }, /测试料预生成标签必须填写原厂型号/);

  const records = buildPreprintLabelRecords({
    templateType: 'chemical_std',
    labelCodes: ['L000010'],
    material: {
      _id: 'mat-test',
      product_code: 'J-999',
      material_name: '测试料-化材',
      category: 'chemical',
      sub_category: '测试样',
      is_test_material: true
    },
    form: {
      supplier_model: 'TEST-CHEM-01',
      supplier: '供应商A',
      sample_note: '透明液体'
    },
    operatorOpenid: 'openid-1',
    operatorName: '张三',
    now: new Date('2026-06-25T02:00:00.000Z')
  });

  assert.equal(records[0].unique_code, 'L000010');
  assert.equal(records[0].qr_content, 'L000010');
  assert.equal(records[0].status, 'unused');
  assert.equal(records[0].supplier_model, 'TEST-CHEM-01');
  assert.equal(records[0].sample_note, '透明液体');
});

test('preprint request signature only treats identical generation parameters as reusable', () => {
  const material = {
    _id: 'mat-test',
    product_code: 'J-999',
    material_name: '测试料-化材',
    category: 'chemical',
    is_test_material: true
  };
  const base = buildPreprintRequestSignature({
    templateType: 'chemical_std',
    count: 3,
    material,
    form: {
      supplier_model: 'TEST-CHEM-01',
      supplier: '供应商A',
      sample_note: '透明液体'
    }
  });

  assert.equal(base, buildPreprintRequestSignature({
    templateType: 'chemical_std',
    count: '3',
    material,
    form: {
      supplier_model: 'TEST-CHEM-01',
      supplier: '供应商A',
      sample_note: '透明液体'
    }
  }));
  assert.notEqual(base, buildPreprintRequestSignature({
    templateType: 'chemical_std',
    count: 6,
    material,
    form: {
      supplier_model: 'TEST-CHEM-01',
      supplier: '供应商A',
      sample_note: '透明液体'
    }
  }));
  assert.notEqual(base, buildPreprintRequestSignature({
    templateType: 'chemical_std',
    count: 3,
    material,
    form: {
      supplier_model: 'TEST-CHEM-02',
      supplier: '供应商A',
      sample_note: '透明液体'
    }
  }));
});

test('preprint export rows include qr content and template-specific source model', () => {
  const row = buildPreprintLabelExportRow({
    template_type: 'chemical_mini',
    unique_code: 'L000020',
    qr_content: 'L000020',
    product_code: 'J-999',
    material_name: '测试料-化材',
    supplier_model: 'TEST-CHEM-02',
    sample_note: '小瓶评估样',
    is_test_material: true
  });

  assert.deepEqual(row, {
    标签编号: 'L000020',
    二维码内容: 'L000020',
    产品代码: 'J-999',
    原厂型号: 'TEST-CHEM-02',
    样品说明: '小瓶评估样'
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

test('label export workbook keeps readable template sheet and adds BarTender data sheet', async () => {
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
        幅宽: '520 mm'
      }
    ]
  });

  const sheet = workbook.getWorksheet('膜材信息标签');
  assert.ok(sheet);
  assert.ok(workbook.getWorksheet('BarTender数据'));
  assert.equal(sheet.getCell('A1').value, '膜材信息标签');
  assert.match(String(sheet.getCell('A2').value || ''), /导出时间：2026-03-24 15:22:52/);
  assert.deepEqual(sheet.getRow(4).values.slice(1), [
    '标签编号',
    '二维码内容',
    '产品代码',
    '物料名称',
    '子类别',
    '原厂型号',
    '厚度',
    '幅宽'
  ]);
  assert.equal(sheet.getCell('I4').value, null);
  assert.equal(sheet.getCell('A5').value, 'L000201');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 4);

  const bartenderSheet = workbook.getWorksheet('BarTender数据');
  assert.deepEqual(bartenderSheet.getRow(1).values.slice(1), [
    '标签编号',
    '二维码内容',
    '产品代码',
    '物料名称',
    '子类别',
    '原厂型号',
    '厚度',
    '幅宽'
  ]);
  assert.equal(bartenderSheet.getCell('I1').value, null);
  assert.equal(bartenderSheet.getCell('A2').value, 'L000201');
  assert.equal(bartenderSheet.getCell('B2').value, '--');
  assert.equal(bartenderSheet.views[0].state, 'frozen');
  assert.equal(bartenderSheet.views[0].ySplit, 1);
});
