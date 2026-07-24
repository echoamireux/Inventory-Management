// cloudfunctions/getInventoryGrouped/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ALERT_CONFIG = require('./alert-config');
const { isChemicalLowStock, isFilmLowStock } = require('./low-stock');
const { loadMaterialMapByProductCodes } = require('./material-map');
const {
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  buildZoneMap,
  buildLocationDetailMapByZone,
  resolveInventoryLocationText
} = require('./warehouse-zones');
const {
  normalizeFilmUnit,
  summarizeFilmDisplayQuantities
} = require('./film-quantity');
const {
  buildContainsRegExp,
  matchesSearchFields,
  normalizeSearchKeyword,
  normalizeSearchText,
  scoreSearchRecord,
  compareSearchResults
} = require('./search');
const {
  buildInventoryAllocationRecommendation
} = require('./inventory-allocation');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  buildSubcategoryMap,
  resolveSubcategoryDisplay
} = require('./material-subcategories');
const { assertActiveUserAccess } = require('./auth');
const MAX_SEARCH_CANDIDATES = 500;
const BROAD_SEARCH_MESSAGE = '结果较多，请继续输入关键词';

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function applyStableOrder(query, sorts = []) {
  return sorts.reduce((current, [field, direction]) => (
    current && typeof current.orderBy === 'function'
      ? current.orderBy(field, direction)
      : current
  ), query);
}

async function loadInventoryGroupSourceItems(where, pageSize = 100, options = {}) {
  const maxRows = Math.max(0, Number(options.maxRows) || 0);
  let skip = 0;
  let rows = [];
  let batch = [];
  let searchTruncated = false;

  do {
    const currentLimit = maxRows
      ? Math.min(pageSize, Math.max(1, maxRows + 1 - rows.length))
      : pageSize;
    const query = db.collection('inventory')
      .where(where)
      .field({
        material_name: true,
        category: true,
        subcategory_key: true,
        sub_category: true,
        product_code: true,
        quantity: true,
        dynamic_attrs: true,
        expiry_date: true,
        location: true,
        location_text: true,
        location_detail: true,
        zone_key: true,
        batch_number: true,
        supplier: true,
        supplier_model: true,
        sample_note: true,
        unique_code: true,
        is_test_material: true,
        create_time: true
      });
    const res = await applyStableOrder(query, [
      ['create_time', 'asc'],
      ['_id', 'asc']
    ])
      .skip(skip)
      .limit(currentLimit)
      .get();

    batch = res.data || [];
    rows = rows.concat(batch);
    if (maxRows && rows.length > maxRows) {
      searchTruncated = true;
      break;
    }
    skip += currentLimit;
  } while (batch.length === pageSize && (!maxRows || rows.length <= maxRows));

  return {
    items: maxRows ? rows.slice(0, maxRows) : rows,
    searchTruncated
  };
}

function pickEarlierExpiry(current, next) {
  if (!next) {
    return current || null;
  }

  const nextTime = new Date(next).getTime();
  if (Number.isNaN(nextTime)) {
    return current || null;
  }

  if (!current) {
    return next;
  }

  const currentTime = new Date(current).getTime();
  if (Number.isNaN(currentTime)) {
    return next;
  }

  return nextTime < currentTime ? next : current;
}

function normalizeIdentityText(value) {
  return String(value || '').trim();
}

function buildInventoryGroupKey(item = {}) {
  const productCode = normalizeIdentityText(item.product_code) || '无产品代码';
  const supplierModel = normalizeIdentityText(item.supplier_model);
  if (item.is_test_material && supplierModel) {
    return `${productCode}::test-model::${supplierModel}`;
  }
  return productCode;
}

