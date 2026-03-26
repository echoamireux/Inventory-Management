const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isInventoryTemplateGroupHeaderRow,
  isInventoryTemplateHeaderRow,
  isInventoryTemplateInlineHintRow,
  EMPTY_INVENTORY_TEMPLATE_ROWS_HINT,
  buildEmptyInventoryTemplatePreviewResult,
  validateInventoryTemplateHeaderRows,
  buildInventoryImportPreviewRow,
  decorateInventoryImportPreviewRows,
  buildInventoryImportPayload
} = require('../cloudfunctions/importInventoryTemplate/inventory-import');

function buildContext(overrides = {}) {
  return {
    materialsByCode: new Map(),
    existingUniqueCodes: new Set(),
    duplicateUniqueCodes: new Set(),
    currentInventoryByProductCode: new Map(),
    zoneMapsByCategory: {
      chemical: new Map([
        ['实验室1', { zone_key: 'builtin:chemical:lab1', name: '实验室1' }],
        ['物料间', { zone_key: 'builtin:chemical:store-room', name: '物料间' }]
      ]),
      film: new Map([
        ['研发仓1', { zone_key: 'builtin:film:rnd1', name: '研发仓1' }],
        ['实验线', { zone_key: 'builtin:film:line', name: '实验线' }]
      ])
    },
    ...overrides
  };
}

test('inventory template import preview result normalizes valid payloads and rejects legacy structures', () => {
  const {
    LEGACY_IMPORT_TEMPLATE_HINT,
    normalizeInventoryTemplatePreviewResult,
    normalizeInventoryTemplateSubmitResult
  } = require('../miniprogram/utils/inventory-template-import');

  assert.deepEqual(
    normalizeInventoryTemplatePreviewResult({
      result: {
        success: true,
        list: [{ unique_code: 'L000301' }],
        validCount: '1',
        errorCount: '2',
        warningCount: null
      }
    }),
    {
      success: true,
      list: [{ unique_code: 'L000301' }],
      validCount: 1,
      errorCount: 2,
      warningCount: 0
    }
  );

  assert.throws(
    () => normalizeInventoryTemplatePreviewResult({
      result: {
        success: true,
        msg: '预览成功'
      }
    }),
    new RegExp(LEGACY_IMPORT_TEMPLATE_HINT)
  );

  assert.deepEqual(
    normalizeInventoryTemplateSubmitResult({
      result: {
        success: true,
        created: '3',
        msg: '成功入库 3 条'
      }
    }),
    {
      success: true,
      created: 3,
      msg: '成功入库 3 条'
    }
  );
});

test('inventory template import uses an explicit empty-data message instead of a success empty list payload', () => {
  assert.equal(
    EMPTY_INVENTORY_TEMPLATE_ROWS_HINT,
    '未检测到数据行，请从第 4 行开始填写后直接上传 .xlsx 文件'
  );

  assert.deepEqual(buildEmptyInventoryTemplatePreviewResult(), {
    success: false,
    msg: '未检测到数据行，请从第 4 行开始填写后直接上传 .xlsx 文件'
  });
});

test('inventory template inline hint row detection follows the governed stock-in wording', () => {
  assert.equal(
    isInventoryTemplateInlineHintRow([
      '必填',
      '必填',
      '必填',
      '必填',
      '必填',
      '选填',
      '化材必填',
      '化材选填',
      '膜材条件必填',
      '膜材必填',
      '膜材必填',
      '选填',
      '选填',
      '二选一',
      '二选一'
    ]),
    true
  );
});

test('inventory template header row detection supports grouped new template rows', () => {
  assert.equal(
    isInventoryTemplateGroupHeaderRow([
      '基础信息', '', '', '',
      '库位信息', '',
      '化材信息', '',
      '膜材信息', '', '',
      '来源信息', '',
      '时效信息', ''
    ]),
    true
  );

  assert.equal(
    isInventoryTemplateHeaderRow([
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
    ]),
    true
  );
});

