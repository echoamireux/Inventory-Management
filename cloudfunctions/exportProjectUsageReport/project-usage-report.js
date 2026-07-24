const {
  normalizeSearchKeyword,
  normalizeSearchText
} = require('./search');

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeQuantity(value) {
  const raw = value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'val')
    ? value.val
    : value;
  const normalized = Number(raw);
  return Number.isFinite(normalized) ? Math.abs(normalized) : 0;
}

function toTimestamp(value, endOfDay = false) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  const text = normalizeText(value);
  const parsed = new Date(value);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatProjectUsageLog(log = {}) {
  const quantity = normalizeQuantity(log.quantity_change);
  const timestamp = log.timestamp || log.create_time || log.created_at || null;

  return {
    _id: log._id || '',
    project_code: normalizeText(log.project_code),
    project_name: normalizeText(log.project_name),
    withdraw_note: normalizeText(log.withdraw_note || log.note || log.description),
    timestamp,
    operator_name: normalizeText(log.operator || log.operator_name || log.operator_id || log._openid),
    operator_id: normalizeText(log.operator_id || log._openid),
    product_code: normalizeText(log.product_code),
    material_name: normalizeText(log.material_name || log.name),
    unique_code: normalizeText(log.unique_code),
    batch_number: normalizeText(log.batch_number),
    quantity,
    unit: normalizeText(log.unit || log.spec_change_unit),
    type: normalizeText(log.type || 'outbound')
  };
}

function summarizeProjectUsageLogs(logs = []) {
  const grouped = new Map();

  (logs || [])
    .filter(log => normalizeText(log.type || 'outbound') === 'outbound')
    .forEach((log) => {
      const formatted = formatProjectUsageLog(log);
      const key = [
        formatted.product_code,
        formatted.material_name,
        formatted.unit
      ].join('\u0001');

      if (!grouped.has(key)) {
        grouped.set(key, {
          product_code: formatted.product_code,
          material_name: formatted.material_name,
          unit: formatted.unit,
          total_quantity: 0,
          record_count: 0,
          projectSet: new Set()
        });
      }

      const current = grouped.get(key);
      current.total_quantity = Number((current.total_quantity + formatted.quantity).toFixed(6));
      current.record_count += 1;
      if (formatted.project_code) {
        current.projectSet.add(formatted.project_code);
      }
    });

  return Array.from(grouped.values()).map((item) => {
    const projects = Array.from(item.projectSet);
    return {
      product_code: item.product_code,
      material_name: item.material_name,
      unit: item.unit,
      total_quantity: item.total_quantity,
      record_count: item.record_count,
      project_count: projects.length,
      projects: projects.join('、')
    };
  });
}

function filterProjectUsageLogs(logs = [], filters = {}) {
  const keyword = normalizeSearchKeyword(filters.keyword || filters.searchVal);
  const projectCode = normalizeText(filters.project_code || filters.projectCode);
  const operator = normalizeText(filters.operator || filters.operatorFilter);
  const startTime = filters.startTime || toTimestamp(filters.startDate);
  const endTime = filters.endTime || toTimestamp(filters.endDate, true);

  return (logs || [])
    .filter(log => normalizeText(log.type || 'outbound') === 'outbound')
    .filter((log) => {
      const formatted = formatProjectUsageLog(log);
      const logTime = toTimestamp(formatted.timestamp);
      if (projectCode && formatted.project_code !== projectCode) {
        return false;
      }
      if (operator && operator !== 'all' && formatted.operator_name !== operator && formatted.operator_id !== operator) {
        return false;
      }
      if (startTime && logTime && logTime < startTime) {
        return false;
      }
      if (endTime && logTime && logTime > endTime) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const searchable = [
        formatted.project_code,
        formatted.project_name,
        formatted.product_code,
        formatted.material_name,
        formatted.unique_code,
        formatted.batch_number,
        formatted.operator_name,
        formatted.withdraw_note
      ].map(normalizeSearchText).join(' ');
      return searchable.includes(keyword);
    })
    .sort((left, right) => {
      const timeDiff = toTimestamp(right.timestamp || right.create_time) - toTimestamp(left.timestamp || left.create_time);
      return timeDiff || String(right._id || '').localeCompare(String(left._id || ''));
    });
}

module.exports = {
  filterProjectUsageLogs,
  formatProjectUsageLog,
  normalizeQuantity,
  summarizeProjectUsageLogs
};
