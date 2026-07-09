const BUILTIN_PRODUCT_CODE_PREFIX_SEEDS = [
  {
    prefix: 'J-',
    category: 'chemical',
    name: 'J类化材',
    is_builtin: true,
    status: 'active',
    sort_order: 10
  },
  {
    prefix: 'S-',
    category: 'chemical',
    name: 'S类化材',
    is_builtin: true,
    status: 'active',
    sort_order: 20
  },
  {
    prefix: 'Y-',
    category: 'chemical',
    name: 'Y类化材',
    is_builtin: true,
    status: 'active',
    sort_order: 30
  },
  {
    prefix: 'M-',
    category: 'film',
    name: '膜材',
    is_builtin: true,
    status: 'active',
    sort_order: 110
  }
];

function normalizeProductCodePrefix(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  if (!raw) {
    return '';
  }
  if (/^[A-Z]$/u.test(raw)) {
    return `${raw}-`;
  }
  if (/^[A-Z]-$/u.test(raw)) {
    return raw;
  }
  return raw;
}

function normalizePrefixCategory(category) {
  return category === 'film' ? 'film' : 'chemical';
}

function normalizeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function normalizePrefixName(name, prefix = '') {
  const normalized = String(name || '').trim();
  return normalized || prefix;
}

function normalizeProductCodePrefixRecord(record = {}) {
  const prefix = normalizeProductCodePrefix(record.prefix || record.code_prefix || record.value);
  const category = normalizePrefixCategory(record.category || record.scope);

  return {
    _id: record._id,
    prefix,
    category,
    name: normalizePrefixName(record.name, prefix),
    is_builtin: !!record.is_builtin,
    status: normalizeStatus(record.status),
    sort_order: Number(record.sort_order !== undefined ? record.sort_order : record.order) || 0
  };
}

function sortProductCodePrefixRecords(records = []) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeProductCodePrefixRecord)
    .filter(item => item.prefix)
    .sort((left, right) => {
      const orderDiff = (Number(left.sort_order) || 0) - (Number(right.sort_order) || 0);
      if (orderDiff !== 0) return orderDiff;
      const prefixDiff = left.prefix.localeCompare(right.prefix);
      if (prefixDiff !== 0) return prefixDiff;
      return String(left._id || '').localeCompare(String(right._id || ''));
    });
}

function filterProductCodePrefixRecordsByCategory(records = [], category = 'chemical', options = {}) {
  const normalizedCategory = normalizePrefixCategory(category);
  const includeDisabled = !!options.includeDisabled;

  return sortProductCodePrefixRecords(records)
    .filter(item => item.category === normalizedCategory)
    .filter(item => includeDisabled || item.status === 'active');
}

function buildProductCodePrefixActions(records = [], category = 'chemical') {
  return filterProductCodePrefixRecordsByCategory(records, category, { includeDisabled: false })
    .map(item => ({
      name: item.name ? `${item.prefix} ${item.name}` : item.prefix,
      value: item.prefix,
      prefix: item.prefix,
      category: item.category
    }));
}

async function ensureCollection(db) {
  if (!db || typeof db.createCollection !== 'function') {
    return;
  }

  try {
    await db.createCollection('product_code_prefixes');
  } catch (error) {
    const message = String((error && error.errMsg) || error.message || '');
    if (
      message.includes('exists') ||
      message.includes('已存在') ||
      message.includes('DATABASE_COLLECTION_ALREADY_EXISTS')
    ) {
      return;
    }
    throw error;
  }
}

async function loadAllProductCodePrefixRecords(db, pageSize = 100) {
  const collection = db.collection('product_code_prefixes');
  let skip = 0;
  let records = [];

  while (true) {
    let response;
    try {
      response = await collection.skip(skip).limit(pageSize).get();
    } catch (error) {
      if (skip === 0) {
        return [];
      }
      throw error;
    }

    const batch = (response && response.data) || [];
    records = records.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return records;
}

async function ensureBuiltinProductCodePrefixes(db) {
  await ensureCollection(db);
  const collection = db.collection('product_code_prefixes');
  const existingRecords = await loadAllProductCodePrefixRecords(db);
  const normalizedRecords = existingRecords.map(normalizeProductCodePrefixRecord);
  const byPrefix = new Map(normalizedRecords.map(item => [item.prefix, item]));

  for (const seed of BUILTIN_PRODUCT_CODE_PREFIX_SEEDS) {
    const existing = byPrefix.get(seed.prefix);
    if (existing && existing._id) {
      const needsRefresh =
        existing.category !== seed.category ||
        existing.is_builtin !== true ||
        !existing.name ||
        existing.sort_order <= 0;

      if (needsRefresh) {
        const data = {
          category: seed.category,
          is_builtin: true,
          updated_at: db.serverDate()
        };
        if (!existing.name) {
          data.name = seed.name;
        }
        if (existing.sort_order <= 0) {
          data.sort_order = seed.sort_order;
        }
        await collection.doc(existing._id).update({ data });
      }
      continue;
    }

    await collection.add({
      data: {
        ...seed,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  }

  return sortProductCodePrefixRecords(await loadAllProductCodePrefixRecords(db));
}

module.exports = {
  BUILTIN_PRODUCT_CODE_PREFIX_SEEDS,
  normalizeProductCodePrefix,
  normalizePrefixCategory,
  normalizeStatus,
  normalizeProductCodePrefixRecord,
  sortProductCodePrefixRecords,
  filterProductCodePrefixRecordsByCategory,
  buildProductCodePrefixActions,
  loadAllProductCodePrefixRecords,
  ensureBuiltinProductCodePrefixes
};