test('inventory template import keeps the formal header row as the only hard gate', () => {
  const validResult = validateInventoryTemplateHeaderRows([
    {
      rowIndex: 1,
      values: ['基础信息', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '时效信息', '']
    },
    {
      rowIndex: 2,
      values: [
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
      ]
    },
    {
      rowIndex: 3,
      values: ['必填', '必填', '必填', '必填', '必填', '选填', '化材必填', '化材选填', '膜材条件必填', '膜材必填', '膜材必填', '选填', '选填', '二选一', '二选一']
    }
  ]);

  assert.equal(validResult.ok, true);
  assert.equal(validResult.code, '');
  assert.equal(validResult.msg, '');
  assert.deepEqual(validResult.details, {
    headerRowIndex: 2,
    dataStartRowIndex: 4
  });

  const weakRowsStillValid = validateInventoryTemplateHeaderRows([
    {
      rowIndex: 1,
      values: ['基础信息（第三方软件重写）', '', '', '', '时效信息', '', '库位信息', '', '来源信息', '', '化材信息', '', '膜材信息', '', '']
    },
    {
      rowIndex: 2,
      values: [
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
      ]
    },
    {
      rowIndex: 3,
      values: ['这一行提示文案被用户改了', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
    }
  ]);

  assert.equal(weakRowsStillValid.ok, true);
  assert.equal(weakRowsStillValid.code, '');
  assert.equal(weakRowsStillValid.msg, '');
  assert.deepEqual(weakRowsStillValid.details, {
    headerRowIndex: 2,
    dataStartRowIndex: 4
  });

  const mismatchResult = validateInventoryTemplateHeaderRows([
    {
      rowIndex: 1,
      values: ['基础信息', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '时效信息', '']
    },
    {
      rowIndex: 2,
      values: [
        '标签编号*',
        '产品代码*',
        '类别*',
        '生产批号*',
        '过期日期',
        '长期有效',
        '存储区域*',
        '详细坐标',
        '供应商',
        '原厂型号',
        '净含量',
        '包装形式',
        '膜材厚度(μm)',
        '本批次实际幅宽(mm)',
        '长度(m)'
      ]
    }
  ]);

  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.code, 'header_mismatch');
  assert.equal(mismatchResult.msg, '库存入库表字段顺序不正确，请使用系统当前模板中的正式字段行');
  assert.equal(mismatchResult.details.headerRowIndex, 2);
  assert.deepEqual(mismatchResult.details.expectedHeader, [
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
  assert.deepEqual(mismatchResult.details.actualHeader, [
    '标签编号*',
    '产品代码*',
    '类别*',
    '生产批号*',
    '过期日期',
    '长期有效',
    '存储区域*',
    '详细坐标',
    '供应商',
    '原厂型号',
    '净含量',
    '包装形式',
    '膜材厚度(μm)',
    '本批次实际幅宽(mm)',
    '长度(m)'
  ]);
  assert.match(mismatchResult.details.actualHeaderSummary, /过期日期/);
});

test('inventory import preview resolves governed chemical rows against current master data and active zones', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 4,
    values: ['L000301', '001', '化材', 'AC240301', '实验室1', 'A01', '2', '桶装', '', '', '', '国药', 'IPA-99', '2026-10-01', '']
  }, buildContext({
    materialsByCode: new Map([
      ['J-001', {
        _id: 'mat-j-001',
        product_code: 'J-001',
        category: 'chemical',
        material_name: '丙酮分析纯',
        sub_category: '溶剂',
        default_unit: 'kg',
        supplier: '',
        supplier_model: ''
      }]
    ])
  }));

  assert.equal(preview.error, '');
  assert.equal(preview.unique_code, 'L000301');
  assert.equal(preview.product_code, 'J-001');
  assert.equal(preview.material_name, '丙酮分析纯');
  assert.equal(preview.sub_category, '溶剂');
  assert.equal(preview.zone_key, 'builtin:chemical:lab1');
  assert.equal(preview.location, '实验室1 | A01');
  assert.equal(preview.quantity_unit, 'kg');
  assert.equal(preview.quantity_summary, '2 kg');
});

