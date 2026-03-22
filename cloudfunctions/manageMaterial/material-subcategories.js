const BUILTIN_SUBCATEGORY_SEEDS = [
  {
    subcategory_key: 'builtin:chemical:adhesive',
    name: '主胶',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 10
  },
  {
    subcategory_key: 'builtin:chemical:resin',
    name: '树脂',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 20
  },
  {
    subcategory_key: 'builtin:chemical:solvent',
    name: '溶剂',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 30
  },
  {
    subcategory_key: 'builtin:chemical:additive',
    name: '助剂',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 40
  },
  {
    subcategory_key: 'builtin:chemical:pigment',
    name: '色浆',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 50
  },
  {
    subcategory_key: 'builtin:chemical:hardener',
    name: '固化剂',
    parent_category: 'chemical',
    is_builtin: true,
    status: 'active',
    sort_order: 60
  },
  {
    subcategory_key: 'builtin:film:pet',
    name: '基材-PET',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 110
  },
  {
    subcategory_key: 'builtin:film:pp-pe',
    name: '基材-BOPP',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 120
  },
  {
    subcategory_key: 'builtin:film:pe',
    name: '基材-PE',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 130
  },
  {
    subcategory_key: 'builtin:film:po',
    name: '基材-PO',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 140
  },
  {
    subcategory_key: 'builtin:film:pi',
    name: '基材-PI',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 150
  },
  {
    subcategory_key: 'builtin:film:release-film',
    name: '离型膜',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 160
  },
  {
    subcategory_key: 'builtin:film:protective-film',
    name: '保护膜',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 170
  },
  {
    subcategory_key: 'builtin:film:tape',
    name: '胶带',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 180
  },
  {
    subcategory_key: 'builtin:film:hard-coat',
    name: '硬化膜',
    parent_category: 'film',
    is_builtin: true,
    status: 'active',
    sort_order: 190
  }
];

const DEPRECATED_SUBCATEGORY_KEYS = [
  'builtin:chemical:other',
  'builtin:film:other',
  'builtin:film:optical-film'
];

const RESERVED_SUBCATEGORY_NAMES = [
  '其他',
  '其他 (Other)'
];

function normalizeParentCategory(category) {
  return category === 'film' ? 'film' : 'chemical';
}

function normalizeSubcategoryName(name) {
  return String(name || '').trim();
}

function normalizeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function normalizeSubcategoryRecord(record) {
  const normalized = record || {};
  const subcategoryKey = String(normalized.subcategory_key || normalized._id || '').trim();

  return {
    _id: normalized._id,
    subcategory_key: subcategoryKey,
    name: normalizeSubcategoryName(normalized.name),
    parent_category: normalizeParentCategory(normalized.parent_category || normalized.category),
    is_builtin: !!normalized.is_builtin,
    status: normalizeStatus(normalized.status),
    sort_order: Number(
      normalized.sort_order !== undefined ? normalized.sort_order : normalized.order
    ) || 0
  };
}

async function ensureCollection(db) {
  if (!db || typeof db.createCollection !== 'function') {
    return;
  }

  try {
    await db.createCollection('material_subcategories');
  } catch (error) {
    const message = String((error && error.errMsg) || error.message || '');
    if (
      message.includes('exists') ||
      message.includes('已存在') ||
      message.includes('DATABASE_COLLECTION_ALREADY_EXISTS')
    ) {
      return;
    }
  }
}

async function loadAllSubcategoryRecords(db, pageSize = 100) {
  const collection = db.collection('material_subcategories');
  let skip = 0;
  let allRecords = [];

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
    allRecords = allRecords.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return allRecords;
}

async function ensureBuiltinSubcategories(db) {
  await ensureCollection(db);
  const collection = db.collection('material_subcategories');
  const existingRecords = await loadAllSubcategoryRecords(db);
  const normalizedRecords = existingRecords.map(normalizeSubcategoryRecord);
  const byKey = new Map(normalizedRecords.map(item => [item.subcategory_key, item]));
  const byNameCategory = new Map(
    normalizedRecords.map(item => [`${item.parent_category}::${item.name}`, item])
  );

  for (let i = 0; i < BUILTIN_SUBCATEGORY_SEEDS.length; i += 1) {
    const seed = BUILTIN_SUBCATEGORY_SEEDS[i];
    const existingByKey = byKey.get(seed.subcategory_key);
    if (existingByKey) {
      const needsMetadataRefresh =
        existingByKey.name !== seed.name ||
        existingByKey.parent_category !== seed.parent_category ||
        existingByKey.is_builtin !== true ||
        existingByKey.sort_order !== seed.sort_order;

      if (needsMetadataRefresh) {
        await collection.doc(existingByKey._id).update({
          data: {
            name: seed.name,
            parent_category: seed.parent_category,
            is_builtin: true,
            sort_order: seed.sort_order,
            updated_at: db.serverDate()
          }
        });
      }
      continue;
    }

    const legacyByName = byNameCategory.get(`${seed.parent_category}::${seed.name}`);
    if (legacyByName && legacyByName._id) {
      await collection.doc(legacyByName._id).update({
        data: {
          subcategory_key: seed.subcategory_key,
          parent_category: seed.parent_category,
          is_builtin: true,
          updated_at: db.serverDate()
        }
      });
      continue;
    }

    await collection.add({
      data: {
        subcategory_key: seed.subcategory_key,
        name: seed.name,
        parent_category: seed.parent_category,
        is_builtin: true,
        status: 'active',
        sort_order: seed.sort_order,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  }

  return loadAllSubcategoryRecords(db);
}

function sortSubcategoryRecords(records) {
  return (records || [])
    .map(normalizeSubcategoryRecord)
    .filter(item => item.subcategory_key && item.name)
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }
      return String(left.subcategory_key).localeCompare(String(right.subcategory_key));
    });
}

