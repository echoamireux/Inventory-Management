const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  filterProjectUsageLogs,
  formatProjectUsageLog,
  summarizeProjectUsageLogs
} = require('./project-usage-report');
const { OFFSET_MS, parseCstDateRange } = require('./cst-time');
const { buildContainsRegExp } = require('./search');

let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (_error) {
  ExcelJS = require('../exportMaterialTemplate/node_modules/exceljs');
}

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const MAX_PROJECT_USAGE_EXPORT_ROWS = 10000;
const PROJECT_USAGE_REPORT_TITLE = '项目用料报表';
const PROJECT_USAGE_DETAIL_SHEET_NAME = '项目用料明细';
const PROJECT_USAGE_SUMMARY_SHEET_NAME = '物料汇总';
const PROJECT_USAGE_DETAIL_HEADERS = [
  '项目编码',
  '项目名称',
  '领料时间',
  '领料人',
  '产品代码',
  '物料名称',
  '标签编号',
  '生产批号',
  '数量',
  '单位',
  '备注'
];
const PROJECT_USAGE_SUMMARY_HEADERS = [
  '产品代码',
  '物料名称',
  '单位',
  '合计领用数量',
  '领用记录数',
  '涉及项目数',
  '涉及项目'
];

async function getOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildQuery(event = {}, dateRange = parseCstDateRange(
  event.startDate || event.start_date,
  event.endDate || event.end_date
)) {
  const conditions = [{ type: 'outbound' }];
  const projectCode = normalizeText(event.project_code || event.projectCode);
  const keyword = normalizeText(event.keyword || event.searchVal);
  const uniqueCode = normalizeText(event.unique_code || event.uniqueCode);
  const productCode = normalizeText(event.product_code || event.productCode);
  const operator = normalizeText(event.operator || event.operatorFilter);
  const startDate = dateRange.start;
  const endDate = dateRange.end;

  if (projectCode && projectCode !== 'all') {
    conditions.push({ project_code: projectCode });
  }
  if (uniqueCode) {
    conditions.push({ unique_code: uniqueCode });
  }
  if (productCode) {
    conditions.push({ product_code: productCode });
  }
  if (operator && operator !== 'all') {
    conditions.push(_.or([
      { operator },
      { operator_name: operator },
      { operator_id: operator }
    ]));
  }
  if (startDate) {
    conditions.push({ timestamp: _.gte(startDate) });
  }
  if (endDate) {
    conditions.push({ timestamp: _.lte(endDate) });
  }

  const keywordRegExp = buildContainsRegExp(db, keyword);
  if (keywordRegExp) {
    conditions.push(_.or([
      { project_code: keywordRegExp },
      { project_name: keywordRegExp },
      { product_code: keywordRegExp },
      { material_name: keywordRegExp },
      { unique_code: keywordRegExp },
      { batch_number: keywordRegExp },
      { operator: keywordRegExp },
      { operator_name: keywordRegExp },
      { withdraw_note: keywordRegExp },
      { description: keywordRegExp },
      { note: keywordRegExp }
    ]));
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions);
}

async function loadLogs(where, maxRows = MAX_PROJECT_USAGE_EXPORT_ROWS) {
  const pageSize = 500;
  let skip = 0;
  let rows = [];

  while (true) {
    const res = await db.collection('inventory_log')
      .where(where)
      .orderBy('timestamp', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (rows.length > maxRows) {
      throw new Error(`项目用料导出超过 ${maxRows} 条，请缩小日期范围或项目编码后再导出`);
    }
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return rows;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getCstParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return null;
  }

  const cstDate = new Date(date.getTime() + OFFSET_MS);
  return {
    year: cstDate.getUTCFullYear(),
    month: pad(cstDate.getUTCMonth() + 1),
    day: pad(cstDate.getUTCDate()),
    hour: pad(cstDate.getUTCHours()),
    minute: pad(cstDate.getUTCMinutes())
  };
}

function formatDateTime(value) {
  const parts = getCstParts(value);
  if (!parts) {
    return '';
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function buildProjectUsageExportFileName(exportedAt = new Date()) {
  const parts = getCstParts(exportedAt);
  if (!parts) {
    return `${PROJECT_USAGE_REPORT_TITLE}.xlsx`;
  }
  return `${PROJECT_USAGE_REPORT_TITLE}_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}.xlsx`;
}

function buildThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'E2E8F0' } },
    left: { style: 'thin', color: { argb: 'E2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
    right: { style: 'thin', color: { argb: 'E2E8F0' } }
  };
}

function buildInfoFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'F8FAFC' }
  };
}

function buildHeaderFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '334155' }
  };
}

function normalizeReportText(value, fallback = '--') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function buildFilterSummary(filters = {}) {
  const projectCode = normalizeText(filters.project_code || filters.projectCode);
  const keyword = normalizeText(filters.keyword || filters.searchVal);
  const operator = normalizeText(filters.operator || filters.operatorFilter);
  const startDate = normalizeText(filters.startDate || filters.start_date);
  const endDate = normalizeText(filters.endDate || filters.end_date);
  const parts = [];

  if (projectCode && projectCode !== 'all') {
    parts.push(`项目编码=${projectCode}`);
  }
  if (keyword) {
    parts.push(`关键词=${keyword}`);
  }
  if (operator && operator !== 'all') {
    parts.push(`领料人=${operator}`);
  }
  if (startDate) {
    parts.push(`开始日期=${startDate}`);
  }
  if (endDate) {
    parts.push(`结束日期=${endDate}`);
  }

  return parts.length ? `筛选条件：${parts.join('；')}` : '筛选条件：全部项目用料记录';
}

function applyReportTopRows(sheet, title, infoText, contextText, columnCount) {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: '0F172A' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 24;

  [
    { row: 2, value: infoText },
    { row: 3, value: contextText }
  ].forEach(({ row, value }) => {
    sheet.mergeCells(row, 1, row, columnCount);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.fill = buildInfoFill();
    cell.border = buildThinBorder();
    cell.font = { size: 10, color: { argb: '334155' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 24;
  sheet.getRow(4).height = 6;
}

function addHeaderRow(sheet, headers, headerRowNumber = 5) {
  const headerRow = sheet.getRow(headerRowNumber);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.fill = buildHeaderFill();
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = buildThinBorder();
  });
  headerRow.height = 22;
}

function styleDataRow(row, numberColumns = []) {
  row.eachCell((cell, columnNumber) => {
    cell.border = buildThinBorder();
    cell.alignment = {
      vertical: 'middle',
      horizontal: numberColumns.includes(columnNumber) ? 'right' : 'left',
      wrapText: true
    };
    if (numberColumns.includes(columnNumber)) {
      cell.numFmt = '0.###';
    }
  });
}

function addSheetRows(sheet, rows, options = {}) {
  const headerRowNumber = options.headerRowNumber || 5;
  const numberColumns = options.numberColumns || [];
  const firstDataRowNumber = headerRowNumber + 1;

  rows.forEach((rowValues, index) => {
    const row = sheet.getRow(firstDataRowNumber + index);
    row.values = rowValues;
    styleDataRow(row, numberColumns);
  });

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: options.columnCount || 1 }
  };
  sheet.views = [{ state: 'frozen', xSplit: options.xSplit || 0, ySplit: headerRowNumber }];
}

function normalizeBuildWorkbookInput(detailListOrOptions, summaryList = [], extraOptions = {}) {
  if (Array.isArray(detailListOrOptions)) {
    return {
      detailList: detailListOrOptions,
      summaryList,
      ...extraOptions
    };
  }

  return detailListOrOptions || {};
}