test('inventory import preview keeps missing-material feedback at row level', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 4,
    values: ['L000399', '211', '化材', 'AC260325', '实验室1', 'A01', '2', '桶装', '', '', '', '国药', 'IPA-99', '2026-10-01', '']
  }, buildContext());

  assert.equal(preview.product_code, 'J-211');
  assert.match(preview.error, /产品代码 J-211 未在标准库中找到，请先完成物料建档后再导入/);
});

test('inventory import preview treats an eligible duplicate chemical label as refill instead of an error', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 4,
    values: ['L000401', '001', '化材', 'AC240401', '实验室1', 'A02', '2', '桶装', '', '', '', '国药', 'IPA-99', '2026-10-01', '']
  }, buildContext({
    materialsByCode: new Map([
      ['J-001', {
        _id: 'mat-j-001',
        product_code: 'J-001',
        category: 'chemical',
        material_name: '丙酮分析纯',
        sub_category: '溶剂',
        default_unit: 'kg'
      }]
    ]),
    existingInventoryByUniqueCode: new Map([
      ['L000401', {
        _id: 'inv-401',
        unique_code: 'L000401',
        status: 'in_stock',
        category: 'chemical',
        product_code: 'J-001',
        batch_number: 'AC240401',
        quantity: { val: 5, unit: 'kg' },
        dynamic_attrs: { weight_kg: 5 }
      }]
    ])
  }));

  assert.equal(preview.error, '');
  assert.equal(preview.submit_action, 'refill');
  assert.equal(preview.refill_inventory_id, 'inv-401');
  assert.match(preview.warning, /将按补料入库处理/);
});

test('inventory import preview keeps duplicate film labels blocked even when the batch matches', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 4,
    values: ['L000402', '001', '膜材', 'PET240401', '研发仓1', 'B02', '', '', '25', '1080', '100', '', '', '2026-10-01', '']
  }, buildContext({
    materialsByCode: new Map([
      ['M-001', {
        _id: 'mat-m-001',
        product_code: 'M-001',
        category: 'film',
        material_name: 'PET保护膜',
        sub_category: '保护膜',
        default_unit: 'm',
        specs: {
          thickness_um: 25,
          standard_width_mm: 1080
        }
      }]
    ]),
    existingInventoryByUniqueCode: new Map([
      ['L000402', {
        _id: 'inv-402',
        unique_code: 'L000402',
        status: 'in_stock',
        category: 'film',
        product_code: 'M-001',
        batch_number: 'PET240401',
        quantity: { val: 100, unit: 'm' },
        dynamic_attrs: {
          current_length_m: 100,
          initial_length_m: 100,
          width_mm: 1080
        }
      }]
    ])
  }));

  assert.match(preview.error, /已存在/);
  assert.equal(preview.submit_action || '', '');
});

test('inventory import preview warns when a chemical row looks duplicated against current in-stock inventory', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 4,
    values: ['L000302', '001', '化材', 'AC240301', '实验室1', 'A01', '2', '桶装', '', '', '', '国药', 'IPA-99', '2026-10-01', '']
  }, buildContext({
    materialsByCode: new Map([
      ['J-001', {
        _id: 'mat-j-001',
        product_code: 'J-001',
        category: 'chemical',
        material_name: '丙酮分析纯',
        sub_category: '溶剂',
        default_unit: 'kg'
      }]
    ]),
    currentInventoryByProductCode: new Map([
      ['J-001', [{
        status: 'in_stock',
        unique_code: 'L000101',
        product_code: 'J-001',
        batch_number: 'AC240301',
        quantity: {
          val: 2,
          unit: 'kg'
        }
      }]]
    ])
  }));

  assert.equal(preview.error, '');
  assert.match(preview.warning, /当前在库已有 1 条同产品代码、同批号、同数量记录/);
  assert.match(preview.warning, /标签编号：L000101/);
});