function buildInventoryGroups(sourceItems, zoneMap, detailMapByZone) {
  const byGroupKey = new Map();

  (sourceItems || []).forEach((item) => {
    const productCode = item.product_code || '无产品代码';
    const groupKey = buildInventoryGroupKey(item);
    if (!byGroupKey.has(groupKey)) {
      byGroupKey.set(groupKey, {
        _groupKey: groupKey,
        product_code: productCode,
        material_name: item.material_name,
        category: item.category,
        subcategory_key: item.subcategory_key || '',
        sub_category: item.sub_category,
        supplier_model: item.supplier_model || '',
        is_test_material: !!item.is_test_material,
        totalCount: 0,
        minExpiry: null,
        totalChemicalQty: 0,
        totalBaseLengthM: 0,
        firstUnit: item.quantity && item.quantity.unit ? item.quantity.unit : '',
        locationSet: new Set()
      });
    }

    const group = byGroupKey.get(groupKey);
    group.totalCount += 1;
    group.minExpiry = pickEarlierExpiry(group.minExpiry, item.expiry_date);
    group.totalChemicalQty += Number(item.quantity && item.quantity.val) || 0;
    group.totalBaseLengthM += Number(item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;

    if (!group.material_name && item.material_name) {
      group.material_name = item.material_name;
    }
    if (!group.category && item.category) {
      group.category = item.category;
    }
    if (!group.subcategory_key && item.subcategory_key) {
      group.subcategory_key = item.subcategory_key;
    }
    if (!group.sub_category && item.sub_category) {
      group.sub_category = item.sub_category;
    }
    if (!group.supplier_model && item.supplier_model) {
      group.supplier_model = item.supplier_model;
    }
    if (item.is_test_material) {
      group.is_test_material = true;
    }
    if (!group.firstUnit && item.quantity && item.quantity.unit) {
      group.firstUnit = item.quantity.unit;
    }

    const resolvedLocation = resolveInventoryLocationText(item, zoneMap, detailMapByZone);
    if (resolvedLocation) {
      group.locationSet.add(resolvedLocation);
    }
    if (item.zone_key) {
      const zone = zoneMap.get(item.zone_key);
      if (zone && zone.name) {
        group.locationSet.add(zone.name);
      }
    }
  });

  return Array.from(byGroupKey.values()).map(item => ({
    _groupKey: item._groupKey,
    product_code: item.product_code,
    material_name: item.material_name,
    category: item.category,
    subcategory_key: item.subcategory_key || '',
    sub_category: item.sub_category,
    supplier_model: item.supplier_model || '',
    is_test_material: !!item.is_test_material,
    totalCount: item.totalCount,
    minExpiry: item.minExpiry || null,
    totalChemicalQty: Number(item.totalChemicalQty) || 0,
    lowStockQuantity: Number(item.totalChemicalQty) || 0,
    totalBaseLengthM: Number(item.totalBaseLengthM) || 0,
    firstUnit: item.firstUnit || '',
    locations: Array.from(item.locationSet),
    items: []
  }));
}

function buildInventorySearchMatch(item = {}, keyword, zoneMap, detailMapByZone) {
  const searchableItem = {
    ...item,
    resolved_location_text: resolveInventoryLocationText(item, zoneMap, detailMapByZone)
  };
  const baseMatch = scoreSearchRecord(searchableItem, keyword, {
    codeFields: ['product_code'],
    modelFields: ['supplier_model'],
    nameFields: ['material_name'],
    auxiliaryFields: [
      'unique_code',
      'batch_number',
      'supplier',
      'subcategory_key',
      'sub_category',
      'location',
      'location_text',
      'resolved_location_text',
      'sample_note'
    ]
  });
  const normalizedKeyword = normalizeSearchText(keyword);
  const normalizedUniqueCode = normalizeSearchText(item.unique_code);
  if (normalizedUniqueCode && normalizedUniqueCode === normalizedKeyword) {
    return {
      match_score: Math.max(900, Number(baseMatch.match_score) || 0),
      match_reason: '标签编号完全匹配',
      match_field: 'unique_code'
    };
  }
  if (normalizedUniqueCode && normalizedUniqueCode.startsWith(normalizedKeyword)) {
    return {
      match_score: Math.max(700, Number(baseMatch.match_score) || 0),
      match_reason: '标签编号前缀匹配',
      match_field: 'unique_code'
    };
  }
  return baseMatch;
}

function buildBestInventorySearchMatches(items = [], keyword, zoneMap, detailMapByZone) {
  const matches = new Map();
  (items || []).forEach(item => {
    const groupKey = buildInventoryGroupKey(item);
    const match = buildInventorySearchMatch(item, keyword, zoneMap, detailMapByZone);
    const existing = matches.get(groupKey);
    if (!existing || compareSearchResults(match, existing, ['match_field']) < 0) {
      matches.set(groupKey, match);
    }
  });
  return matches;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { searchVal, category, filter } = event;
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(event.pageSize) || 20));
  const normalizedKeyword = normalizeSearchKeyword(searchVal);
  const normalizedFilter = String(filter || '').trim().toLowerCase();

  try {
    const operator = await loadOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看库存');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const baseConditions = [{ status: 'in_stock' }];
    if (category) {
      baseConditions.push({ category: category });
    }

    const regex = buildContainsRegExp(db, searchVal);
    const searchConditions = baseConditions.slice();
    if (regex) {
      searchConditions.push(_.or([
        { material_name: regex },
        { product_code: regex },
        { batch_number: regex },
        { supplier: regex },
        { supplier_model: regex },
        { sample_note: regex },
        { unique_code: regex },
        { location: regex },
        { location_text: regex }
      ]));
    }
    const baseWhere = baseConditions.length === 1 ? baseConditions[0] : _.and(baseConditions);
    const where = searchConditions.length === 1 ? searchConditions[0] : _.and(searchConditions);

    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const detailRecords = await ensureBuiltinLocationDetails(db, zoneRecords);
    const zoneMap = buildZoneMap(zoneRecords);
    const detailMapByZone = buildLocationDetailMapByZone(detailRecords, { includeDisabled: true });
    const subcategoryRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

    const matchedSourceResult = await loadInventoryGroupSourceItems(where, 100, {
      maxRows: regex ? MAX_SEARCH_CANDIDATES : 0
    });
    const matchedSourceItems = matchedSourceResult.items || [];
    if (regex && matchedSourceResult.searchTruncated) {
      return {
        success: true,
        list: [],
        total: 0,
        page,
        pageSize,
        isEnd: true,
        searchTruncated: true,
        searchMessage: BROAD_SEARCH_MESSAGE
      };
    }
    const matchedGroupKeys = new Set(
      matchedSourceItems.map(item => buildInventoryGroupKey(item))
    );
    const groupSourceResult = regex
      ? await loadInventoryGroupSourceItems(baseWhere)
      : matchedSourceResult;
    const groupSourceItems = groupSourceResult.items || [];
    const groups = buildInventoryGroups(groupSourceItems, zoneMap, detailMapByZone)
      .filter(item => !regex || matchedGroupKeys.has(item._groupKey));
    const searchMatches = regex
      ? buildBestInventorySearchMatches(matchedSourceItems, normalizedKeyword, zoneMap, detailMapByZone)
      : new Map();

    const productCodes = groups
      .map(item => item.product_code)
      .filter(code => code && code !== '无产品代码');
    let materialMap = new Map();

    if (productCodes.length > 0) {
      materialMap = await loadMaterialMapByProductCodes(productCodes, async ({ productCodes: batch, skip: materialSkip, limit }) => {
        const materialQuery = db.collection('materials')
          .where({ product_code: _.in(batch) })
          .field({ product_code: true, status: true, default_unit: true });
        const materialsRes = await applyStableOrder(materialQuery, [
          ['product_code', 'asc'],
          ['_id', 'asc']
        ])
          .skip(materialSkip)
          .limit(limit)
          .get();
        return materialsRes.data || [];
      }, {
        batchSize: 100,
        pageSize: 100
      });
    }

    const mappedGroups = groups.map(item => {
        const material = materialMap.get(item.product_code) || {};
        let totalQuantity = 0;
        const totalBaseLengthM = Number(item.totalBaseLengthM) || 0;
        let unit = item.firstUnit || '';

        if (item.category === 'film') {
          const displayUnit = normalizeFilmUnit(material.default_unit || unit || 'm');
          totalQuantity = Number(totalBaseLengthM.toFixed(2));
          unit = displayUnit;
        } else {
          totalQuantity = Number((Number(item.totalChemicalQty) || 0).toFixed(2));
        }

        const isExpiring = checkExpiring(item.minExpiry, item.category);
        const isLowStock = checkLowStock({
          category: item.category,
          totalQuantity: item.lowStockQuantity,
          totalBaseLengthM,
          unit
        });
        const isRisky = isExpiring || isLowStock;

        return {
          _groupKey: item._groupKey,
          product_code: item.product_code,
          material_name: item.material_name,
          category: item.category,
          subcategory_key: item.subcategory_key || '',
          sub_category: resolveSubcategoryDisplay(item, subcategoryMap),
          supplier_model: item.supplier_model || '',
          is_test_material: !!item.is_test_material,
          totalQuantity: totalQuantity,
          totalBaseLengthM: totalBaseLengthM,
          totalCount: item.totalCount,
          unit: unit,
          minExpiry: item.minExpiry,
          locations: item.locations,
          recommendedCode: '',
          recommendedBatchNumber: '',
          matchReasonText: '',
          match_score: searchMatches.get(item._groupKey)?.match_score || 0,
          match_reason: searchMatches.get(item._groupKey)?.match_reason || '',
          match_field: searchMatches.get(item._groupKey)?.match_field || '',
          isExpiring,
          isLowStock,
          isRisky,
          isArchived: material.status === 'archived'
        };
    });

    const filteredGroups = mappedGroups.filter((item) => {
      if (normalizedFilter === 'expiry') {
        return item.isExpiring;
      }
      if (normalizedFilter === 'low_stock') {
        return item.isLowStock;
      }
      if (normalizedFilter === 'risk') {
        return item.isRisky;
      }
      return true;
    }).sort((a, b) => {
      if (normalizedKeyword) {
        const relevanceCompare = compareSearchResults(a, b, ['product_code', 'supplier_model', '_groupKey']);
        if (relevanceCompare !== 0) {
          return relevanceCompare;
        }
      }
      const timeA = a.minExpiry ? new Date(a.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.minExpiry ? new Date(b.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      const codeCompare = String(a.product_code).localeCompare(String(b.product_code));
      if (codeCompare !== 0) {
        return codeCompare;
      }
      return String(a.supplier_model || '').localeCompare(String(b.supplier_model || ''));
    });

    const total = filteredGroups.length;
    const start = (page - 1) * pageSize;
    const list = filteredGroups.slice(start, start + pageSize);
    const isEnd = start + list.length >= total;

    const pageItemsMap = await loadInventoryItemsForGroups(baseWhere, list);
    list.forEach((item) => {
      const items = pageItemsMap.get(item._groupKey) || [];
      const material = materialMap.get(item.product_code) || {};
      const recommendation = buildInventoryAllocationRecommendation(items);

      if (item.category === 'film' && items.length > 0) {
        const displayUnit = normalizeFilmUnit(material.default_unit || item.unit || 'm');
        const summary = summarizeFilmDisplayQuantities(items, displayUnit);
        item.totalQuantity = summary.displayQuantity;
        item.totalBaseLengthM = summary.baseLengthM;
        item.unit = summary.displayUnit;
        item.isLowStock = checkLowStock(item);
        item.isRisky = item.isExpiring || item.isLowStock;
      }

      item.recommendedCode = recommendation.recommendedCode;
      item.recommendedBatchNumber = recommendation.recommendedBatchNumber;
      item.matchReasonText = item.match_reason
        || resolveGroupMatchReasonText({ ...item, items }, normalizedKeyword, zoneMap, detailMapByZone);
    });

    return {
      success: true,
      list,
      total,
      page,
      pageSize,
      isEnd,
      ...(regex ? { searchTruncated: false, searchMessage: '' } : {})
    };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function checkExpiring(dateStr, category) {
    if (!dateStr) return false;

    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return false;

    const diff = target.getTime() - Date.now();

    const days = Math.ceil(diff / ONE_DAY_MS);
    return days <= ALERT_CONFIG.EXPIRY_DAYS;
}

function checkLowStock(item = {}) {
    if (String(item.category || '').trim() === 'film') {
      return isFilmLowStock(item.totalBaseLengthM, ALERT_CONFIG);
    }

    return isChemicalLowStock(item.totalQuantity, item.unit, ALERT_CONFIG);
}

async function loadInventoryItemsForGroups(baseWhere, groups) {
    const productCodes = Array.from(new Set(
      (groups || [])
        .map(item => item && item.product_code)
        .filter(code => code && code !== '无产品代码')
    ));
    if (productCodes.length === 0) {
      return new Map();
    }

    const result = new Map();
    const pageSize = 100;
    const where = _.and([
      baseWhere,
      { product_code: _.in(productCodes) }
    ]);
    let skip = 0;

    while (true) {
      const query = db.collection('inventory')
        .where(where)
        .field({
          _id: true,
          material_name: true,
          category: true,
          subcategory_key: true,
          sub_category: true,
          product_code: true,
          quantity: true,
          dynamic_attrs: true,
          expiry_date: true,
          location: true,
          location_text: true,
          location_detail: true,
          zone_key: true,
          batch_number: true,
          supplier: true,
          supplier_model: true,
          sample_note: true,
          is_test_material: true,
          unique_code: true,
          status: true,
          create_time: true
        });
      const res = await applyStableOrder(query, [
        ['create_time', 'asc'],
        ['_id', 'asc']
      ])
        .skip(skip)
        .limit(pageSize)
        .get();

      const list = res.data || [];
      list.forEach((item) => {
        const groupKey = buildInventoryGroupKey(item);
        if (!result.has(groupKey)) {
          result.set(groupKey, []);
        }
        result.get(groupKey).push(item);
      });

      if (list.length < pageSize) {
        break;
      }
      skip += pageSize;
    }

    return result;
}

function resolveGroupMatchReasonText(group, keyword, zoneMap, detailMapByZone) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword || !group) {
      return '';
    }

    if (
      matchesSearchFields(group, ['product_code'], normalizedKeyword) ||
      matchesSearchFields(group, ['material_name'], normalizedKeyword)
    ) {
      return '';
    }

    const groupItems = Array.isArray(group.items) ? group.items : [];

    if (groupItems.some(item => matchesSearchFields(item, ['unique_code'], normalizedKeyword))) {
      return '标签编号匹配';
    }
    if (groupItems.some(item => matchesSearchFields(item, ['batch_number'], normalizedKeyword))) {
      return '批号匹配';
    }
    if (groupItems.some(item => {
      const searchableItem = {
        ...item,
        resolved_location_text: resolveInventoryLocationText(item, zoneMap, detailMapByZone)
      };
      return matchesSearchFields(
        searchableItem,
        ['location', 'location_text', 'resolved_location_text'],
        normalizedKeyword
      );
    })) {
      return '库位匹配';
    }
    if (groupItems.some(item => matchesSearchFields(item, ['supplier', 'supplier_model'], normalizedKeyword))) {
      return '供应商/型号匹配';
    }
    if (groupItems.some(item => matchesSearchFields(item, ['sample_note'], normalizedKeyword))) {
      return '样品说明匹配';
    }

    return '';
}
