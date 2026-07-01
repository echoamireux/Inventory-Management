// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ALERT_CONFIG = require('./alert-config');
const { getCstDayStart } = require('./cst-time');
const { assertActiveUserAccess } = require('./auth');
const { calculateDashboardStatsFromItems } = require('./dashboard-stats');

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function loadInventoryItems(pageSize = 100) {
  let skip = 0;
  let rows = [];
  let batch = [];

  do {
    const res = await db.collection('inventory')
      .where({ status: 'in_stock' })
      .field({
        product_code: true,
        category: true,
        quantity: true,
        dynamic_attrs: true,
        expiry_date: true
      })
      .skip(skip)
      .limit(pageSize)
      .get();

    batch = res.data || [];
    rows = rows.concat(batch);
    skip += pageSize;
  } while (batch.length === pageSize);

  return rows;
}

// Industry Standard Logic
// 1. Total Materials: Distinct Product Count
// 2. Today In/Out: Log counts
// 3. Alerts: Distinct Products with Risk (Expiry or Low Stock)

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看首页统计');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const now = new Date();

    // 修复: 使用纯数学方法计算 UTC+8 的今日 00:00:00
    // 这种写法不依赖服务器本地时区 (无论是 UTC+0 还是 UTC+8 还是 UTC-5)
    // 逻辑：
    // 1. 获取当前绝对时间戳 (UTC)
    // 2. 加上 8 小时偏移量，得到 "CST 视角的毫秒数"
    // 3. 对一天 (24h) 取模并减去，相当于 "抹零" 到 CST 的 00:00:00
    // 4. 再减回 8 小时偏移量，得到该时刻对应的 UTC 时间戳

    const startOfDayUTC = getCstDayStart(now);

    // 2. Today In/Out Logs (使用修复后的时区计算)
    const inboundCount = await db.collection('inventory_log').where({
        type: _.in(['inbound', 'refill']),
        timestamp: _.gte(startOfDayUTC)
    }).count();

    const outboundCount = await db.collection('inventory_log').where({
        type: _.or(_.eq('withdraw'), _.eq('outbound')),
        timestamp: _.gte(startOfDayUTC)
    }).count();

    const inventoryItems = await loadInventoryItems();
    const stats = calculateDashboardStatsFromItems(inventoryItems, ALERT_CONFIG);

    return {
        totalMaterials: stats.totalMaterials,
        todayIn: inboundCount.total,
        todayOut: outboundCount.total,
        lowStock: stats.lowStock,
        riskCount: stats.riskCount,
        success: true
    };

  } catch (err) {
    console.error(err);
    return {
        success: false,
        msg: err.message
    };
  }
}
