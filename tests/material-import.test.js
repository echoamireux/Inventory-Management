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
    ['J-1', '乙酸乙酯', '化材', '溶剂', '', 'kg', '供应商A', '型号A', '365'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'J-001');
  assert.equal(result.product_code_number, '001');
});

test('import validation rejects deprecated "其他" semantics and requires managed subcategories', () => {
  const result = validateImportRow(
    ['001', '测试膜材', '膜材', '其他', '自定义说明', 'm', '', '', ''],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '子类别无效，请填写系统内已启用的正式子类别');
});

test('import validation rejects malformed product codes even when category and other fields look valid', () => {
  const result = validateImportRow(
    ['1234', '丙酮', '化材', '溶剂', '', 'kg', '', '', ''],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, '产品代码必须为 1-3 位数字');
});

test('import validation supports the new 8-column template without legacy note column', () => {
  const result = validateImportRow(
    ['001', '异丙醇', '化材', '溶剂', 'L', '国药', 'IPA-99'],
    0,
    subcategoriesByCategory
  );

  assert.equal(result.error, null);
  assert.equal(result.product_code, 'J-001');
  assert.equal(result.default_unit, 'L');
  assert.equal(result.supplier, '国药');
  assert.equal('shelf_life_days' in result, false);
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
