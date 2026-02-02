// cloudfunctions/_shared/alert-config.js
/**
 * 预警阈值配置中心
 * Alert Threshold Configuration
 *
 * 修改此文件后，请确保同步更新到各云函数目录：
 * - getInventoryGrouped/alert-config.js
 * - getDashboardStats/alert-config.js
 */
const ALERT_CONFIG = {
    // 临期预警阈值 (天)
    EXPIRY_DAYS: 30,

    // 低库存预警阈值
    LOW_STOCK: {
        chemical: 0.5, // 化学品 (kg)
        film: 50       // 膜 (m)
    }
};

module.exports = ALERT_CONFIG;
