const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const ALERT_CONFIG = {
  EXPIRY_DAYS: 30
};

exports.main = async (event) => {
  const productCode = String(event.productCode || event.code || '').trim();
  const materialName = String(event.materialName || event.name || '').trim();
  const category = String(event.category || '').trim();
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(event.pageSize) || 20));

  try {
    const conditions = [{ status: 'in_stock' }];
    if (productCode && productCode !== '无产品代码') {
      conditions.push({ product_code: productCode });
    } else if (materialName) {
      conditions.push({ material_name: materialName });
    }
    if (category) {
      conditions.push({ category });
    }

    const where = conditions.length === 1 ? conditions[0] : _.and(conditions);
    const inventoryItems = await loadInventoryItems(where);
    const zoneMap = await loadZoneMap();
    const groupedMap = new Map();

    for (let i = 0; i < inventoryItems.length; i += 1) {
      const item = inventoryItems[i] || {};
      const batchNumber = String(item.batch_number || '').trim() || '无批号';
      const resolvedLocation = resolveInventoryLocationText(item, zoneMap);
      let group = groupedMap.get(batchNumber);

      if (!group) {
        group = {
          batch_number: batchNumber,
          product_code: item.product_code || '',
          material_name: item.material_name || '',
          category: item.category || '',
          subcategory_key: item.subcategory_key || '',
          sub_category: item.sub_category || '',
          labelCount: 0,
          minExpiry: item.expiry_date || null,
          locations: new Set(),
          records: []
        };
        groupedMap.set(batchNumber, group);
      }

      group.records.push(item);
      group.labelCount += 1;
      if (resolvedLocation) {
        group.locations.add(resolvedLocation);
      }
      if (!group.product_code && item.product_code) {
        group.product_code = item.product_code;
      }
      if (!group.material_name && item.material_name) {
        group.material_name = item.material_name;
      }
      if (!group.subcategory_key && item.subcategory_key) {
        group.subcategory_key = item.subcategory_key;
      }
      if (!group.sub_category && item.sub_category) {
        group.sub_category = item.sub_category;
      }
      if (item.expiry_date && (!group.minExpiry || new Date(item.expiry_date) < new Date(group.minExpiry))) {
        group.minExpiry = item.expiry_date;
      }
    }

    const batches = Array.from(groupedMap.values());
    const materialMap = await loadMaterialMapByProductCodes(
      batches.map(item => item.product_code).filter(Boolean)
    );

    const sortedBatches = batches.map((group) => {
      const material = materialMap.get(group.product_code) || {};
      const firstRecord = group.records[0] || {};
      let totalQuantity = 0;
      let totalBaseLengthM = 0;
      let unit = firstRecord && firstRecord.quantity ? firstRecord.quantity.unit : '';

      if (group.category === 'film') {
        const displayUnit = normalizeFilmUnit(material.default_unit || unit || 'm');
        const summary = summarizeFilmDisplayQuantities(group.records, displayUnit);
        totalQuantity = summary.displayQuantity;
        totalBaseLengthM = summary.baseLengthM;
        unit = summary.displayUnit;
      } else {
        totalQuantity = Number(group.records.reduce((sum, current) => {
          const quantityVal = current && current.quantity ? Number(current.quantity.val) || 0 : 0;
          return sum + quantityVal;
        }, 0).toFixed(2));
      }

      const locations = Array.from(group.locations);

      return {
        batch_number: group.batch_number,
        product_code: material.product_code || group.product_code,
        material_name: material.material_name || group.material_name,
        category: group.category,
        subcategory_key: material.subcategory_key || group.subcategory_key || '',
        sub_category: material.sub_category || group.sub_category || '',
        totalQuantity,
        totalBaseLengthM,
        unit,
        labelCount: group.labelCount,
        itemCount: group.labelCount,
        locations,
        locationSummary: summarizeLocationScope(locations),
        minExpiry: group.minExpiry,
        isExpiring: checkExpiring(group.minExpiry),
        isArchived: material.status === 'archived'
      };
    }).sort((left, right) => {
      const timeLeft = left.minExpiry ? new Date(left.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      const timeRight = right.minExpiry ? new Date(right.minExpiry).getTime() : Number.MAX_SAFE_INTEGER;
      if (timeLeft !== timeRight) {
        return timeLeft - timeRight;
      }
      return String(left.batch_number).localeCompare(String(right.batch_number));
    });

    const total = sortedBatches.length;
    const start = (page - 1) * pageSize;
    const list = sortedBatches.slice(start, start + pageSize);

    return {
      success: true,
      list,
      total,
      page,
      pageSize,
      isEnd: start + list.length >= total
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      msg: error.message
    };
  }
};

async function loadInventoryItems(where) {
  const fields = {
    product_code: true,
    material_name: true,
    category: true,
    subcategory_key: true,
    sub_category: true,
    quantity: true,
    dynamic_attrs: true,
    expiry_date: true,
    location: true,
    location_text: true,
    location_detail: true,
    zone_key: true,
    batch_number: true,
    unique_code: true
  };
  const pageSize = 200;
  let skip = 0;
  let list = [];

  while (true) {
    const res = await db.collection('inventory')
      .where(where)
      .field(fields)
      .skip(skip)
      .limit(pageSize)
      .get();

    const batch = res.data || [];
    list = list.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return list;
}

async function loadZoneMap() {
  const pageSize = 100;
  let skip = 0;
  let rows = [];

  while (true) {
    const res = await db.collection('warehouse_zones')
      .skip(skip)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }));

    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return new Map(
    rows
      .filter(item => item && item.zone_key)
      .map(item => [String(item.zone_key).trim(), String(item.name || '').trim()])
  );
}

