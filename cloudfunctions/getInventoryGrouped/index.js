// cloudfunctions/getInventoryGrouped/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ALERT_CONFIG = require('./alert-config');
const { loadMaterialMapByProductCodes } = require('./material-map');
const {
  ensureBuiltinZones,
  sortZoneRecords,
  buildZoneMap,
  resolveInventoryLocationText
} = require('./warehouse-zones');
const {
  normalizeFilmUnit,
  summarizeFilmDisplayQuantities
} = require('./film-quantity');
const {
  buildContainsRegExp,
  matchesSearchFields,
  normalizeSearchKeyword
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

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function loadInventoryGroupSourceItems(where, pageSize = 100) {
  let skip = 0;
  let rows = [];
  let batch = [];

  do {
    const res = await db.collection('inventory')
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
        zone_key: true
      })
      .skip(skip)
      .limit(pageSize)
      .get();

    batch = res.data || [];
    rows = rows.concat(batch);
    skip += pageSize;
  } while (batch.length === pageSize);

  return rows;
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

function buildInventoryGroups(sourceItems, zoneMap) {
  const byProductCode = new Map();

  (sourceItems || []).forEach((item) => {
    const productCode = item.product_code || '无产品代码';
    if (!byProductCode.has(productCode)) {
      byProductCode.set(productCode, {
        product_code: productCode,
        material_name: item.material_name,
        category: item.category,
        subcategory_key: item.subcategory_key || '',
        sub_category: item.sub_category,
        totalCount: 0,
        minExpiry: null,
        totalChemicalQty: 0,
        totalBaseLengthM: 0,
        firstUnit: item.quantity && item.quantity.unit ? item.quantity.unit : '',
        locationSet: new Set()
      });
    }

    const group = byProductCode.get(productCode);
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
    if (!group.firstUnit && item.quantity && item.quantity.unit) {
      group.firstUnit = item.quantity.unit;
    }

    if (item.location_text) {
      group.locationSet.add(item.location_text);
    }
    if (item.location) {
      group.locationSet.add(item.location);
    }
    if (item.zone_key) {
      const zone = zoneMap.get(item.zone_key);
      if (zone && zone.name) {
        group.locationSet.add(zone.name);
      }
    }
  });

  return Array.from(byProductCode.values()).map(item => ({
    product_code: item.product_code,
    material_name: item.material_name,
    category: item.category,
    subcategory_key: item.subcategory_key || '',
    sub_category: item.sub_category,
    totalCount: item.totalCount,
    minExpiry: item.minExpiry || null,
    totalChemicalQty: Number(item.totalChemicalQty) || 0,
    totalBaseLengthM: Number(item.totalBaseLengthM) || 0,
    firstUnit: item.firstUnit || '',
    locations: Array.from(item.locationSet),
    items: []
  }));
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

    const conditions = [{ status: 'in_stock' }];
    if (category) {
      conditions.push({ category: category });
    }

    const regex = buildContainsRegExp(db, searchVal);
    if (regex) {
      conditions.push(_.or([
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
    const where = conditions.length === 1 ? conditions[0] : _.and(conditions);

    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const zoneMap = buildZoneMap(zoneRecords);
    const subcategoryRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

    const groupSourceItems = await loadInventoryGroupSourceItems(where);
    const groups = buildInventoryGroups(groupSourceItems, zoneMap);

    const productCodes = groups
      .map(item => item.product_code)
      .filter(code => code && code !== '无产品代码');
    let materialMap = new Map();

    if (productCodes.length > 0) {
      materialMap = await loadMaterialMapByProductCodes(productCodes, async ({ productCodes: batch, skip: materialSkip, limit }) => {
        const materialsRes = await db.collection('materials')
          .where({ product_code: _.in(batch) })
          .field({ product_code: true, status: true, default_unit: true })
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
          totalQuantity,
          totalBaseLengthM
        });
        const isRisky = isExpiring || isLowStock;

        return {
          product_code: item.product_code,
          material_name: item.material_name,
          category: item.category,
          subcategory_key: item.subcategory_key || '',
          sub_category: resolveSubcategoryDisplay(item, subcategoryMap),
          totalQuantity: totalQuantity,
          totalBaseLengthM: totalBaseLengthM,
          totalCount: item.totalCount,
          unit: unit,
          minExpiry: item.minExpiry,
          locations: item.locations,
          recommendedCode: '',
          recommendedBatchNumber: '',
          matchReasonText: '',
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
      const timeA = a.minExpiry ? new Date(a.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.minExpiry ? new Date(b.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return String(a.product_code).localeCompare(String(b.product_code));
    });

    const total = filteredGroups.length;
    const start = (page - 1) * pageSize;
    const list = filteredGroups.slice(start, start + pageSize);
    const isEnd = start + list.length >= total;

    const pageCodes = list
      .map(item => item.product_code)
      .filter(code => code && code !== '无产品代码');
    const pageItemsMap = await loadInventoryItemsByProductCodes(where, pageCodes);
    list.forEach((item) => {
      const items = pageItemsMap.get(item.product_code) || [];
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
      item.matchReasonText = resolveGroupMatchReasonText({ ...item, items }, normalizedKeyword, zoneMap);
    });

    return { success: true, list, total, page, pageSize, isEnd };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

function checkExpiring(dateStr, category) {
    if (!dateStr) return false;

    // 1. Current Time (Shifted to CST View)
    // We add 8 hours to UTC time so that "08:00 UTC" becomes "16:00 CST" (numeric value shift)
    // But importantly, "00:00 UTC" becomes "08:00 CST".
    // Wait, we want to align with "Target Date String".
    // "2023-12-31" parses to "2023-12-31 00:00:00 UTC".
    // In our "Shifted View", this represents "2023-12-31 00:00:00 Beijing".
    // So we need to shift NOW by 8 hours to match this "View".

    const now = new Date();
    const currentRescaled = now.getTime() + OFFSET_MS;

    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return false;

    // 2. Calc Diff in "Shifted/Visual" Timeline
    // Target (Visual 00:00) - Now (Visual CST Time)
    const diff = target.getTime() - currentRescaled;

    const days = Math.ceil(diff / ONE_DAY_MS);
    return days <= ALERT_CONFIG.EXPIRY_DAYS;
}

function checkLowStock(item = {}) {
    if (String(item.category || '').trim() === 'film') {
      return (Number(item.totalBaseLengthM) || 0) <= ALERT_CONFIG.LOW_STOCK.film;
    }

    return (Number(item.totalQuantity) || 0) <= ALERT_CONFIG.LOW_STOCK.chemical;
}

async function loadInventoryItemsByProductCodes(baseWhere, productCodes) {
    if (!Array.isArray(productCodes) || productCodes.length === 0) {
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
      const res = await db.collection('inventory')
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
        })
        .skip(skip)
        .limit(pageSize)
        .get();

      const list = res.data || [];
      list.forEach((item) => {
        const productCode = item.product_code || '无产品代码';
        if (!result.has(productCode)) {
          result.set(productCode, []);
        }
        result.get(productCode).push(item);
      });

      if (list.length < pageSize) {
        break;
      }
      skip += pageSize;
    }

    return result;
}

function resolveGroupMatchReasonText(group, keyword, zoneMap) {
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
        resolved_location_text: resolveInventoryLocationText(item, zoneMap)
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
