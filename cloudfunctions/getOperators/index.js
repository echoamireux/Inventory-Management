// 云函数入口文件 - 获取操作人列表
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 从 inventory_log 表中聚合出所有不重复的操作人
    const res = await db.collection('inventory_log').aggregate()
      .group({
        _id: '$operator'
      })
      .end();

    const operators = res.list
      .map(item => item._id)
      .filter(op => op && op.trim()) // 过滤空值
      .sort(); // 排序

    return {
      success: true,
      list: operators
    };
  } catch (err) {
    console.error('getOperators error:', err);
    return {
      success: false,
      msg: err.message
    };
  }
};
