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

test('template spec keeps the governed workbook structure and seven-column headers', () => {
  const spec = buildMaterialTemplateSpec({
    chemicalSubcategories: ['主胶', '树脂', '溶剂'],
    filmSubcategories: ['基材-PET', '基材-BOPP', '保护膜']
  });

  assert.equal(spec.dataSheetName, DATA_SHEET_NAME);
  assert.equal(spec.configSheetName, CONFIG_SHEET_NAME);
  assert.equal(spec.helpSheetName, HELP_SHEET_NAME);
  assert.deepEqual(spec.headers, TEMPLATE_HEADERS);
  assert.equal(spec.headers.length, 7);
  assert.deepEqual(spec.unitOptions, {
    chemical: ['kg', 'g', 'L', 'mL'],
    film: ['m', 'm²']
  });
  assert.equal(spec.previewStyledRowCount, 50);
  assert.deepEqual(spec.validationRanges, {
    productCode: 'A2:A3000',
    category: 'C2:C3000',
    subcategory: 'D2:D3000',
    unit: 'E2:E3000'
  });
  assert.equal(
    spec.validationFormulae.subcategory,
    'INDIRECT($C2&"_子类")'
  );
  assert.equal(
    spec.validationFormulae.unit,
    'INDIRECT($C2&"_单位")'
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
    }
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
    filmSubcategories: ['基材-PET', '基材-BOPP', '保护膜']
  });

  assert.match(spec.helpLines[spec.helpLines.length - 2], /当前化材子类别：主胶 \/ 树脂 \/ 溶剂/);
  assert.match(spec.helpLines[spec.helpLines.length - 1], /当前膜材子类别：基材-PET \/ 基材-BOPP \/ 保护膜/);
  assert.deepEqual(spec.exampleRows, [
    ['001', '异丙醇', '化材', '溶剂', 'L', '国药', 'IPA-99'],
    ['002', 'PET保护膜', '膜材', '保护膜', 'm', '东丽', 'T100']
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