function resolveInventoryLocationText(item = {}, zoneMap = new Map()) {
  const zoneKey = String(item.zone_key || '').trim();
  const locationDetail = String(item.location_detail || '').trim();
  const zoneName = zoneKey && zoneMap.has(zoneKey) ? zoneMap.get(zoneKey) : '';
  if (zoneName) {
    return locationDetail ? `${zoneName} | ${locationDetail}` : zoneName;
  }
  return String(item.location_text || item.location || '').trim();
}

function summarizeLocationScope(locations = []) {
  const normalized = Array.from(new Set(
    (locations || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));

  if (normalized.length === 0) {
    return '';
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  return `${normalized.length}个库位`;
}

function chunkValues(values, batchSize) {
  const size = Math.max(1, Number(batchSize) || 100);
  const uniqueValues = Array.from(new Set((values || []).filter(Boolean)));
  const chunks = [];

  for (let i = 0; i < uniqueValues.length; i += size) {
    chunks.push(uniqueValues.slice(i, i + size));
  }

  return chunks;
}

async function loadMaterialMapByProductCodes(productCodes) {
  const batches = chunkValues(productCodes, 100);
  const materialMap = new Map();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    let skip = 0;

    while (true) {
      const res = await db.collection('materials')
        .where({ product_code: _.in(batch) })
        .field({
          product_code: true,
          material_name: true,
          status: true,
          default_unit: true,
          subcategory_key: true,
          sub_category: true
        })
        .skip(skip)
        .limit(100)
        .get();

      const list = res.data || [];
      for (let j = 0; j < list.length; j += 1) {
        const row = list[j];
        if (row && row.product_code) {
          materialMap.set(row.product_code, row);
        }
      }

      if (list.length < 100) {
        break;
      }
      skip += 100;
    }
  }

  return materialMap;
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeFilmUnit(unit) {
  const normalized = String(unit || 'm').trim().toLowerCase();

  if (normalized === 'm' || normalized === '米') return 'm';
  if (normalized === 'm²' || normalized === '㎡' || normalized === 'm2' || normalized === '平方米') return 'm²';
  if (normalized === 'roll' || normalized === '卷' || normalized === '卷装') return '卷';

  return String(unit || 'm').trim() || 'm';
}

function getFilmDisplayQuantityFromBaseLength(baseLengthM, displayUnit, widthMm, initialLengthM) {
  const normalizedUnit = normalizeFilmUnit(displayUnit);
  const safeBaseLength = roundNumber(baseLengthM);
  const safeWidthMm = Number(widthMm) || 0;
  const safeInitialLengthM = Number(initialLengthM) || 0;

  if (normalizedUnit === 'm²') {
    return roundNumber(safeBaseLength * (safeWidthMm / 1000), 2);
  }

  if (normalizedUnit === '卷') {
    if (safeInitialLengthM > 0) {
      return roundNumber(safeBaseLength / safeInitialLengthM, 3);
    }
    return safeBaseLength > 0 ? 1 : 0;
  }

  return roundNumber(safeBaseLength, 2);
}

function getFilmDisplayState(item, preferredUnit) {
  const dynamicAttrs = item && item.dynamic_attrs ? item.dynamic_attrs : {};
  const specs = item && item.specs ? item.specs : {};
  const quantity = item && item.quantity ? item.quantity : {};
  const fallbackLength = item && item.length_m !== undefined ? item.length_m : 0;
  const fallbackDefaultUnit = item && item.default_unit ? item.default_unit : 'm';
  const baseLengthM = Number(
    dynamicAttrs.current_length_m !== undefined ? dynamicAttrs.current_length_m : fallbackLength
  ) || 0;
  const widthMm = Number(
    dynamicAttrs.width_mm !== undefined
      ? dynamicAttrs.width_mm
      : (specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm)
  ) || 0;
  const initialLengthM = Number(
    dynamicAttrs.initial_length_m !== undefined ? dynamicAttrs.initial_length_m : (fallbackLength || baseLengthM)
  ) || 0;
  const unit = normalizeFilmUnit(preferredUnit || quantity.unit || fallbackDefaultUnit || 'm');

  return {
    baseLengthM: roundNumber(baseLengthM),
    displayUnit: unit,
    displayQuantity: getFilmDisplayQuantityFromBaseLength(baseLengthM, unit, widthMm, initialLengthM)
  };
}

function summarizeFilmDisplayQuantities(items, preferredUnit) {
  const list = items || [];
  const firstItem = list[0] || {};
  const firstQuantity = firstItem.quantity || {};
  const displayUnit = normalizeFilmUnit(preferredUnit || firstQuantity.unit || firstItem.default_unit || 'm');
  let totalBaseLengthM = 0;
  let totalDisplayQuantity = 0;

  for (let i = 0; i < list.length; i += 1) {
    const filmState = getFilmDisplayState(list[i], displayUnit);
    totalBaseLengthM += filmState.baseLengthM;
    totalDisplayQuantity += filmState.displayQuantity;
  }

  return {
    baseLengthM: roundNumber(totalBaseLengthM, 2),
    displayQuantity: roundNumber(totalDisplayQuantity, displayUnit === '卷' ? 3 : 2),
    displayUnit
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 8 * 60 * 60 * 1000;

function checkExpiring(dateStr) {
  if (!dateStr) {
    return false;
  }

  const currentRescaled = Date.now() + OFFSET_MS;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) {
    return false;
  }

  const diff = target.getTime() - currentRescaled;
  const days = Math.ceil(diff / ONE_DAY_MS);
  return days <= ALERT_CONFIG.EXPIRY_DAYS;
}
