const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_HEADERS,
  HELP_SHEET_NAME,
  CONFIG_SHEET_NAME,
  DATA_SHEET_NAME,
  getActiveTemplateSubcategoryNames,
  validateTemplateSubcategoryState,
  buildMaterialTemplateSpec
} = require('../cloudfunctions/_shared/material-template');

test('template spec keeps the governed workbook structure and prefix-plus-number headers', () => {
  const spec = buildMaterialTemplateSpec({
    chemicalSubcategories: ['主胶', '树脂', '溶剂'],
    filmSubcategories: ['基材-PET', '基材-BOPP', '保护膜'],
    codePrefixes: [
      { prefix: 'J', category: 'chemical', status: 'active', sort_order: 10 },
      { prefix: 'S', category: 'chemical', status: 'active', sort_order: 20 },
      { prefix: 'Y', category: 'chemical', status: 'active', sort_order: 30 },
      { prefix: 'M', category: 'film', status: 'active', sort_order: 40 }
    ]
  });

  assert.equal(spec.dataSheetName, DATA_SHEET_NAME);
  assert.equal(spec.configSheetName, CONFIG_SHEET_NAME);
  assert.equal(spec.helpSheetName, HELP_SHEET_NAME);
  assert.deepEqual(spec.headers, TEMPLATE_HEADERS);
  assert.equal(spec.headers.length, 12);
  assert.deepEqual(spec.unitOptions, {
    chemical: ['g', 'kg', 'mL', 'L'],
    film: ['m', 'm²']
  });
  assert.deepEqual(spec.packageTypeOptions, ['瓶装', '桶装', '袋装', '卷装', '盒装']);
  assert.equal(spec.previewStyledRowCount, 50);
  assert.deepEqual(spec.validationRanges, {
    codePrefix: 'A3:A3000',
    productCodeNumber: 'B3:B3000',
    category: 'D3:D3000',
    subcategory: 'E3:E3000',
    unit: 'F3:F3000',
    packageType: 'G3:G3000',
    thicknessUm: 'H3:H3000',
    standardWidthMm: 'I3:I3000'
  });
  assert.equal(spec.validationFormulae.codePrefix, 'INDIRECT($D3&"_前缀")');
  assert.equal(
    spec.validationFormulae.subcategory,
    'INDIRECT($D3&"_子类")'
  );
  assert.equal(
    spec.validationFormulae.unit,
    'INDIRECT($D3&"_单位")'
  );
  assert.deepEqual(spec.definedNames, {
    chemicalSubcategories: {
      name: '化材_子类',
      range: 'Config!$A$2:$A$4'
    },
    filmSubcategories: {
      name: '膜材_子类',
      range: 'Config!$B$2:$B$4'
    },
    chemicalUnits: {
      name: '化材_单位',
      range: 'Config!$C$2:$C$5'
    },
    filmUnits: {
      name: '膜材_单位',
      range: 'Config!$D$2:$D$3'
    },
    chemicalCodePrefixes: {
      name: '化材_前缀',
      range: 'Config!$E$2:$E$4'
    },
    filmCodePrefixes: {
      name: '膜材_前缀',
      range: 'Config!$F$2:$F$2'
    },
    chemicalPackageTypes: {
      name: '化材_包装形式',
      range: 'Config!$G$2:$G$6'
    }
  });
  assert.deepEqual(spec.codePrefixOptions, ['J', 'S', 'Y', 'M']);
  assert.deepEqual(spec.codePrefixOptionsByCategory, {
    chemical: ['J', 'S', 'Y'],
    film: ['M']
  });
});

test('active template subcategories only include active non-deprecated records in sorted order', () => {
  const records = [
    {
      subcategory_key: 'builtin:chemical:other',
      name: '其他 (Other)',
      parent_category: 'chemical',
      status: 'active',
      sort_order: 5
    },
    {
      subcategory_key: 'builtin:chemical:resin',
      name: '树脂',
      parent_category: 'chemical',
      status: 'active',
      sort_order: 20
    },
    {
      subcategory_key: 'builtin:chemical:solvent',
      name: '溶剂',
      parent_category: 'chemical',
      status: 'active',
      sort_order: 10
    },
    {
      subcategory_key: 'custom:chemical:disabled',
      name: '停用项',
      parent_category: 'chemical',
      status: 'disabled',
      sort_order: 30
    }
  ];

  assert.deepEqual(
    getActiveTemplateSubcategoryNames(records, 'chemical'),
    ['溶剂', '树脂']
  );
});

