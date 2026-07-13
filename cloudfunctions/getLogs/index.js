// cloudfunctions/getLogs/index.js
const cloud = require('wx-server-sdk');
const { getCstRange } = require('./cst-time');
const { buildLogSearchWhere } = require('./log-search');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');

const LOG_SEARCH_FIELD_NAMES = [
  'material_name',
  'product_code',
  'unique_code',
  'batch_number',
  'operator',
  'operator_name',
  'type',
  'project_code',
  'project_name',
  'withdraw_note',
  'description',
  'note'
];
const AUDIT_SEARCH_FIELD_NAMES = [
  'domain',
  'action',
  'actor_id',
  'actor_name',
  'target_type',
  'target_id',
  'target_label',
  'operation_id',
  'search_text'
];
const AUDIT_SCOPE = 'audit';
const INVENTORY_SCOPE = 'inventory';

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function normalizeScope(value, adminOnly = false) {
  const scope = String(value || '').trim();
  if (scope === AUDIT_SCOPE || scope === INVENTORY_SCOPE) {
    return scope;
  }
  return adminOnly ? AUDIT_SCOPE : INVENTORY_SCOPE;
}

function normalizePagination(page, limit) {
  return {
    page: Math.max(1, Number(page) || 1),
    limit: Math.max(1, Math.min(100, Number(limit) || 50))
  };
}

function buildAuditSearchWhere({
  db,
  _,
  queryCode,
  searchVal,
  dateFilter,
  domainFilter,
  typeFilter,
  operatorFilter,
  getCstRange,
  now = new Date()
}) {
  const conditions = [];
  const normalizedQueryCode = String(queryCode || '').trim();
  if (normalizedQueryCode) {
    conditions.push(_.or([
      { target_id: normalizedQueryCode },
      { target_label: normalizedQueryCode },
      { operation_id: normalizedQueryCode }
    ]));
  }

  const searchRegex = db.RegExp && db.RegExp({
    regexp: String(searchVal || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    options: 'i'
  });
  if (searchRegex && String(searchVal || '').trim()) {
    conditions.push(_.or(AUDIT_SEARCH_FIELD_NAMES.map(field => ({ [field]: searchRegex }))));
  }

  if (dateFilter && dateFilter !== 'all' && typeof getCstRange === 'function') {
    const range = getCstRange(dateFilter, now);
    if (range && range.start) {
      conditions.push({ timestamp: _.gte(range.start) });
    }
  }

  const normalizedDomain = String(domainFilter || '').trim();
  if (normalizedDomain && normalizedDomain !== 'all') {
    conditions.push({ domain: normalizedDomain });
  }

  const normalizedType = String(typeFilter || '').trim();
  if (normalizedType && normalizedType !== 'all') {
    conditions.push({ action: normalizedType });
  }

  const normalizedOperator = String(operatorFilter || '').trim();
  if (normalizedOperator && normalizedOperator !== 'all') {
    conditions.push(_.or([
      { actor_id: normalizedOperator },
      { actor_name: normalizedOperator }
    ]));
  }

  if (!conditions.length) {
    return {};
  }
  return conditions.length === 1 ? conditions[0] : _.and(conditions);
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
    queryCode,
    searchVal,
    dateFilter,
    domainFilter,
    typeFilter,
    operatorFilter,
    adminOnly = false,
    logScope,
    page = 1,
    limit = 50
  } = event;
  const scope = normalizeScope(logScope, adminOnly);
  const pagination = normalizePagination(page, limit);
  const skip = (pagination.page - 1) * pagination.limit;

  try {
      const userRes = await db.collection('users')
        .where({ _openid: OPENID })
        .limit(1)
        .get();
      const operator = userRes.data && userRes.data[0] ? userRes.data[0] : null;
      const authResult = scope === AUDIT_SCOPE
        ? assertAdminMutationAccess(operator, '仅已激活管理员可查看审计日志')
        : assertActiveUserAccess(operator, '仅已激活用户可查看操作日志');
      if (!authResult.ok) {
        return {
          success: false,
          msg: authResult.msg
        };
      }

      const collectionName = scope === AUDIT_SCOPE ? 'audit_events' : 'inventory_log';
      const collection = db.collection(collectionName);
      const whereBuilder = scope === AUDIT_SCOPE ? buildAuditSearchWhere : buildLogSearchWhere;
      const where = whereBuilder({
          db,
          _,
          queryCode,
          searchVal,
          dateFilter,
          domainFilter,
          typeFilter,
          operatorFilter,
          getCstRange
      });

      // Query
      const totalRes = await collection.where(where).count();
      const dataRes = await collection.where(where)
          .orderBy('timestamp', 'desc')
          .orderBy('create_time', 'desc') // Fallback sort
          .skip(skip)
          .limit(pagination.limit)
          .get();

      return {
          success: true,
          list: dataRes.data,
          total: totalRes.total,
          page: pagination.page,
          limit: pagination.limit,
          logScope: scope
      };

  } catch (err) {
      console.error(err);
      return {
          success: false,
          msg: err.message
      };
  }
};
