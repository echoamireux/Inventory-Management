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

    // 全局低库存预警阈值。化材先换算到 g / mL，膜材按基础长度 m 判断。
    LOW_STOCK: {
        chemical: {
            mass_g: 50,
            volume_ml: 50
        },
        film: {
            length_m: 50
        }
    }
};

module.exports = ALERT_CONFIG;
