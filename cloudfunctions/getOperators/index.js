// 云函数入口文件 - 获取操作人列表
const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizeScope(value) {
  return String(value || '').trim() === 'audit' ? 'audit' : 'inventory';
}

async function loadAllOperatorLogRows(scope = 'inventory', pageSize = 100) {
  let skip = 0;
  let rows = [];
  let batch = [];
  const collectionName = scope === 'audit' ? 'audit_events' : 'inventory_log';
  const fieldName = scope === 'audit' ? 'actor_name' : 'operator';

  do {
    const res = await db.collection(collectionName)
      .field({ [fieldName]: true })
      .skip(skip)
      .limit(pageSize)
      .get();

    batch = res.data || [];
    rows = rows.concat(batch);
    skip += pageSize;
  } while (batch.length === pageSize);

  return rows;
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const userRes = await db.collection('users')
      .where({ _openid: OPENID })
      .limit(1)
      .get();
    const operator = userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看操作人列表');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    const scope = normalizeScope(event && event.logScope);
    const rows = await loadAllOperatorLogRows(scope);
    const operators = Array.from(new Set(rows
      .map(item => scope === 'audit' ? item.actor_name : item.operator)
      .filter(op => op && op.trim()) // 过滤空值
    ))
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
