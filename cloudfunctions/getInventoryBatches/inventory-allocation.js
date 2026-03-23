function normalizeStatus(value) {
  return String(value || '').trim();
}

function getAvailableAllocationStock(item = {}) {
  if (String(item.category || '').trim() === 'film') {
    return Number(item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
  }

  return Number(item.quantity && item.quantity.val) || 0;
}

function getExplicitExpiryTimestamp(item = {}) {
  const rawValue = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);
  if (!rawValue) {
    return null;
  }

  const expiryDate = rawValue instanceof Date ? rawValue : new Date(rawValue);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }

  return expiryDate.getTime();
}

function getCreateTimeTimestamp(item = {}) {
  const rawValue = item.create_time;
  if (!rawValue) {
    return Number.MAX_SAFE_INTEGER;
  }

  const createTime = rawValue instanceof Date ? rawValue : new Date(rawValue);
  if (Number.isNaN(createTime.getTime())) {
    return Number.MAX_SAFE_INTEGER;
  }

  return createTime.getTime();
}

function compareStableString(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function compareInventoryAllocationOrder(left = {}, right = {}) {
  const leftExpiry = getExplicitExpiryTimestamp(left);
  const rightExpiry = getExplicitExpiryTimestamp(right);
  const leftHasExpiry = leftExpiry !== null;
  const rightHasExpiry = rightExpiry !== null;

  if (leftHasExpiry !== rightHasExpiry) {
    return leftHasExpiry ? -1 : 1;
  }

  if (leftHasExpiry && rightHasExpiry && leftExpiry !== rightExpiry) {
    return leftExpiry - rightExpiry;
  }

  const leftCreateTime = getCreateTimeTimestamp(left);
  const rightCreateTime = getCreateTimeTimestamp(right);
  if (leftCreateTime !== rightCreateTime) {
    return leftCreateTime - rightCreateTime;
  }

  const uniqueCodeDiff = compareStableString(left.unique_code, right.unique_code);
  if (uniqueCodeDiff !== 0) {
    return uniqueCodeDiff;
  }

  return compareStableString(left._id, right._id);
}

function isEligibleInventoryAllocationItem(item = {}) {
  return normalizeStatus(item.status) === 'in_stock' && getAvailableAllocationStock(item) > 0;
}

function sortInventoryAllocationCandidates(items = []) {
  return (items || [])
    .filter(isEligibleInventoryAllocationItem)
    .slice()
    .sort(compareInventoryAllocationOrder);
}

function pickPreferredAllocationItem(items = []) {
  const sorted = sortInventoryAllocationCandidates(items);
  return sorted.length > 0 ? sorted[0] : null;
}

function buildInventoryAllocationRecommendation(items = []) {
  const preferred = pickPreferredAllocationItem(items);
  if (!preferred) {
    return {
      recommendedCode: '',
      recommendedBatchNumber: ''
    };
  }

  return {
    recommendedCode: String(preferred.unique_code || '').trim(),
    recommendedBatchNumber: String(preferred.batch_number || '').trim()
  };
}

module.exports = {
  getAvailableAllocationStock,
  compareInventoryAllocationOrder,
  sortInventoryAllocationCandidates,
  pickPreferredAllocationItem,
  buildInventoryAllocationRecommendation
};
