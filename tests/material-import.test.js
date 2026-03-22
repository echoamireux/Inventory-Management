const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateImportRow,
  buildImportResultMessage
} = require('../miniprogram/utils/material-import');

const subcategoriesByCategory = {
  chemical: ['主胶', '树脂', '溶剂'],
  film: ['基材-PET', '基材-BOPP', '保护膜']
};

test('import validation normalizes flexible product code input into the standard three-digit format', () => {
  const result = validateImportRow(
    ['J-1', '乙酸乙酯', '化材', '溶剂', 'kg', '塑料桶', '', '', '供应商A', '型号A'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'J-001');
  assert.equal(result.product_code_number, '001');
});

test('import validation rejects deprecated "其他" semantics and requires managed subcategories', () => {
  const result = validateImportRow(
    ['001', '测试膜材', '膜材', '其他', 'm', '', '25', '1200', '', ''],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '子类别无效，请填写系统内已启用的正式子类别');
});

test('import validation rejects malformed product codes even when category and other fields look valid', () => {
  const result = validateImportRow(
    ['1234', '丙酮', '化材', '溶剂', 'kg', '', '', '', '', ''],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '产品代码必须为 1-3 位数字');
});

test('import validation supports the new 10-column master-data template', () => {
  const result = validateImportRow(
    ['001', '异丙醇', '化材', '溶剂', 'L', '铁桶', '', '', '国药', 'IPA-99'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'J-001');
  assert.equal(result.default_unit, 'L');
  assert.equal(result.package_type, '铁桶');
  assert.equal(result.supplier, '国药');
  assert.equal(result.supplier_model, 'IPA-99');
  assert.equal('shelf_life_days' in result, false);
});

test('import validation requires film thickness and default width in the master-data template', () => {
  const missingThickness = validateImportRow(
    ['002', 'PET保护膜', '膜材', '保护膜', 'm', '', '', '1240', '东丽', 'T100'],
    0,
    subcategoriesByCategory
  );
  const missingWidth = validateImportRow(
    ['002', 'PET保护膜', '膜材', '保护膜', 'm', '', '25', '', '东丽', 'T100'],
    0,
    subcategoriesByCategory
  );

  assert.equal(missingThickness.error, '膜材厚度必填');
  assert.equal(missingWidth.error, null);
  assert.equal(missingWidth.standard_width_mm, null);
});

test('import validation surfaces a gentle warning when film default width is omitted', () => {
  const result = validateImportRow(
    ['002', 'PET保护膜', '膜材', '保护膜', 'm', '', '25', '', '东丽', 'T100'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.warning, '默认幅宽未填写，后续需在首次入库或物料管理中补齐');
});

test('import validation ignores film-only columns for chemicals and chemical-only columns for films', () => {
  const chemical = validateImportRow(
    ['001', '异丙醇', '化材', '溶剂', 'L', '', '25', '1240', '国药', 'IPA-99'],
    0,
    subcategoriesByCategory
  );
  const film = validateImportRow(
    ['002', 'PET保护膜', '膜材', '保护膜', 'm', '铁桶', '25', '1240', '东丽', 'T100'],
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
        warning: '默认幅宽未填写，后续需在首次入库或物料管理中补齐'
      }
    ]
  );

  assert.match(message, /提醒：/);
  assert.match(message, /第 5 行 \| M-002 \| 提醒：默认幅宽未填写/);
});
