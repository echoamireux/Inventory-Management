// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ALERT_CONFIG = require('./alert-config');
const { getCstDayStart } = require('./cst-time');
const { calculateDashboardStatsFromItems } = require('./dashboard-stats');

// Industry Standard Logic
// 1. Total Materials: Distinct Product Count
// 2. Today In/Out: Log counts
// 3. Alerts: Distinct Products with Risk (Expiry or Low Stock)

exports.main = async (event, context) => {
  try {
    const now = new Date();

    // 修复: 使用纯数学方法计算 UTC+8 的今日 00:00:00
    // 这种写法不依赖服务器本地时区 (无论是 UTC+0 还是 UTC+8 还是 UTC-5)
    // 逻辑：
    // 1. 获取当前绝对时间戳 (UTC)
    // 2. 加上 8 小时偏移量，得到 "CST 视角的毫秒数"
    // 3. 对一天 (24h) 取模并减去，相当于 "抹零" 到 CST 的 00:00:00
    // 4. 再减回 8 小时偏移量，得到该时刻对应的 UTC 时间戳

    const startOfDayUTC = getCstDayStart(now);

    // Future Date for Expiry (Use Config)
    const future30d = new Date(now.getTime() + ALERT_CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // 2. Today In/Out Logs (使用修复后的时区计算)
    const inboundCount = await db.collection('inventory_log').where({
        type: 'inbound',
        timestamp: _.gte(startOfDayUTC)
    }).count();

    const outboundCount = await db.collection('inventory_log').where({
        type: _.or(_.eq('withdraw'), _.eq('outbound')),
        timestamp: _.gte(startOfDayUTC)
    }).count();

    // 3. Alerts & Total Calculation (JS Memory Processing)
    // REFACTOR: Use JS Memory Processing for robustness against Data Types (String vs Date)

    const pageSize = 500;
    let skip = 0;
    let list = [];

    while (true) {
      const invRes = await db.collection('inventory')
          .where({ status: 'in_stock' }) // Fetch only needed fields
          .field({
              product_code: true,
              category: true,
              quantity: true,
              expiry_date: true,
              dynamic_attrs: true
          })
          .skip(skip)
          .limit(pageSize)
          .get();

      list = list.concat(invRes.data || []);
      if (!invRes.data || invRes.data.length < pageSize) break;
      skip += pageSize;
    }

    const stats = calculateDashboardStatsFromItems(list, ALERT_CONFIG);

    return {
        totalMaterials: stats.totalMaterials,
        todayIn: inboundCount.total,
        todayOut: outboundCount.total,
        lowStock: stats.lowStock,
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
