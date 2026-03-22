const {
  normalizeSearchKeyword,
  buildContainsRegExp,
  matchesSearchFields
} = require('./search');

const LOG_SEARCH_FIELDS = [
  'material_name',
  'product_code',
  'unique_code',
  'batch_number',
  'operator',
  'operator_name',
  'type',
  'description',
  'note'
];

const INBOUND_TYPES = ['inbound', 'create', 'IN', 'CREATE'];
const OUTBOUND_TYPES = ['outbound', 'OUT'];
const TRANSFER_TYPES = ['transfer', 'edit', 'update', 'TRANSFER', 'EDIT', 'UPDATE'];
const DELETE_TYPES = ['delete', 'DELETE'];

function normalizeLogTypeValue(type) {
  return normalizeSearchKeyword(type).toLowerCase();
}

function normalizeOperatorValue(value) {
  return normalizeSearchKeyword(value);
}

function resolveDateStart(getCstRange, dateFilter, now = new Date()) {
  if (!dateFilter || dateFilter === 'all' || typeof getCstRange !== 'function') {
    return null;
  }

  const range = getCstRange(dateFilter, now);
  return range && range.start ? range.start : null;
}

function buildQueryCodeCondition(_, queryCode, getCstRange, now = new Date()) {
  const normalizedQueryCode = normalizeSearchKeyword(queryCode);
  if (!normalizedQueryCode) {
    return null;
  }

  if (normalizedQueryCode === 'today_in') {
    const todayStart = resolveDateStart(getCstRange, 'today', now);
    return _.and([
      { type: _.in(INBOUND_TYPES) },
      { timestamp: _.gte(todayStart) }
    ]);
  }

  if (normalizedQueryCode === 'today_out') {
    const todayStart = resolveDateStart(getCstRange, 'today', now);
    return _.and([
      { type: _.in(OUTBOUND_TYPES) },
      { timestamp: _.gte(todayStart) }
    ]);
  }

  return _.or([
    { unique_code: normalizedQueryCode },
    { inventory_id: normalizedQueryCode }
  ]);
}

function buildTypeCondition(_, typeFilter) {
  const normalizedType = normalizeLogTypeValue(typeFilter);
  if (!normalizedType || normalizedType === 'all') {
    return null;
  }

  if (normalizedType === 'inbound') {
    return { type: _.in(INBOUND_TYPES) };
  }

  if (normalizedType === 'outbound') {
    return { type: _.in(OUTBOUND_TYPES) };
  }

  if (normalizedType === 'transfer') {
    return { type: _.in(TRANSFER_TYPES) };
  }

  if (normalizedType === 'delete') {
    return { type: _.in(DELETE_TYPES) };
  }

  return { type: _.in([normalizedType, normalizedType.toUpperCase()]) };
}

function buildLogSearchWhere({
  db,
  _,
  queryCode,
  searchVal,
  dateFilter,
  typeFilter,
  operatorFilter,
  getCstRange,
  now = new Date()
}) {
  const conditions = [];

  const queryCodeCondition = buildQueryCodeCondition(_, queryCode, getCstRange, now);
  if (queryCodeCondition) {
    conditions.push(queryCodeCondition);
  }

  const searchRegex = buildContainsRegExp(db, searchVal);
  if (searchRegex) {
    conditions.push(_.or(LOG_SEARCH_FIELDS.map(field => ({ [field]: searchRegex }))));
  }

  const dateStart = resolveDateStart(getCstRange, dateFilter, now);
  if (dateStart) {
    conditions.push({ timestamp: _.gte(dateStart) });
  }

  const typeCondition = buildTypeCondition(_, typeFilter);
  if (typeCondition) {
    conditions.push(typeCondition);
  }

  const normalizedOperator = normalizeOperatorValue(operatorFilter);
  if (normalizedOperator && normalizedOperator !== 'all') {
    conditions.push(_.or([
      { operator: normalizedOperator },
      { operator_name: normalizedOperator }
    ]));
  }

  if (conditions.length === 0) {
    return {};
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions);
}

function resolveLogTimestamp(record) {
  const time = record && (record.timestamp || record.create_time);
  const normalizedTime = new Date(time || 0).getTime();
  return Number.isFinite(normalizedTime) ? normalizedTime : 0;
}

function matchesQueryCode(record, queryCode, getCstRange, now = new Date()) {
  const normalizedQueryCode = normalizeSearchKeyword(queryCode);
  if (!normalizedQueryCode) {
    return true;
  }

  if (normalizedQueryCode === 'today_in') {
    const todayStart = resolveDateStart(getCstRange, 'today', now);
    return matchesType(record, 'inbound') && resolveLogTimestamp(record) >= new Date(todayStart).getTime();
  }

  if (normalizedQueryCode === 'today_out') {
    const todayStart = resolveDateStart(getCstRange, 'today', now);
    return matchesType(record, 'outbound') && resolveLogTimestamp(record) >= new Date(todayStart).getTime();
  }

  return String((record && record.unique_code) || '').trim() === normalizedQueryCode
    || String((record && record.inventory_id) || '').trim() === normalizedQueryCode;
}

function matchesType(record, typeFilter) {
  const normalizedType = normalizeLogTypeValue(typeFilter);
  if (!normalizedType || normalizedType === 'all') {
    return true;
  }

  const recordType = normalizeLogTypeValue(record && record.type);
  if (normalizedType === 'inbound') {
    return INBOUND_TYPES.map(normalizeLogTypeValue).includes(recordType);
  }
  if (normalizedType === 'outbound') {
    return OUTBOUND_TYPES.map(normalizeLogTypeValue).includes(recordType);
  }
  if (normalizedType === 'transfer') {
    return TRANSFER_TYPES.map(normalizeLogTypeValue).includes(recordType);
  }
  if (normalizedType === 'delete') {
    return DELETE_TYPES.map(normalizeLogTypeValue).includes(recordType);
  }

  return recordType === normalizedType;
}

function matchesDateFilter(record, dateFilter, getCstRange, now = new Date()) {
  const dateStart = resolveDateStart(getCstRange, dateFilter, now);
  if (!dateStart) {
    return true;
  }

  return resolveLogTimestamp(record) >= new Date(dateStart).getTime();
}

function matchesOperator(record, operatorFilter) {
  const normalizedOperator = normalizeOperatorValue(operatorFilter);
  if (!normalizedOperator || normalizedOperator === 'all') {
    return true;
  }

  return String((record && record.operator) || '').trim() === normalizedOperator
    || String((record && record.operator_name) || '').trim() === normalizedOperator;
}

function filterLogRecords(records = [], params = {}) {
  return records.filter((record) => (
    matchesQueryCode(record, params.queryCode, params.getCstRange, params.now)
    && matchesSearchFields(record, LOG_SEARCH_FIELDS, params.searchVal)
    && matchesDateFilter(record, params.dateFilter, params.getCstRange, params.now)
    && matchesType(record, params.typeFilter)
    && matchesOperator(record, params.operatorFilter)
  ));
}

function sortLogRecordsDescending(records = []) {
  return [...records].sort((left, right) => resolveLogTimestamp(right) - resolveLogTimestamp(left));
}

module.exports = {
  LOG_SEARCH_FIELDS,
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  TRANSFER_TYPES,
  DELETE_TYPES,
  buildLogSearchWhere,
  filterLogRecords,
  sortLogRecordsDescending,
  resolveLogTimestamp
};
