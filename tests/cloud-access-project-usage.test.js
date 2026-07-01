const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

const FRONTEND_CORE_FILES = [
  'miniprogram/pages/inventory-detail/index.js',
  'miniprogram/pages/material-edit/index.js',
  'miniprogram/utils/inventory-label-query.js',
  'miniprogram/pages/index/index.js',
  'miniprogram/pages/logs/index.js',
  'miniprogram/pages/admin-logs/index.js',
  'miniprogram/pages/admin/user-list.js',
  'miniprogram/pages/super-admin/user-manage/index.js',
  'miniprogram/pages/admin/approval-center/index.js',
  'miniprogram/pages/material-add/index.js',
  'miniprogram/pages/material-add/batch-entry.js'
];

test('frontend core pages no longer read core collections directly', () => {
  const offenders = [];
  const directCoreCollectionPattern = /collection\(\s*['"](inventory|materials|users|material_requests|inventory_correction_requests|inventory_log)['"]\s*\)/;

  for (const relPath of FRONTEND_CORE_FILES) {
    const source = read(relPath);
    if (directCoreCollectionPattern.test(source)) {
      offenders.push(relPath);
    }
  }

  assert.deepEqual(offenders, []);
});

test('project usage report page is registered and reachable from the home page', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');

  assert.match(appJson, /"pages\/project-usage\/index"/);
  assert.match(homeWxml, /项目用料查询/);
  assert.match(homeWxml, /url="\/pages\/project-usage\/index"/);
});

test('project usage cloud functions and deployable dependencies exist', () => {
  assert.equal(exists('cloudfunctions/getProjectUsageReport/index.js'), true);
  assert.equal(exists('cloudfunctions/getProjectUsageReport/project-usage-report.js'), true);
  assert.equal(exists('cloudfunctions/getProjectUsageReport/auth.js'), true);
  assert.equal(exists('cloudfunctions/getProjectUsageReport/search.js'), true);
  assert.equal(exists('cloudfunctions/getProjectUsageReport/cst-time.js'), true);
  assert.equal(exists('cloudfunctions/getProjectUsageReport/package.json'), true);

  assert.equal(exists('cloudfunctions/exportProjectUsageReport/index.js'), true);
  assert.equal(exists('cloudfunctions/exportProjectUsageReport/project-usage-report.js'), true);
  assert.equal(exists('cloudfunctions/exportProjectUsageReport/auth.js'), true);
  assert.equal(exists('cloudfunctions/exportProjectUsageReport/cst-time.js'), true);
  assert.equal(exists('cloudfunctions/exportProjectUsageReport/package.json'), true);

  const getPackage = JSON.parse(read('cloudfunctions/getProjectUsageReport/package.json'));
  const exportPackage = JSON.parse(read('cloudfunctions/exportProjectUsageReport/package.json'));
  assert.ok(getPackage.dependencies['wx-server-sdk']);
  assert.ok(exportPackage.dependencies['wx-server-sdk']);
  assert.ok(exportPackage.dependencies.exceljs);
});

test('project usage summary groups outbound logs by material and unit', () => {
  const {
    filterProjectUsageLogs,
    summarizeProjectUsageLogs,
    formatProjectUsageLog
  } = require('../cloudfunctions/getProjectUsageReport/project-usage-report');

  const logs = [
    {
      _id: 'log-1',
      type: 'outbound',
      project_code: 'OR2026RD02001',
      project_name: '项目A',
      product_code: 'J-001',
      material_name: 'UV减粘胶',
      unique_code: 'L000001',
      batch_number: 'B1',
      quantity_change: -1.5,
      unit: 'kg',
      operator: '张三',
      timestamp: new Date('2026-07-01T01:00:00.000Z')
    },
    {
      _id: 'log-2',
      type: 'outbound',
      project_code: 'OR2026RD02001',
      project_name: '项目A',
      product_code: 'J-001',
      material_name: 'UV减粘胶',
      unique_code: 'L000002',
      batch_number: 'B2',
      quantity_change: -2,
      unit: 'kg',
      operator: '李四',
      timestamp: new Date('2026-07-01T02:00:00.000Z')
    },
    {
      _id: 'log-3',
      type: 'outbound',
      project_code: 'OR2026RD02002',
      project_name: '项目B',
      product_code: 'M-001',
      material_name: 'PET离型膜 50um',
      unique_code: 'L000003',
      batch_number: 'B3',
      quantity_change: -3,
      unit: 'm',
      operator: '王五',
      timestamp: new Date('2026-07-01T03:00:00.000Z')
    }
  ];

  const summary = summarizeProjectUsageLogs(logs);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary[0], {
    product_code: 'J-001',
    material_name: 'UV减粘胶',
    unit: 'kg',
    total_quantity: 3.5,
    record_count: 2,
    project_count: 1,
    projects: 'OR2026RD02001'
  });
  assert.equal(summary[1].product_code, 'M-001');
  assert.equal(summary[1].total_quantity, 3);

  const formatted = formatProjectUsageLog(logs[0]);
  assert.equal(formatted.quantity, 1.5);
  assert.equal(formatted.project_code, 'OR2026RD02001');
  assert.equal(formatted.operator_name, '张三');

  const filteredByEndDate = filterProjectUsageLogs(logs, {
    startDate: '2026-07-01',
    endDate: '2026-07-01'
  });
  assert.equal(filteredByEndDate.length, 3);
});

test('project usage export workbook declares detail and summary sheets', () => {
  const exportIndex = read('cloudfunctions/exportProjectUsageReport/index.js');

  assert.match(exportIndex, /项目用料明细/);
  assert.match(exportIndex, /物料汇总/);
  assert.match(exportIndex, /project_code/);
  assert.match(exportIndex, /project_name/);
  assert.match(exportIndex, /withdraw_note/);
  assert.match(exportIndex, /uploadFile/);
});

test('material name guidance is shown in master-data forms and manual document source is updated', () => {
  const adminMaterialEditWxml = read('miniprogram/pages/admin/material-edit.wxml');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');

  assert.match(adminMaterialEditWxml, /物料名称用于现场识别/);
  assert.match(adminMaterialEditWxml, /批号、库位、数量、项目编号不要写入物料名称/);
  assert.match(materialAddWxml, /物料名称用于现场识别/);
});
