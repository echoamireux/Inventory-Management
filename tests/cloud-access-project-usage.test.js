const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function loadModuleWithMocks(modulePath, mocks) {
  const resolvedModulePath = require.resolve(modulePath);
  delete require.cache[resolvedModulePath];

  const originalLoad = Module._load;
  Module._load = function patchedLoader(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(resolvedModulePath);
  } finally {
    Module._load = originalLoad;
  }
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

test('project usage filter uses structured project selector and non-overflowing actions', () => {
  const pageWxml = read('miniprogram/pages/project-usage/index.wxml');
  const pageWxss = read('miniprogram/pages/project-usage/index.wxss');
  const projectSelectorBlock = pageWxss.match(/\.project-selector\s*\{[\s\S]*?\n\}/)?.[0] || '';

  const pageJson = JSON.parse(read('miniprogram/pages/project-usage/index.json'));

  assert.match(pageWxml, /class="project-selector"/);
  assert.doesNotMatch(pageWxml, /class="project-usage-title"/);
  assert.match(pageWxml, /class="project-usage-subtitle"[\s\S]*按项目、物料、人员和时间查看领料记录/);
  assert.match(pageWxml, /class="project-selector__label"[\s\S]*项目编码/);
  assert.match(pageWxml, /class="project-selector__body"/);
  assert.match(pageWxml, /class="project-selector__code"/);
  assert.match(pageWxml, /class="project-selector__name"/);
  assert.match(pageWxml, /查看全部项目领料记录/);
  assert.doesNotMatch(pageWxml, /<van-cell[\s\S]*title="项目编码"[\s\S]*selectedProjectCode \+ \(selectedProjectName/);
  assert.doesNotMatch(projectSelectorBlock, /border:\s*1px solid/);
  assert.doesNotMatch(projectSelectorBlock, /border-radius:\s*14rpx/);
  assert.match(projectSelectorBlock, /border-bottom:\s*1px solid #eef2f7/);
  assert.match(pageWxss, /\.project-selector__label\s*\{[\s\S]*?width:\s*132rpx/);
  assert.ok(pageJson.usingComponents['van-icon']);
  assert.equal(pageJson.usingComponents['van-cell'], undefined);

  assert.match(pageWxml, /class="filter-actions-primary"[\s\S]*清空筛选[\s\S]*应用日期/);
  assert.match(pageWxml, /class="filter-actions-export"[\s\S]*导出 Excel/);
  assert.doesNotMatch(pageWxss, /grid-template-columns:\s*1fr 1fr 1\.2fr/);
  assert.match(pageWxss, /\.filter-actions-primary[\s\S]*grid-template-columns:\s*1fr 1fr/);
  assert.match(pageWxss, /\.filter-actions-export[\s\S]*width:\s*100%/);
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

test('project usage export pushes the same narrow filters into the database query as page search', () => {
  const exportIndex = read('cloudfunctions/exportProjectUsageReport/index.js');

  assert.match(exportIndex, /event\.keyword|event\.searchVal/);
  assert.match(exportIndex, /event\.unique_code|event\.uniqueCode/);
  assert.match(exportIndex, /event\.product_code|event\.productCode/);
  assert.match(exportIndex, /event\.operator|event\.operatorFilter/);
  assert.match(exportIndex, /buildContainsRegExp/);
  assert.match(exportIndex, /operator_name/);
});

test('project usage export workbook uses professional report styling', () => {
  const {
    PROJECT_USAGE_DETAIL_HEADERS,
    PROJECT_USAGE_SUMMARY_HEADERS,
    buildProjectUsageExportFileName,
    buildWorkbook
  } = loadModuleWithMocks('../cloudfunctions/exportProjectUsageReport/index.js', {
    exceljs: require('../cloudfunctions/exportMaterialTemplate/node_modules/exceljs'),
    'wx-server-sdk': {
      DYNAMIC_CURRENT_ENV: 'mock-env',
      init() {},
      database() {
        return {
          command: {
            and(conditions) {
              return { $and: conditions };
            },
            gte(value) {
              return { $gte: value };
            },
            lte(value) {
              return { $lte: value };
            }
          }
        };
      },
      getWXContext() {
        return { OPENID: 'tester' };
      }
    }
  });

  const exportedAt = new Date('2026-07-01T07:30:00.000Z');
  const workbook = buildWorkbook({
    detailList: [
      {
        project_code: 'OR2026RD02001',
        project_name: 'OR2026RD02-复合双面胶带88D5',
        timestamp: new Date('2026-07-01T06:15:00.000Z'),
        operator_name: '张三',
        product_code: 'J-001',
        material_name: 'UV减粘胶',
        unique_code: 'L000001',
        batch_number: 'B202607',
        quantity: 1.5,
        unit: 'kg',
        withdraw_note: '试验批次 A'
      }
    ],
    summaryList: [
      {
        product_code: 'J-001',
        material_name: 'UV减粘胶',
        unit: 'kg',
        total_quantity: 1.5,
        record_count: 1,
        project_count: 1,
        projects: 'OR2026RD02001'
      }
    ],
    exportedAt,
    filters: {
      projectCode: 'OR2026RD02001',
      startDate: '2026-07-01',
      endDate: '2026-07-31'
    }
  });

  assert.equal(buildProjectUsageExportFileName(exportedAt), '项目用料报表_20260701_1530.xlsx');

  const detailSheet = workbook.getWorksheet('项目用料明细');
  const summarySheet = workbook.getWorksheet('物料汇总');

  assert.ok(detailSheet);
  assert.ok(summarySheet);
  assert.equal(detailSheet.getCell('A1').value, '项目用料明细');
  assert.match(String(detailSheet.getCell('A2').value || ''), /导出时间：2026-07-01 15:30/);
  assert.match(String(detailSheet.getCell('A3').value || ''), /筛选条件：项目编码=OR2026RD02001；开始日期=2026-07-01；结束日期=2026-07-31/);
  assert.deepEqual(detailSheet.getRow(5).values.slice(1), PROJECT_USAGE_DETAIL_HEADERS);
  assert.equal(detailSheet.autoFilter.from.row, 5);
  assert.equal(detailSheet.views[0].state, 'frozen');
  assert.equal(detailSheet.views[0].ySplit, 5);
  assert.equal(detailSheet.getCell('A6').value, 'OR2026RD02001');
  assert.equal(detailSheet.getCell('I6').value, 1.5);
  assert.equal(detailSheet.getCell('I6').numFmt, '0.###');
  assert.equal(detailSheet.getCell('A5').font.bold, true);
  assert.equal(detailSheet.getCell('A5').fill.fgColor.argb, '334155');
  assert.equal(detailSheet.getCell('A6').border.top.style, 'thin');

  assert.equal(summarySheet.getCell('A1').value, '物料汇总');
  assert.match(String(summarySheet.getCell('A3').value || ''), /按产品代码、物料名称和单位汇总/);
  assert.deepEqual(summarySheet.getRow(5).values.slice(1), PROJECT_USAGE_SUMMARY_HEADERS);
  assert.equal(summarySheet.autoFilter.from.row, 5);
  assert.equal(summarySheet.views[0].ySplit, 5);
  assert.equal(summarySheet.getCell('D6').value, 1.5);
  assert.equal(summarySheet.getCell('D6').numFmt, '0.###');
});

test('project usage report cloud functions cap loaded logs and ask users to narrow filters', () => {
  const reportIndex = read('cloudfunctions/getProjectUsageReport/index.js');
  const exportIndex = read('cloudfunctions/exportProjectUsageReport/index.js');

  assert.match(reportIndex, /MAX_PROJECT_USAGE_LOGS/);
  assert.match(exportIndex, /MAX_PROJECT_USAGE_EXPORT_ROWS/);
  assert.match(reportIndex, /缩小日期范围或关键词/);
  assert.match(exportIndex, /缩小日期范围或项目编码/);
});

test('material name guidance is shown in master-data forms and manual document source is updated', () => {
  const adminMaterialEditWxml = read('miniprogram/pages/admin/material-edit.wxml');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');

  assert.match(adminMaterialEditWxml, /物料名称用于现场识别/);
  assert.match(adminMaterialEditWxml, /批号、库位、数量、项目编号不要写入物料名称/);
  assert.match(materialAddWxml, /物料名称用于现场识别/);
});