function buildWorkbook(detailListOrOptions, summaryListArg = [], extraOptions = {}) {
  const options = normalizeBuildWorkbookInput(detailListOrOptions, summaryListArg, extraOptions);
  const detailList = options.detailList || [];
  const summaryList = options.summaryList || [];
  const exportedAt = options.exportedAt || new Date();
  const filterSummary = buildFilterSummary(options.filters || {});
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '实验室库存管理系统';
  workbook.created = exportedAt;
  workbook.modified = exportedAt;

  const detailSheet = workbook.addWorksheet(PROJECT_USAGE_DETAIL_SHEET_NAME);
  detailSheet.columns = [
    { width: 18 },
    { width: 34 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 12 },
    { width: 10 },
    { width: 30 }
  ];
  applyReportTopRows(
    detailSheet,
    PROJECT_USAGE_DETAIL_SHEET_NAME,
    `导出时间：${formatDateTime(exportedAt)}；明细记录数：${detailList.length}`,
    filterSummary,
    PROJECT_USAGE_DETAIL_HEADERS.length
  );
  addHeaderRow(detailSheet, PROJECT_USAGE_DETAIL_HEADERS);
  addSheetRows(
    detailSheet,
    detailList.map(item => [
      normalizeReportText(item.project_code),
      normalizeReportText(item.project_name),
      formatDateTime(item.timestamp),
      normalizeReportText(item.operator_name),
      normalizeReportText(item.product_code),
      normalizeReportText(item.material_name),
      normalizeReportText(item.unique_code),
      normalizeReportText(item.batch_number),
      item.quantity,
      normalizeReportText(item.unit),
      normalizeReportText(item.withdraw_note, '')
    ]),
    {
      columnCount: PROJECT_USAGE_DETAIL_HEADERS.length,
      numberColumns: [9],
      xSplit: 2
    }
  );

  const summarySheet = workbook.addWorksheet(PROJECT_USAGE_SUMMARY_SHEET_NAME);
  summarySheet.columns = [
    { width: 14 },
    { width: 26 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 44 }
  ];
  applyReportTopRows(
    summarySheet,
    PROJECT_USAGE_SUMMARY_SHEET_NAME,
    `导出时间：${formatDateTime(exportedAt)}；汇总物料数：${summaryList.length}`,
    `按产品代码、物料名称和单位汇总。${filterSummary}`,
    PROJECT_USAGE_SUMMARY_HEADERS.length
  );
  addHeaderRow(summarySheet, PROJECT_USAGE_SUMMARY_HEADERS);
  addSheetRows(
    summarySheet,
    summaryList.map(item => [
      normalizeReportText(item.product_code),
      normalizeReportText(item.material_name),
      normalizeReportText(item.unit),
      item.total_quantity,
      item.record_count,
      item.project_count,
      normalizeReportText(item.projects, '')
    ]),
    {
      columnCount: PROJECT_USAGE_SUMMARY_HEADERS.length,
      numberColumns: [4, 5, 6],
      xSplit: 2
    }
  );

  return workbook;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可导出项目用料报表');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const dateRange = parseCstDateRange(
      event.startDate || event.start_date,
      event.endDate || event.end_date
    );
    const logs = await loadLogs(buildQuery(event, dateRange));
    const filteredLogs = filterProjectUsageLogs(logs, {
      ...event,
      startTime: dateRange.start,
      endTime: dateRange.end
    });
    const detailList = filteredLogs.map(formatProjectUsageLog);
    const summaryList = summarizeProjectUsageLogs(filteredLogs);
    const exportedAt = new Date();
    const workbook = buildWorkbook({
      detailList,
      summaryList,
      exportedAt,
      filters: event
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = buildProjectUsageExportFileName(exportedAt);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${OPENID}/project-usage/current.xlsx`,
      fileContent: buffer
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName,
      total: detailList.length,
      msg: '导出成功'
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message || '导出项目用料报表失败'
    };
  }
};

module.exports = {
  PROJECT_USAGE_DETAIL_HEADERS,
  PROJECT_USAGE_SUMMARY_HEADERS,
  buildFilterSummary,
  buildProjectUsageExportFileName,
  buildWorkbook,
  formatDateTime,
  main: exports.main
};
