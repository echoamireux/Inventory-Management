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
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  buildSubcategoryMap,
  resolveSubcategoryDisplay
} = require('./material-subcategories');

exports.main = async (event, context) => {
  const { searchVal, category } = event;

  try {
    const conditions = [{ status: 'in_stock' }];
    if (category) {
      conditions.push({ category: category });
    }

    if (searchVal) {
      const regex = db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' });
      conditions.push(_.or([
        { material_name: regex },
        { product_code: regex },
        { batch_number: regex },
        { supplier: regex },
        { unique_code: regex }
      ]));
    }
    const where = conditions.length === 1 ? conditions[0] : _.and(conditions);

    const pageSize = 200;
    let skip = 0;
    let inventoryItems = [];

    while (true) {
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
          location: true
        })
        .skip(skip)
        .limit(pageSize)
        .get();

      inventoryItems = inventoryItems.concat(res.data || []);
      if (!res.data || res.data.length < pageSize) {
        break;
      }
      skip += pageSize;
    }

    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const zoneMap = buildZoneMap(zoneRecords);
    const subcategoryRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

    const groupedMap = new Map();
    for (let i = 0; i < inventoryItems.length; i += 1) {
      const item = inventoryItems[i];
      const productCode = item.product_code || '无代码';
      const resolvedLocation = resolveInventoryLocationText(item, zoneMap);
      let group = groupedMap.get(productCode);

      if (!group) {
        group = {
          product_code: productCode,
          material_name: item.material_name,
          category: item.category,
          subcategory_key: item.subcategory_key || '',
          sub_category: item.sub_category,
          totalCount: 0,
          minExpiry: item.expiry_date || null,
          locations: new Set(),
          items: []
        };
        groupedMap.set(productCode, group);
      }

      group.totalCount += 1;
      group.items.push(item);
      if (resolvedLocation) {
        group.locations.add(resolvedLocation);
      }
      if (!group.material_name && item.material_name) {
        group.material_name = item.material_name;
      }
      if (!group.sub_category && item.sub_category) {
        group.sub_category = item.sub_category;
      }
      if (!group.subcategory_key && item.subcategory_key) {
        group.subcategory_key = item.subcategory_key;
      }
      if (item.expiry_date && (!group.minExpiry || new Date(item.expiry_date) < new Date(group.minExpiry))) {
        group.minExpiry = item.expiry_date;
      }
    }

    // 4. Check if materials are archived (动态标记已停用)
    const groups = Array.from(groupedMap.values());
    const productCodes = groups
      .map(item => item.product_code)
      .filter(code => code && code !== '无代码');
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

    const list = groups.map(item => {
        const material = materialMap.get(item.product_code) || {};
        let totalQuantity = 0;
        let totalBaseLengthM = 0;
        let unit = item.items[0] && item.items[0].quantity ? item.items[0].quantity.unit : '';

        if (item.category === 'film') {
          const displayUnit = normalizeFilmUnit(material.default_unit || unit || 'm');
          const summary = summarizeFilmDisplayQuantities(item.items, displayUnit);
          totalQuantity = summary.displayQuantity;
          totalBaseLengthM = summary.baseLengthM;
          unit = summary.displayUnit;
        } else {
          totalQuantity = Number(item.items.reduce((sum, current) => {
            const quantityVal = current && current.quantity ? Number(current.quantity.val) || 0 : 0;
            return sum + quantityVal;
          }, 0).toFixed(2));
        }

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
          locations: Array.from(item.locations),
          isExpiring: checkExpiring(item.minExpiry, item.category),
          isArchived: material.status === 'archived'
        };
    }).sort((a, b) => {
      const timeA = a.minExpiry ? new Date(a.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.minExpiry ? new Date(b.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return String(a.product_code).localeCompare(String(b.product_code));
    }).slice(0, 50);

    return { success: true, list };

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