test('inventory import preview derives film quantity summary and backfill reminders from manual stock-in rules', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 5,
    values: ['L000401', '001', '膜材', 'PET2601', '研发仓1', 'F01', '', '', '50', '1080', '100', '', '', '', '是']
  }, buildContext({
    materialsByCode: new Map([
      ['M-001', {
        _id: 'mat-m-001',
        product_code: 'M-001',
        category: 'film',
        material_name: 'PET离型基膜50u',
        sub_category: '基材-PET',
        default_unit: 'm²',
        specs: {}
      }]
    ])
  }));

  assert.equal(preview.error, '');
  assert.equal(preview.product_code, 'M-001');
  assert.equal(preview.quantity_summary, '108 m²（基准长度 100 m）');
  assert.match(preview.warning, /将补齐主数据厚度为 50 μm/);
  assert.match(preview.warning, /将补齐主数据默认幅宽为 1080 mm/);
});

test('inventory import preview warns on multi-hit film duplicates and ignores non in-stock or near-miss records', () => {
  const preview = buildInventoryImportPreviewRow({
    rowIndex: 5,
    values: ['L000402', '001', '膜材', 'PET2601', '研发仓1', 'F01', '', '', '50', '1080', '100', '', '', '', '是']
  }, buildContext({
    materialsByCode: new Map([
      ['M-001', {
        _id: 'mat-m-001',
        product_code: 'M-001',
        category: 'film',
        material_name: 'PET离型基膜50u',
        sub_category: '基材-PET',
        default_unit: 'm²',
        specs: {
          thickness_um: 50,
          standard_width_mm: 1080
        }
      }]
    ]),
    currentInventoryByProductCode: new Map([
      ['M-001', [
        {
          status: 'in_stock',
          unique_code: 'L000201',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 108, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1080 }
        },
        {
          status: 'in_stock',
          unique_code: 'L000202',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 108, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1080 }
        },
        {
          status: 'in_stock',
          unique_code: 'L000203',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 108, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1080 }
        },
        {
          status: 'in_stock',
          unique_code: 'L000204',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 108, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1080 }
        },
        {
          status: 'used',
          unique_code: 'L000205',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 108, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1080 }
        },
        {
          status: 'in_stock',
          unique_code: 'L000206',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 109.08, unit: 'm²' },
          dynamic_attrs: { current_length_m: 101, width_mm: 1080 }
        },
        {
          status: 'in_stock',
          unique_code: 'L000207',
          product_code: 'M-001',
          batch_number: 'PET2601',
          quantity: { val: 100, unit: 'm²' },
          dynamic_attrs: { current_length_m: 100, width_mm: 1000 }
        }
      ]]
    ])
  }));

  assert.equal(preview.error, '');
  assert.match(preview.warning, /当前在库已有 4 条同产品代码、同批号、同数量记录/);
  assert.match(preview.warning, /L000201、L000202、L000203/);
  assert.match(preview.warning, /等 4 条/);
  assert.doesNotMatch(preview.warning, /L000205/);
  assert.doesNotMatch(preview.warning, /L000206/);
  assert.doesNotMatch(preview.warning, /L000207/);
});