test('template spec keeps representative example rows aligned with the new governed subcategories', () => {
  const spec = buildMaterialTemplateSpec({
    chemicalSubcategories: ['主胶', '树脂', '溶剂'],
    filmSubcategories: ['基材-PET', '基材-BOPP', '保护膜'],
    codePrefixes: [
      { prefix: 'J', category: 'chemical', status: 'active', sort_order: 10 },
      { prefix: 'S', category: 'chemical', status: 'active', sort_order: 20 },
      { prefix: 'Y', category: 'chemical', status: 'active', sort_order: 30 },
      { prefix: 'M', category: 'film', status: 'active', sort_order: 40 }
    ]
  });
  const helpText = spec.helpLines.join('\n');

  assert.match(helpText, /当前化材子类别：主胶 \/ 树脂 \/ 溶剂/);
  assert.match(helpText, /当前膜材子类别：基材-PET \/ 基材-BOPP \/ 保护膜/);
  assert.doesNotMatch(helpText, /CSV/);
  assert.match(helpText, /直接上传 \.xlsx/);
  assert.match(helpText, /代码前缀\*：必填/);
  assert.match(helpText, /产品编号\*：必填/);
  assert.match(helpText, /化材包装形式：选填/);
  assert.match(helpText, /当前化材代码前缀：J \/ S \/ Y/);
  assert.match(helpText, /当前膜材代码前缀：M/);
  assert.match(helpText, /当前化材包装形式：瓶装 \/ 桶装 \/ 袋装 \/ 卷装 \/ 盒装/);
  assert.match(helpText, /膜材厚度\(μm\)\*：膜材必填/);
  assert.match(helpText, /默认幅宽\(mm\)：膜材选填/);
  assert.match(helpText, /供应商：选填。正式物料写主数据供应商；测试料写该型号默认供应商/);
  assert.match(helpText, /原厂型号：正式物料选填；测试料必填，用于区分同一测试料产品代码下的不同样品/);
  assert.match(helpText, /选择“是”时，本行会维护测试料型号，物料名称和子类别用于标签、入库和库存展示/);
  assert.doesNotMatch(helpText, /供应商、原厂型号：选填/);
  assert.match(helpText, /是否测试料：填“是”或“否”，空白按“否”处理；选择“是”时，本行会维护测试料型号/);
  assert.deepEqual(spec.inlineHints, [
    '必填',
    '必填',
    '必填',
    '必填',
    '必填',
    '必填',
    '化材选填',
    '膜材必填',
    '膜材选填',
    '选填',
    '选填',
    '选填'
  ]);
  assert.match(helpText, /产品代码已存在.*会跳过/);
  assert.deepEqual(spec.exampleRows, [
    ['J', '001', '异丙醇', '化材', '溶剂', 'L', '桶装', '', '', '国药', 'IPA-99', '否'],
    ['J', '999', '环氧树脂样品', '化材', '溶剂', 'g', '瓶装', '', '', '供应商A', 'TEST-RESIN-A', '是'],
    ['M', '002', 'PET保护膜', '膜材', '保护膜', 'm', '', '25', '1240', '东丽', 'T100', '否']
  ]);
});

test('template export validation fails clearly when either governed category lacks active subcategories', () => {
  assert.deepEqual(
    validateTemplateSubcategoryState({
      chemicalSubcategories: ['溶剂'],
      filmSubcategories: []
    }),
    {
      ok: false,
      msg: '膜材当前没有可用子类别，请先在子类别管理中维护后再导出模板'
    }
  );

  assert.deepEqual(
    validateTemplateSubcategoryState({
      chemicalSubcategories: [],
      filmSubcategories: ['基材-PET']
    }),
    {
      ok: false,
      msg: '化材当前没有可用子类别，请先在子类别管理中维护后再导出模板'
    }
  );
});
