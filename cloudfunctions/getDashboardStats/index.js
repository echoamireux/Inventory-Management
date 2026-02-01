// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// Industry Standard Logic
// 1. Total Materials: Distinct Product Count
// 2. Today In/Out: Log counts
// 3. Alerts: Distinct Products with Risk (Expiry or Low Stock)

exports.main = async (event, context) => {
  try {
    const now = new Date();

    // 修复: 使用 UTC+8 时区计算今日起始时间
    // 云函数运行环境通常是 UTC，需要手动偏移到中国时区
    const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
    const chinaTime = new Date(utcNow + CHINA_OFFSET_MS);

    // 计算中国时区的今日 00:00:00
    const startOfDay = new Date(chinaTime);
    startOfDay.setHours(0, 0, 0, 0);
    // 转换回 UTC 时间用于数据库查询
    const startOfDayUTC = new Date(startOfDay.getTime() - CHINA_OFFSET_MS + (now.getTimezoneOffset() * 60000));

    // Future Date for Expiry (30 Days)
    const future30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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

    const MAX_LIMIT = 1000;
    const invRes = await db.collection('inventory')
        .where({ status: 'in_stock' }) // Fetch only needed fields
        .field({
            product_code: true,
            category: true,
            quantity: true,
            expiry_date: true,
            dynamic_attrs: true
        })
        .limit(MAX_LIMIT)
        .get();

    const list = invRes.data || [];

    // JS Processing Sets for Uniqueness
    const uniqueMaterials = new Set();
    const riskyProducts = new Set();

    const nowTime = now.getTime();
    const future30dTime = nowTime + (30 * 24 * 60 * 60 * 1000);

    for (const item of list) {
        const pCode = item.product_code || 'UNKNOWN';
        uniqueMaterials.add(pCode);

        let isRisky = false;

        // A. Expiry Risk (Robust Check)
        let expDate = null;
        // Try Root Level
        if (item.expiry_date) {
            expDate = new Date(item.expiry_date);
        }
        // Try Legacy Path
        else if (item.dynamic_attrs && item.dynamic_attrs.expiry_date) {
            expDate = new Date(item.dynamic_attrs.expiry_date);
        }

        // Compare Logic
        if (expDate && !isNaN(expDate.getTime())) {
            if (expDate.getTime() <= future30dTime) {
                isRisky = true;
                // console.log('Expiring Item:', pCode, expDate);
            }
        }

        // B. Low Stock Risk
        // Only check if not already risky to save cpu? No, correct logic is OR.
        // Actually if isRisky is true, we can skip other checks for this ITEM.
        // But we are grouping by PRODUCT. So if *this* item is risky, the product is risky.
        if (!isRisky) {
            const qty = (item.quantity && item.quantity.val) || 0;
            if (item.category === 'chemical') {
                if (qty <= 0.5) isRisky = true;
            } else if (item.category === 'film') {
                 const len = (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
                 if (len <= 50) isRisky = true;
            }
        }

        if (isRisky) {
            riskyProducts.add(pCode);
        }
    }

    const totalMaterials = uniqueMaterials.size;
    const lowStockCount = riskyProducts.size;

    return {
        totalMaterials,
        todayIn: inboundCount.total,
        todayOut: outboundCount.total,
        lowStock: lowStockCount,
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
