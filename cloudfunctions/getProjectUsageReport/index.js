const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const { buildContainsRegExp } = require('./search');
const { parseCstDateBoundary } = require('./cst-time');
const {
  filterProjectUsageLogs,
  formatProjectUsageLog,
  summarizeProjectUsageLogs
} = require('./project-usage-report');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const MAX_PROJECT_USAGE_LOGS = 5000;

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

function buildQuery(event = {}) {
  const conditions = [{ type: 'outbound' }];
  const projectCode = normalizeText(event.project_code || event.projectCode);
  const keyword = normalizeText(event.keyword || event.searchVal);
  const uniqueCode = normalizeText(event.unique_code || event.uniqueCode);
  const productCode = normalizeText(event.product_code || event.productCode);
  const operator = normalizeText(event.operator || event.operatorFilter);
  const startDate = parseCstDateBoundary(event.startDate || event.start_date);
  const endDate = parseCstDateBoundary(event.endDate || event.end_date, true);

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

async function loadLogs(where, maxRows = MAX_PROJECT_USAGE_LOGS) {
  const pageSize = 200;
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
      throw new Error(`项目用料记录超过 ${maxRows} 条，请缩小日期范围或关键词后再查询`);
    }
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return rows;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(event.pageSize || event.limit) || 20));

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看项目用料');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const where = buildQuery(event);
    const logs = await loadLogs(where);
    const filteredLogs = filterProjectUsageLogs(logs, event);
    const detailList = filteredLogs.map(formatProjectUsageLog);
    const total = detailList.length;
    const offset = (page - 1) * pageSize;
    const list = detailList.slice(offset, offset + pageSize);
    const summaryList = summarizeProjectUsageLogs(filteredLogs);

    return {
      success: true,
      list,
      detailList: list,
      summaryList,
      total,
      page,
      pageSize,
      isEnd: offset + list.length >= total
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message || '项目用料查询失败'
    };
  }
};
