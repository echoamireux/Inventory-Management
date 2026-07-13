function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).reduce((result, key) => {
      const normalized = compactObject(value[key]);
      if (normalized !== undefined && normalized !== '') {
        result[key] = normalized;
      }
      return result;
    }, {});
  }
  if (typeof value === 'function' || value === undefined) {
    return undefined;
  }
  return value;
}

function collectSearchParts(value, parts = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectSearchParts(item, parts));
    return parts;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value).forEach(item => collectSearchParts(item, parts));
    return parts;
  }
  const text = normalizeText(value);
  if (text) {
    parts.push(text);
  }
  return parts;
}

function resolveActorId(operator = {}, actorId = '') {
  return normalizeText(
    actorId
    || operator._openid
    || operator.openid
    || operator.operator_id
    || operator.actor_id
  );
}

function resolveActorName(operator = {}, actorName = '') {
  return normalizeText(
    actorName
    || operator.name
    || operator.nickname
    || operator.operator_name
    || operator.username
  );
}

function buildAuditEventData(db, payload = {}) {
  const domain = normalizeText(payload.domain) || 'system';
  const action = normalizeText(payload.action) || 'operate';
  const target = payload.target || {};
  const before = compactObject(payload.before || {});
  const after = compactObject(payload.after || {});
  const detail = compactObject(payload.detail || {});
  const timestamp = payload.timestamp || (db && typeof db.serverDate === 'function' ? db.serverDate() : new Date());
  const actorId = resolveActorId(payload.operator || {}, payload.actorId || payload.actor_id);
  const actorName = resolveActorName(payload.operator || {}, payload.actorName || payload.actor_name);
  const targetType = normalizeText(target.type || payload.targetType || payload.target_type);
  const targetId = normalizeText(target.id || payload.targetId || payload.target_id);
  const targetLabel = normalizeText(target.label || payload.targetLabel || payload.target_label);
  const operationId = normalizeText(payload.operationId || payload.operation_id);
  const searchParts = [
    domain,
    action,
    actorId,
    actorName,
    targetType,
    targetId,
    targetLabel,
    operationId,
    ...collectSearchParts(before),
    ...collectSearchParts(after),
    ...collectSearchParts(detail)
  ].filter(Boolean);

  return {
    domain,
    action,
    actor_id: actorId,
    actor_name: actorName,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    operation_id: operationId,
    before,
    after,
    detail,
    search_text: Array.from(new Set(searchParts)).join(' '),
    timestamp,
    created_at: timestamp
  };
}

async function writeAuditEvent(collectionOwner, db, payload = {}) {
  if (!collectionOwner || typeof collectionOwner.collection !== 'function') {
    throw new Error('缺少审计日志写入上下文');
  }
  const data = buildAuditEventData(db, payload);
  await collectionOwner.collection('audit_events').add({ data });
  return data;
}

async function writeInventoryAuditEvent(collectionOwner, db, logData = {}, options = {}) {
  return writeAuditEvent(collectionOwner, db, {
    domain: 'inventory',
    action: normalizeText(logData.type || logData.action) || 'change',
    operator: options.operator || {
      _openid: logData.operator_id || logData._openid || '',
      name: logData.operator || logData.operator_name || ''
    },
    operationId: options.operationId || logData.operation_id || '',
    target: {
      type: 'inventory',
      id: logData.inventory_id || '',
      label: logData.unique_code || logData.product_code || ''
    },
    before: options.before || {},
    after: options.after || {},
    detail: Object.assign({
      material_id: logData.material_id || '',
      material_name: logData.material_name || '',
      category: logData.category || '',
      product_code: logData.product_code || '',
      unique_code: logData.unique_code || '',
      quantity_change: logData.quantity_change,
      unit: logData.unit || logData.spec_change_unit || '',
      project_code: logData.project_code || '',
      project_name: logData.project_name || '',
      description: logData.description || '',
      note: logData.note || logData.withdraw_note || ''
    }, options.detail || {})
  });
}

module.exports = {
  buildAuditEventData,
  writeAuditEvent,
  writeInventoryAuditEvent
};