function isDeprecatedSubcategoryKey(subcategoryKey) {
  return DEPRECATED_SUBCATEGORY_KEYS.includes(String(subcategoryKey || '').trim());
}

function isReservedSubcategoryName(name) {
  return RESERVED_SUBCATEGORY_NAMES.includes(normalizeSubcategoryName(name));
}

function isSelectableSubcategoryRecord(record) {
  const item = normalizeSubcategoryRecord(record);
  return item.status === 'active' && !isDeprecatedSubcategoryKey(item.subcategory_key);
}

function filterSubcategoryRecordsByCategory(records, category, options = {}) {
  const normalizedCategory = normalizeParentCategory(category);
  const includeDisabled = !!options.includeDisabled;
  const includeDeprecated = !!options.includeDeprecated;

  return (records || []).filter((record) => {
    const item = normalizeSubcategoryRecord(record);
    if (item.parent_category !== normalizedCategory) {
      return false;
    }
    if (!includeDeprecated && isDeprecatedSubcategoryKey(item.subcategory_key)) {
      return false;
    }
    if (!includeDisabled && item.status !== 'active') {
      return false;
    }
    return true;
  });
}

function buildSubcategoryMap(records) {
  return new Map(
    (records || [])
      .map(normalizeSubcategoryRecord)
      .filter(item => item.subcategory_key)
      .map(item => [item.subcategory_key, item])
  );
}

function buildSubcategoryActions(records) {
  return sortSubcategoryRecords(records)
    .filter(item => isSelectableSubcategoryRecord(item))
    .map(item => ({
      name: item.name,
      subcategory_key: item.subcategory_key
    }));
}

function findSubcategoryRecordByName(records, name, category, excludeSubcategoryKey = '') {
  const normalizedName = normalizeSubcategoryName(name);
  const normalizedCategory = category ? normalizeParentCategory(category) : '';
  const excludedKey = String(excludeSubcategoryKey || '').trim();

  return (records || [])
    .map(normalizeSubcategoryRecord)
    .find((item) => {
      if (item.subcategory_key === excludedKey) {
        return false;
      }
      if (normalizedCategory && item.parent_category !== normalizedCategory) {
        return false;
      }
      return item.name === normalizedName;
    });
}

function resolveSubcategoryDisplay(source, subcategoryMap) {
  const data = source || {};
  const subcategoryKey = String(data.subcategory_key || '').trim();
  const snapshotText = normalizeSubcategoryName(data.sub_category);

  if (subcategoryKey && subcategoryMap && subcategoryMap.has(subcategoryKey)) {
    return subcategoryMap.get(subcategoryKey).name;
  }

  return snapshotText;
}

function resolveSubcategorySelection(selection, records, subcategoryMap) {
  const source = selection || {};
  const category = normalizeParentCategory(source.category || source.parent_category);
  const subcategoryKey = String(source.subcategory_key || '').trim();
  const subcategoryName = normalizeSubcategoryName(source.sub_category);
  const list = sortSubcategoryRecords(records);
  const filtered = filterSubcategoryRecordsByCategory(list, category, {
    includeDisabled: true,
    includeDeprecated: false
  });
  const map = buildSubcategoryMap(filtered);

  if (subcategoryKey && map.has(subcategoryKey)) {
    const matched = map.get(subcategoryKey);
    return {
      subcategory_key: matched.subcategory_key,
      sub_category: matched.name
    };
  }

  if (subcategoryName) {
    const matched = filtered.find(item => item.name === subcategoryName);
    if (matched) {
      return {
        subcategory_key: matched.subcategory_key,
        sub_category: matched.name
      };
    }
  }

  return {
    subcategory_key: '',
    sub_category: subcategoryName
  };
}

module.exports = {
  BUILTIN_SUBCATEGORY_SEEDS,
  DEPRECATED_SUBCATEGORY_KEYS,
  normalizeParentCategory,
  normalizeSubcategoryName,
  normalizeSubcategoryRecord,
  sortSubcategoryRecords,
  isDeprecatedSubcategoryKey,
  isReservedSubcategoryName,
  isSelectableSubcategoryRecord,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  buildSubcategoryActions,
  findSubcategoryRecordByName,
  resolveSubcategoryDisplay,
  resolveSubcategorySelection,
  ensureBuiltinSubcategories,
  loadAllSubcategoryRecords
};
