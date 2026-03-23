// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;
const ALERT_CONFIG = require('./alert-config');
const { getCstDayStart } = require('./cst-time');

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

    const groupedInventoryRes = await db.collection('inventory').aggregate()
      .match({ status: 'in_stock' })
      .group({
        _id: '$product_code',
        category: $.first('$category'),
        earliestExpiry: $.min('$expiry_date'),
        earliestDynamicExpiry: $.min('$dynamic_attrs.expiry_date'),
        totalChemicalQty: $.sum('$quantity.val'),
        totalFilmLength: $.sum('$dynamic_attrs.current_length_m')
      })
      .end();

    const groupedInventory = groupedInventoryRes.list || [];
    const futureTime = future30d.getTime();
    let riskCount = 0;

    groupedInventory.forEach((item) => {
      let isRisky = false;
      const expiryCandidate = item.earliestExpiry || item.earliestDynamicExpiry || null;

      if (expiryCandidate) {
        const expiryTime = new Date(expiryCandidate).getTime();
        if (!Number.isNaN(expiryTime) && expiryTime <= futureTime) {
          isRisky = true;
        }
      }

        if (!isRisky) {
        if (item.category === 'chemical') {
          const qty = Number(item.totalChemicalQty) || 0;
          if (qty <= ALERT_CONFIG.LOW_STOCK.chemical) {
            isRisky = true;
          }
        } else if (item.category === 'film') {
          const len = Number(item.totalFilmLength) || 0;
          if (len <= ALERT_CONFIG.LOW_STOCK.film) {
            isRisky = true;
          }
        }
      }

      if (isRisky) {
        riskCount += 1;
      }
    });

    return {
        totalMaterials: groupedInventory.length,
        todayIn: inboundCount.total,
        todayOut: outboundCount.total,
        lowStock: riskCount,
        riskCount,
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