test('inventory import preview rejects duplicate labels, archived materials, and missing governed film thickness', () => {
  const duplicate = buildInventoryImportPreviewRow({
    rowIndex: 7,
    values: ['L000101', '001', '化材', 'AC240302', '实验室1', '', '1', '', '', '', '', '', '', '2026-10-02', '']
  }, buildContext({
    existingUniqueCodes: new Set(['L000101']),
    materialsByCode: new Map([
      ['J-001', {
        _id: 'mat-j-001',
        product_code: 'J-001',
        category: 'chemical',
        material_name: '丙酮分析纯',
        sub_category: '溶剂',
        default_unit: 'kg'
      }]
    ])
  }));

  const archived = buildInventoryImportPreviewRow({
    rowIndex: 8,
    values: ['L000601', '099', '化材', 'OLD2401', '物料间', '', '1', '', '', '', '', '', '', '2026-10-03', '']
  }, buildContext({
    materialsByCode: new Map([
      ['J-099', {
        _id: 'mat-j-099',
        product_code: 'J-099',
        category: 'chemical',
        material_name: '旧版清洗剂',
        sub_category: '溶剂',
        default_unit: 'kg',
        status: 'archived'
      }]
    ])
  }));

  const missingThickness = buildInventoryImportPreviewRow({
    rowIndex: 9,
    values: ['L000701', '002', '膜材', 'PET2602', '实验线', '', '', '', '', '1200', '80', '', '', '', '是']
  }, buildContext({
    materialsByCode: new Map([
      ['M-002', {
        _id: 'mat-m-002',
        product_code: 'M-002',
        category: 'film',
        material_name: '保护膜A',
        sub_category: '保护膜',
        default_unit: 'm',
        specs: {}
      }]
    ])
  }));

  assert.match(duplicate.error, /标签编号 L000101 已存在/);
  assert.match(archived.error, /已归档/);
  assert.match(missingThickness.error, /膜材主数据缺少厚度/);
});

test('inventory import preview decoration exposes stable keys and warning flags for the mini-program list', () => {
  const rows = decorateInventoryImportPreviewRows([
    { rowIndex: 3, unique_code: 'L000301', product_code: 'J-001', error: '', warning: '' },
    { rowIndex: 4, unique_code: 'L000401', product_code: 'M-001', error: '', warning: '将补齐主数据默认幅宽为 1080 mm' }
  ]);

  assert.equal(rows[0].hasError, false);
  assert.equal(rows[0].hasWarning, false);
  assert.equal(typeof rows[0].previewKey, 'string');
  assert.equal(rows[1].hasWarning, true);
});

test('inventory import payload follows manual stock-in semantics for film truth and governed master backfill', () => {
  const payload = buildInventoryImportPayload({
    rowIndex: 10,
    unique_code: 'L000801',
    product_code: 'M-001',
    material_name: 'PET离型基膜50u',
    category: 'film',
    sub_category: '基材-PET',
    batch_number: 'PET2603',
    zone_key: 'builtin:film:rnd1',
    location: '研发仓1 | F02',
    location_detail: 'F02',
    is_long_term_valid: false,
    expiry_date: '2026-12-31',
    quantity_unit: 'm²',
    length_m: 100,
    batch_width_mm: 1080,
    thickness_um: 50,
    supplier: '',
    supplier_model: ''
  }, {
    _id: 'mat-m-001',
    product_code: 'M-001',
    category: 'film',
    material_name: 'PET离型基膜50u',
    sub_category: '基材-PET',
    default_unit: 'm²',
    specs: {}
  });

  assert.equal(payload.inventoryData.dynamic_attrs.current_length_m, 100);
  assert.equal(payload.inventoryData.dynamic_attrs.width_mm, 1080);
  assert.equal(payload.inventoryData.dynamic_attrs.thickness_um, 50);
  assert.equal(payload.inventoryData.quantity.val, 108);
  assert.equal(payload.inventoryData.quantity.unit, 'm²');
  assert.deepEqual(payload.masterSpecBackfill, {
    thickness_um: 50,
    standard_width_mm: 1080
  });
  assert.equal(payload.logData.description, '模板导入入库');
  assert.equal(payload.logData.quantity_change, 100);
  assert.equal(payload.logData.unit, 'm');
});
