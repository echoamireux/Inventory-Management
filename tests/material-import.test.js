const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTemplateInlineHintRow,
  validateImportRow,
  buildImportResultMessage,
  applyImportDuplicateGuards,
  decorateImportPreviewRows
} = require('../miniprogram/utils/material-import');

const subcategoriesByCategory = {
  chemical: ['主胶', '树脂', '溶剂'],
  film: ['基材-PET', '基材-BOPP', '保护膜']
};
const productCodePrefixes = [
  { prefix: 'J', category: 'chemical', status: 'active' },
  { prefix: 'S', category: 'chemical', status: 'active' },
  { prefix: 'JP', category: 'chemical', status: 'active' },
  { prefix: 'M', category: 'film', status: 'active' }
];

function chemicalRow({
  prefix = 'J',
  number = '001',
  name = '异丙醇',
  subCategory = '溶剂',
  unit = 'L',
  packageType = '桶装',
  supplier = '国药',
  supplierModel = 'IPA-99',
  isTestMaterial = '否'
} = {}) {
  return [isTestMaterial, '化材', prefix, number, name, subCategory, unit, packageType, '', '', supplier, supplierModel];
}

function filmRow({
  prefix = 'M',
  number = '002',
  name = 'PET保护膜',
  subCategory = '保护膜',
  unit = 'm',
  thickness = '25',
  width = '1240',
  supplier = '东丽',
  supplierModel = 'T100',
  isTestMaterial = '否'
} = {}) {
  return [isTestMaterial, '膜材', prefix, number, name, subCategory, unit, '', thickness, width, supplier, supplierModel];
}

test('import validation normalizes flexible product code input into the standard three-digit format', () => {
  const result = validateImportRow(
    chemicalRow({ prefix: 'JP', number: '1', name: '乙酸乙酯', unit: 'kg', packageType: '塑料桶', supplier: '供应商A', supplierModel: '型号A' }),
    0,
    subcategoriesByCategory,
    productCodePrefixes
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'JP-001');
  assert.equal(result.product_code_prefix, 'JP');
  assert.equal(result.product_code_number, '001');
});

