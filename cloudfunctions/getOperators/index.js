// 云函数入口文件 - 获取操作人列表
const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function normalizeScope(value) {
  return String(value || '').trim() === 'audit' ? 'audit' : 'inventory';
}

function applyStableOrder(query, sorts = []) {
  return sorts.reduce((current, [field, direction]) => (
    current && typeof current.orderBy === 'function'
      ? current.orderBy(field, direction)
      : current
  ), query);
}

async function loadAllOperatorLogRows(scope = 'inventory', pageSize = 100) {
  let skip = 0;
  let rows = [];
  let batch = [];
  const collectionName = scope === 'audit' ? 'audit_events' : 'inventory_log';

  do {
    const query = db.collection(collectionName);
    const res = await applyStableOrder(query, [
      ['timestamp', 'desc'],
      ['_id', 'desc']
    ])
      .skip(skip)
      .limit(pageSize)
      .get();

    batch = res.data || [];
    rows = rows.concat(batch);
    skip += pageSize;
  } while (batch.length === pageSize);

  return rows;
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function resolveUserDisplayName(user = {}) {
  return normalizeText(
    user.name
    || user.real_name
    || user.display_name
    || user.nickname
    || user.nickName
    || user.nick_name
    || user.operator_name
    || user.username
  );
}

function looksLikeInternalId(value) {
  const text = normalizeText(value);
  return /^o[A-Za-z0-9_-]{20,}$/.test(text) || /^[A-Za-z0-9_-]{28,}$/.test(text);
}

function isBlankOrSystemOperatorName(value) {
  const text = normalizeText(value);
  return !text || /^system$/i.test(text) || looksLikeInternalId(text);
}

async function loadUserNameMap(openids = []) {
  const ids = Array.from(new Set(openids.map(normalizeText).filter(Boolean)));
  if (!ids.length || !_ || typeof _.in !== 'function') {
    return new Map();
  }

  const entries = [];
  const chunkSize = 100;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const res = await db.collection('users')
      .where({ _openid: _.in(chunk) })
      .limit(chunk.length)
      .get();
    entries.push(...(res.data || [])
      .map(user => [normalizeText(user._openid), resolveUserDisplayName(user)])
      .filter(([, name]) => !!name));
  }
  return new Map(entries);
}

async function resolveOperatorNames(rows = [], scope = 'inventory') {
  const explicitNames = rows
    .map(item => scope === 'audit' ? item.actor_name : (item.operator || item.operator_name))
    .map(normalizeText)
    .filter(name => name && !/^system$/i.test(name) && !looksLikeInternalId(name));
  const openids = rows
    .map(item => scope === 'audit'
      ? (isBlankOrSystemOperatorName(item.actor_name) ? (item.actor_id || item.actor_name) : '')
      : (isBlankOrSystemOperatorName(item.operator || item.operator_name)
        ? (item.operator_id || item._openid || item.operator || item.operator_name)
        : ''))
    .filter(Boolean);
  const nameMap = await loadUserNameMap(openids);
  return Array.from(new Set(explicitNames.concat(Array.from(nameMap.values()))))
    .sort();
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
    const operators = await resolveOperatorNames(rows, scope);

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
