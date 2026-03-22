const BUILTIN_SUBCATEGORY_SEEDS = [
  { subcategory_key: 'builtin:chemical:adhesive', name: '主胶', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 10 },
  { subcategory_key: 'builtin:chemical:resin', name: '树脂', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 20 },
  { subcategory_key: 'builtin:chemical:solvent', name: '溶剂', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 30 },
  { subcategory_key: 'builtin:chemical:additive', name: '助剂', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 40 },
  { subcategory_key: 'builtin:chemical:pigment', name: '色浆', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 50 },
  { subcategory_key: 'builtin:chemical:hardener', name: '固化剂', parent_category: 'chemical', is_builtin: true, status: 'active', sort_order: 60 },
  { subcategory_key: 'builtin:film:pet', name: '基材-PET', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 110 },
  { subcategory_key: 'builtin:film:pp-pe', name: '基材-BOPP', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 120 },
  { subcategory_key: 'builtin:film:pe', name: '基材-PE', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 130 },
  { subcategory_key: 'builtin:film:po', name: '基材-PO', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 140 },
  { subcategory_key: 'builtin:film:pi', name: '基材-PI', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 150 },
  { subcategory_key: 'builtin:film:release-film', name: '离型膜', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 160 },
  { subcategory_key: 'builtin:film:protective-film', name: '保护膜', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 170 },
  { subcategory_key: 'builtin:film:tape', name: '胶带', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 180 },
  { subcategory_key: 'builtin:film:hard-coat', name: '硬化膜', parent_category: 'film', is_builtin: true, status: 'active', sort_order: 190 }
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

function normalizeSubcategoryRecord(record) {
  const normalized = record || {};
  return {
    subcategory_key: String(normalized.subcategory_key || normalized._id || '').trim(),
    name: String(normalized.name || '').trim(),
    parent_category: normalizeParentCategory(normalized.parent_category || normalized.category),
    is_builtin: !!normalized.is_builtin,
    status: normalized.status === 'disabled' ? 'disabled' : 'active',
    sort_order: Number(
      normalized.sort_order !== undefined ? normalized.sort_order : normalized.order
    ) || 0
  };
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
  return RESERVED_SUBCATEGORY_NAMES.includes(String(name || '').trim());
}

function isSelectableSubcategoryRecord(record) {
  const item = normalizeSubcategoryRecord(record);
  return item.status === 'active' && !isDeprecatedSubcategoryKey(item.subcategory_key);
}

function buildSubcategoryMap(records) {
  return new Map(
    sortSubcategoryRecords(records).map(item => [item.subcategory_key, item])
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

function resolveSubcategoryDisplay(source, subcategoryMap) {
  const data = source || {};
  const subcategoryKey = String(data.subcategory_key || '').trim();
  const snapshotText = String(data.sub_category || '').trim();

  if (subcategoryKey && subcategoryMap && subcategoryMap.has(subcategoryKey)) {
    return subcategoryMap.get(subcategoryKey).name;
  }

  return snapshotText;
}

module.exports = {
  BUILTIN_SUBCATEGORY_SEEDS,
  DEPRECATED_SUBCATEGORY_KEYS,
  normalizeParentCategory,
  normalizeSubcategoryRecord,
  sortSubcategoryRecords,
  isDeprecatedSubcategoryKey,
  isReservedSubcategoryName,
  isSelectableSubcategoryRecord,
  buildSubcategoryMap,
  buildSubcategoryActions,
  resolveSubcategoryDisplay
};