test('import validation rejects old single product-code column templates', () => {
  const result = validateImportRow(
    ['J-001', '乙酸乙酯', '化材', '溶剂', 'kg', '塑料桶', '', '', '供应商A', '型号A', '否'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '请使用最新版物料导入模板：产品代码已拆分为“代码前缀”和“产品编号”两列');
});

test('import validation rejects deprecated "其他" semantics and requires managed subcategories', () => {
  const result = validateImportRow(
    filmRow({ name: '测试膜材', subCategory: '其他', width: '1200' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '子类别无效，请填写系统内已启用的正式子类别');
});

test('import validation rejects malformed product codes even when category and other fields look valid', () => {
  const result = validateImportRow(
    chemicalRow({ number: '1234', name: '丙酮', unit: 'kg', packageType: '' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '产品代码必须为 1-3 位数字');
});

test('import validation rejects hyphenated prefixes and prefixed product numbers in the new template', () => {
  const hyphenatedPrefix = validateImportRow(
    chemicalRow({ prefix: 'J-', number: '001' }),
    0,
    subcategoriesByCategory
  );
  const prefixedNumber = validateImportRow(
    chemicalRow({ prefix: 'J', number: 'J-001' }),
    1,
    subcategoriesByCategory
  );
  const tooLongPrefix = validateImportRow(
    chemicalRow({ prefix: 'ABCDE', number: '001' }),
    2,
    subcategoriesByCategory
  );

  assert.equal(hyphenatedPrefix.error, '代码前缀只能填写 1-4 位大写英文字母，例如 J、JP、LAB');
  assert.equal(prefixedNumber.error, '产品代码必须为 1-3 位数字');
  assert.equal(tooLongPrefix.error, '代码前缀只能填写 1-4 位大写英文字母，例如 J、JP、LAB');
});

test('import validation rejects prefixes that do not belong to the selected category', () => {
  const filmWithChemicalPrefix = validateImportRow(
    filmRow({ prefix: 'S', number: '001' }),
    0,
    subcategoriesByCategory,
    productCodePrefixes
  );
  const chemicalWithFilmPrefix = validateImportRow(
    chemicalRow({ prefix: 'M', number: '001' }),
    1,
    subcategoriesByCategory,
    productCodePrefixes
  );

  assert.equal(filmWithChemicalPrefix.error, '膜材代码前缀必须选择 M');
  assert.equal(filmWithChemicalPrefix.product_code, '');
  assert.equal(chemicalWithFilmPrefix.error, '化材代码前缀必须选择 J、S、JP');
  assert.equal(chemicalWithFilmPrefix.product_code, '');
});

test('import validation supports the new prefix-plus-number master-data template', () => {
  const result = validateImportRow(
    chemicalRow({ isTestMaterial: '是' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'J-001');
  assert.equal(result.default_unit, 'L');
  assert.equal(result.package_type, '桶装');
  assert.equal(result.supplier, '国药');
  assert.equal(result.supplier_model, 'IPA-99');
  assert.equal(result.is_test_material, true);
  assert.equal('shelf_life_days' in result, false);
});

test('import validation requires test-material supplier model and keeps label fields for identity import', () => {
  const missingModel = validateImportRow(
    chemicalRow({ isTestMaterial: '是', supplierModel: '' }),
    0,
    subcategoriesByCategory
  );
  const keptIdentityFields = validateImportRow(
    chemicalRow({
      prefix: 'J',
      number: '999',
      name: '环氧树脂样品',
      subCategory: '树脂',
      supplier: '供应商A',
      supplierModel: ' Ａ - １００ ',
      isTestMaterial: '是'
    }),
    1,
    subcategoriesByCategory
  );

  assert.equal(missingModel.error, '测试料原厂型号必填');
  assert.equal(keptIdentityFields.error, null);
  assert.equal(keptIdentityFields.product_code, 'J-999');
  assert.equal(keptIdentityFields.material_name, '环氧树脂样品');
  assert.equal(keptIdentityFields.sub_category, '树脂');
  assert.equal(keptIdentityFields.supplier, '供应商A');
  assert.equal(keptIdentityFields.supplier_model, 'A-100');
  assert.equal(keptIdentityFields.is_test_material, true);
});

test('import validation treats blank test-material flag as formal material and rejects unclear values', () => {
  const blank = validateImportRow(
    chemicalRow({ number: '003', name: '正式胶水', subCategory: '主胶', unit: 'kg', packageType: '', supplier: '', supplierModel: '', isTestMaterial: '' }),
    0,
    subcategoriesByCategory
  );
  const invalid = validateImportRow(
    chemicalRow({ number: '004', name: '不确定样品', unit: 'kg', packageType: '', supplier: '', supplierModel: '', isTestMaterial: '可能' }),
    1,
    subcategoriesByCategory
  );

  assert.equal(blank.error, null);
  assert.equal(blank.is_test_material, false);
  assert.equal(invalid.error, '是否测试料仅支持填写“是”或“否”');
});

test('import validation requires film thickness and default width in the master-data template', () => {
  const missingThickness = validateImportRow(
    filmRow({ thickness: '', width: '1240' }),
    0,
    subcategoriesByCategory
  );
  const missingWidth = validateImportRow(
    filmRow({ width: '' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(missingThickness.error, '膜材厚度必填');
  assert.equal(missingWidth.error, null);
  assert.equal(missingWidth.standard_width_mm, null);
});

test('import validation surfaces a gentle warning when film default width is omitted', () => {
  const result = validateImportRow(
    filmRow({ width: '' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.warning, '默认幅宽未填写，后续需在首次入库或主数据管理中补齐');
});

test('import validation ignores film-only columns for chemicals and chemical-only columns for films', () => {
  const chemical = validateImportRow(
    ['否', '化材', 'J', '001', '异丙醇', '溶剂', 'L', '', '25', '1240', '国药', 'IPA-99'],
    0,
    subcategoriesByCategory
  );
  const film = validateImportRow(
    filmRow({ width: '1240' }),
    0,
    subcategoriesByCategory
  );

  assert.equal(chemical.error, null);
  assert.equal(chemical.package_type, '');
  assert.equal(chemical.thickness_um, null);
  assert.equal(chemical.standard_width_mm, null);

  assert.equal(film.error, null);
  assert.equal(film.package_type, '');
  assert.equal(film.thickness_um, 25);
  assert.equal(film.standard_width_mm, 1240);
});

test('template inline hint row detection follows the current material import hint wording', () => {
  assert.equal(
    isTemplateInlineHintRow(['是/否，空白=否', '必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '正式料选填/测试料必填']),
    true
  );
  assert.equal(
    isTemplateInlineHintRow(['必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '选填', '选填']),
    false
  );
  assert.equal(
    isTemplateInlineHintRow(['两类必填', '两类必填', '两类必填', '两类必填', '两类必填', '化材选填 / 膜材留空', '膜材必填 / 化材留空', '膜材选填 / 化材留空', '两类选填', '两类选填']),
    false
  );
});

test('duplicate guard warns when identical rows share the same normalized product code in one file', () => {
  const rows = applyImportDuplicateGuards([
    {
      rowIndex: 2,
      product_code: 'J-001',
      product_code_number: '001',
      material_name: '异丙醇',
      category: 'chemical',
      sub_category: '溶剂',
      default_unit: 'L',
      package_type: '桶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '国药',
      supplier_model: 'IPA-99',
      error: null,
      warning: ''
    },
    {
      rowIndex: 3,
      product_code: 'J-001',
      product_code_number: '001',
      material_name: '异丙醇',
      category: 'chemical',
      sub_category: '溶剂',
      default_unit: 'L',
      package_type: '桶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '国药',
      supplier_model: 'IPA-99',
      error: null,
      warning: ''
    }
  ]);

  assert.match(rows[0].warning, /产品代码 J-001 在本次导入文件中重复/);
  assert.match(rows[1].warning, /产品代码 J-001 在本次导入文件中重复/);
  assert.equal(rows[0].error, null);
  assert.equal(rows[1].error, null);
});

test('duplicate guard separates test-material identities by product code and supplier model', () => {
  const rows = applyImportDuplicateGuards([
    {
      rowIndex: 2,
      product_code: 'J-999',
      product_code_number: '999',
      material_name: '环氧树脂样品',
      category: 'chemical',
      sub_category: '树脂',
      default_unit: 'kg',
      package_type: '瓶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '供应商A',
      supplier_model: 'MODEL-A',
      is_test_material: true,
      error: null,
      warning: ''
    },
    {
      rowIndex: 3,
      product_code: 'J-999',
      product_code_number: '999',
      material_name: '丙烯酸样品',
      category: 'chemical',
      sub_category: '主胶',
      default_unit: 'kg',
      package_type: '瓶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '供应商B',
      supplier_model: 'MODEL-B',
      is_test_material: true,
      error: null,
      warning: ''
    },
    {
      rowIndex: 4,
      product_code: 'J-999',
      product_code_number: '999',
      material_name: '环氧树脂样品',
      category: 'chemical',
      sub_category: '树脂',
      default_unit: 'kg',
      package_type: '瓶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '另一个供应商',
      supplier_model: 'ＭＯＤＥＬ－Ａ',
      is_test_material: true,
      error: null,
      warning: ''
    }
  ]);

  assert.equal(rows[1].error, null);
  assert.equal(rows[0].error, '测试料 J-999 + 原厂型号 MODEL-A 在本次导入文件中重复，且字段不一致，请统一后再导入');
  assert.equal(rows[1].warning, '');
  assert.equal(rows[2].error, '测试料 J-999 + 原厂型号 MODEL-A 在本次导入文件中重复，且字段不一致，请统一后再导入');
});

test('duplicate guard blocks same-category rows that reuse one product code with conflicting master-data fields', () => {
  const rows = applyImportDuplicateGuards([
    {
      rowIndex: 2,
      product_code: 'J-001',
      product_code_number: '001',
      material_name: '异丙醇',
      category: 'chemical',
      sub_category: '溶剂',
      default_unit: 'L',
      package_type: '桶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '国药',
      supplier_model: 'IPA-99',
      error: null,
      warning: ''
    },
    {
      rowIndex: 3,
      product_code: 'J-001',
      product_code_number: '001',
      material_name: '异丙醇',
      category: 'chemical',
      sub_category: '树脂',
      default_unit: 'kg',
      package_type: '桶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '国药',
      supplier_model: 'IPA-99',
      error: null,
      warning: ''
    }
  ]);

  assert.equal(rows[0].error, '产品代码 J-001 在本次导入文件中重复，且主数据字段不一致，请统一后再导入');
  assert.equal(rows[1].error, '产品代码 J-001 在本次导入文件中重复，且主数据字段不一致，请统一后再导入');
});

test('duplicate guard only warns when one numeric code appears under different categories', () => {
  const rows = applyImportDuplicateGuards([
    {
      rowIndex: 2,
      product_code: 'J-001',
      product_code_number: '001',
      material_name: '异丙醇',
      category: 'chemical',
      sub_category: '溶剂',
      default_unit: 'L',
      package_type: '桶装',
      thickness_um: null,
      standard_width_mm: null,
      supplier: '国药',
      supplier_model: 'IPA-99',
      error: null,
      warning: ''
    },
    {
      rowIndex: 3,
      product_code: 'M-001',
      product_code_number: '001',
      material_name: 'PET保护膜',
      category: 'film',
      sub_category: '保护膜',
      default_unit: 'm',
      package_type: '',
      thickness_um: 25,
      standard_width_mm: 1240,
      supplier: '东丽',
      supplier_model: 'T100',
      error: null,
      warning: ''
    }
  ]);

  assert.match(rows[0].warning, /编号 001 同时出现在化材和膜材中/);
  assert.match(rows[1].warning, /编号 001 同时出现在化材和膜材中/);
  assert.equal(rows[0].error, null);
  assert.equal(rows[1].error, null);
});

test('preview row decoration keeps empty warnings from rendering as visible warning states', () => {
  const rows = decorateImportPreviewRows([
    {
      rowIndex: 2,
      product_code: 'J-001',
      error: null,
      warning: '编号 001 同时出现在化材和膜材中，请确认类别填写无误'
    },
    {
      rowIndex: 3,
      product_code: 'J-002',
      error: null,
      warning: ''
    }
  ]);

  assert.equal(rows[0].hasWarning, true);
  assert.equal(rows[0].hasError, false);
  assert.match(rows[0].previewKey, /J-001/);
  assert.match(rows[0].previewKey, /编号 001 同时出现在化材和膜材中/);
  assert.equal(rows[1].hasWarning, false);
  assert.equal(rows[1].hasError, false);
  assert.match(rows[1].previewKey, /J-002/);
  assert.doesNotMatch(rows[1].previewKey, /warning/);
});

test('import result message includes row-level duplicate and failure feedback', () => {
  const message = buildImportResultMessage({
    created: 1,
    skipped: 1,
    errors: 1,
    results: [
      { rowIndex: 2, product_code: 'J-001', status: 'created', reason: '创建成功' },
      { rowIndex: 3, product_code: 'J-002', status: 'skipped', reason: '产品代码已存在' },
      { rowIndex: 4, product_code: 'J-003', status: 'error', reason: '子类别无效' }
    ]
  });

  assert.match(message, /成功导入 1 条/);
  assert.match(message, /第 3 行 \| J-002 \| 已跳过：产品代码已存在/);
  assert.match(message, /第 4 行 \| J-003 \| 失败：子类别无效/);
});

test('import result message includes non-blocking warnings separately from failures', () => {
  const message = buildImportResultMessage(
    {
      created: 1,
      skipped: 0,
      errors: 0,
      results: []
    },
    [],
    [
      {
        rowIndex: 5,
        product_code: 'M-002',
        warning: '默认幅宽未填写，后续需在首次入库或主数据管理中补齐'
      }
    ]
  );

  assert.match(message, /提醒：/);
  assert.match(message, /第 5 行 \| M-002 \| 提醒：默认幅宽未填写/);
});
