// cloudfunctions/getLogs/index.js
const cloud = require('wx-server-sdk');
const { getCstRange, parseCstDateRange } = require('./cst-time');
const { buildContainsRegExp } = require('./search');
const { buildDateRangeCondition, buildLogSearchWhere } = require('./log-search');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const { handleCloudError } = require('./error-response');

const LOG_SEARCH_FIELD_NAMES = [
  'material_name',
  'product_code',
  'supplier_model',
  'supplier_model_key',
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

function parseVisibleDateRange(startDate, endDate) {
  try {
    return parseCstDateRange(startDate, endDate);
  } catch (err) {
    err.expose = true;
    throw err;
  }
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

async function loadUserNameMap(openids = []) {
  const ids = Array.from(new Set(openids.map(normalizeText).filter(Boolean)));
  if (!ids.length) {
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

function isBlankOrSystemOperatorName(value) {
  const text = normalizeText(value);
  return !text || /^system$/i.test(text) || looksLikeInternalId(text);
}

function normalizeOperatorAliases(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return Array.from(new Set(source.map(normalizeText).filter(Boolean)));
}

async function loadOperatorFilterAliases(operatorFilter) {
  const normalizedOperator = normalizeText(operatorFilter);
  if (!normalizedOperator || normalizedOperator === 'all') {
    return [];
  }

  const res = await db.collection('users')
    .where(_.or([
      { _openid: normalizedOperator },
      { name: normalizedOperator },
      { real_name: normalizedOperator },
      { display_name: normalizedOperator },
      { nickname: normalizedOperator },
      { nickName: normalizedOperator },
      { nick_name: normalizedOperator },
      { operator_name: normalizedOperator },
      { username: normalizedOperator }
    ]))
    .limit(100)
    .get();
  return normalizeOperatorAliases([
    normalizedOperator,
    ...(res.data || []).map(user => user._openid)
  ]);
}

async function enrichOperatorNames(rows = [], scope = INVENTORY_SCOPE) {
  const openids = rows
    .map(item => scope === AUDIT_SCOPE
      ? (isBlankOrSystemOperatorName(item.actor_name) ? (item.actor_id || item.actor_name) : '')
      : (isBlankOrSystemOperatorName(item.operator || item.operator_name)
        ? (item.operator_id || item._openid || item.operator || item.operator_name)
        : ''))
    .filter(Boolean);
  const nameMap = await loadUserNameMap(openids);
  if (!nameMap.size) {
    return rows;
  }

  return rows.map(item => {
    if (scope === AUDIT_SCOPE) {
      const actorName = nameMap.get(normalizeText(item.actor_id || item.actor_name));
      return actorName ? { ...item, actor_name: actorName } : item;
    }

    const operatorName = nameMap.get(normalizeText(item.operator_id || item._openid || item.operator || item.operator_name));
    return operatorName ? { ...item, operator: operatorName, operator_name: operatorName } : item;
  });
}

function buildAuditSearchWhere({
  db,
  _,
  queryCode,
  searchVal,
  dateFilter,
  startDate,
  endDate,
  domainFilter,
  typeFilter,
  operatorFilter,
  operatorFilterAliases,
  getCstRange,
  parseCstDateRange,
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

  const searchRegex = buildContainsRegExp(db, searchVal);
  if (searchRegex) {
    conditions.push(_.or(AUDIT_SEARCH_FIELD_NAMES.map(field => ({ [field]: searchRegex }))));
  }

  const dateCondition = buildDateRangeCondition(_, {
    getCstRange,
    dateFilter,
    startDate,
    endDate,
    parseCstDateRange,
    now
  });
  if (dateCondition) {
    conditions.push(dateCondition);
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
    const aliases = normalizeOperatorAliases([normalizedOperator].concat(operatorFilterAliases || []));
    conditions.push(_.or([
      { actor_name: normalizedOperator },
      { actor_id: _.in(aliases) }
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
    startDate,
    endDate,
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
      const operatorFilterAliases = await loadOperatorFilterAliases(operatorFilter);
      const where = whereBuilder({
          db,
          _,
          queryCode,
          searchVal,
          dateFilter,
          startDate,
          endDate,
          domainFilter,
          typeFilter,
          operatorFilter,
          operatorFilterAliases,
          getCstRange,
          parseCstDateRange: parseVisibleDateRange
      });

      // Query
      const totalRes = await collection.where(where).count();
      const dataRes = await collection.where(where)
          .orderBy('timestamp', 'desc')
          .orderBy('_id', 'desc')
          .skip(skip)
          .limit(pagination.limit)
          .get();
      const list = await enrichOperatorNames(dataRes.data || [], scope);

      return {
          success: true,
          list,
          total: totalRes.total,
          page: pagination.page,
          limit: pagination.limit,
          logScope: scope
      };

  } catch (err) {
      return handleCloudError(err, {
          scope: 'getLogs',
          fallbackMessage: '日志查询失败，请稍后重试'
      });
  }
};
