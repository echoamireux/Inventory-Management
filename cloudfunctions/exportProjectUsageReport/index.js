const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  filterProjectUsageLogs,
  formatProjectUsageLog,
  summarizeProjectUsageLogs
} = require('./project-usage-report');

const ExcelJS = require('exceljs');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const MAX_PROJECT_USAGE_EXPORT_ROWS = 10000;

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

function toDate(value, endOfDay = false) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function buildQuery(event = {}) {
  const conditions = [{ type: 'outbound' }];
  const projectCode = normalizeText(event.project_code || event.projectCode);
  const startDate = toDate(event.startDate || event.start_date);
  const endDate = toDate(event.endDate || event.end_date, true);

  if (projectCode && projectCode !== 'all') {
    conditions.push({ project_code: projectCode });
  }
  if (startDate) {
    conditions.push({ timestamp: _.gte(startDate) });
  }
  if (endDate) {
    conditions.push({ timestamp: _.lte(endDate) });
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

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addHeaderRow(sheet, headers) {
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
}

function buildWorkbook(detailList, summaryList) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '实验室库存管理系统';
  workbook.created = new Date();

  const detailSheet = workbook.addWorksheet('项目用料明细');
  addHeaderRow(detailSheet, [
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
  ]);
  detailList.forEach((item) => {
    detailSheet.addRow([
      item.project_code,
      item.project_name,
      formatDateTime(item.timestamp),
      item.operator_name,
      item.product_code,
      item.material_name,
      item.unique_code,
      item.batch_number,
      item.quantity,
      item.unit,
      item.withdraw_note
    ]);
  });
  detailSheet.columns = [
    { width: 18 },
    { width: 34 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 24 },
    { width: 14 },
    { width: 18 },
    { width: 12 },
    { width: 10 },
    { width: 28 }
  ];

  const summarySheet = workbook.addWorksheet('物料汇总');
  addHeaderRow(summarySheet, [
    '产品代码',
    '物料名称',
    '单位',
    '合计领用数量',
    '领用记录数',
    '涉及项目数',
    '涉及项目'
  ]);
  summaryList.forEach((item) => {
    summarySheet.addRow([
      item.product_code,
      item.material_name,
      item.unit,
      item.total_quantity,
      item.record_count,
      item.project_count,
      item.projects
    ]);
  });
  summarySheet.columns = [
    { width: 14 },
    { width: 24 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 42 }
  ];

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

    const logs = await loadLogs(buildQuery(event));
    const filteredLogs = filterProjectUsageLogs(logs, event);
    const detailList = filteredLogs.map(formatProjectUsageLog);
    const summaryList = summarizeProjectUsageLogs(filteredLogs);
    const workbook = buildWorkbook(detailList, summaryList);
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `项目用料报表_${Date.now()}.xlsx`;
    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${fileName}`,
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
