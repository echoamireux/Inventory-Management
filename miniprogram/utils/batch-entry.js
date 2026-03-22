const { composeLocation } = require('./location-zone');

function resolveBatchEntryTab(tab) {
  return tab === 'film' ? 'film' : 'chemical';
}

function resolveBatchEntryTitle(tab) {
  return resolveBatchEntryTab(tab) === 'film' ? '膜材批量入库' : '化材批量入库';
}

function assertBatchEntryMaterialCategory(activeTab, material) {
  const category = material && material.category;
  if (category === activeTab) {
    return { ok: true };
  }

  return {
    ok: false,
    msg: activeTab === 'film'
      ? '当前批量页仅支持膜材物料，请从对应页签进入'
      : '当前批量页仅支持化材物料，请从对应页签进入'
  };
}

function buildSelectedMaterialSummary(material) {
  if (!material) {
    return null;
  }

  const specs = material.specs || {};
  const widthMm = specs.standard_width_mm !== undefined
    ? specs.standard_width_mm
    : specs.width_mm;
  const thicknessUm = specs.thickness_um !== undefined && specs.thickness_um !== null
    ? String(specs.thickness_um)
    : '';
  const standardWidthMm = widthMm !== undefined && widthMm !== null
    ? String(widthMm)
    : '';
  const missingFilmSpecFields = [];
  const isFilm = material.category === 'film';

  if (isFilm) {
    if (!thicknessUm) {
      missingFilmSpecFields.push('thickness_um');
    }
    if (!standardWidthMm) {
      missingFilmSpecFields.push('standard_width_mm');
    }
  }

  const thicknessLocked = isFilm && !!thicknessUm;
  const requiresFilmSpecCompletion = isFilm && missingFilmSpecFields.length > 0;
  let specStatusText = '';
  if (isFilm) {
    if (missingFilmSpecFields.length === 2) {
      specStatusText = '待补厚度与默认幅宽';
    } else if (missingFilmSpecFields.length === 1 && missingFilmSpecFields[0] === 'standard_width_mm') {
      specStatusText = '厚度已锁定，待补默认幅宽';
    } else if (missingFilmSpecFields.length === 1 && missingFilmSpecFields[0] === 'thickness_um') {
      specStatusText = '待补厚度，默认幅宽可直接带出';
    } else {
      specStatusText = '主数据完整，本批次可单独调整实际幅宽';
    }
  }

  return {
    productCode: material.product_code || '',
    materialName: material.material_name || material.name || '',
    subCategory: material.sub_category || '',
    unit: material.default_unit || material.unit || '',
    packageType: material.package_type || '',
    thicknessUm,
    standardWidthMm,
    thicknessLocked,
    requiresFilmSpecCompletion,
    missingFilmSpecFields,
    specStatusText
  };
}

function buildBatchListItem(material, uniqueCode, defaults = {}) {
  const locationZoneKey = String(defaults.defaultLocationZoneKey || '').trim();
  const locationZoneName = String(defaults.defaultLocationZoneName || defaults.defaultLocationZone || '').trim();
  const locationZone = String(defaults.defaultLocationZone || '').trim();
  const locationDetail = String(defaults.defaultLocationDetail || '').trim();
  const isLongTermValid = !!defaults.defaultIsLongTermValid;

  return {
    unique: Date.now() + Math.random(),
    material_id: material._id,
    material_name: material.material_name,
    product_code: material.product_code,
    category: material.category,
    subcategory_key: material.subcategory_key || '',
    sub_category: material.sub_category,
    batch_number: defaults.defaultBatchNo || '',
    expiry_date: isLongTermValid ? '' : (defaults.defaultExpiry || ''),
    expiry_date_str: isLongTermValid ? '长期有效' : (defaults.defaultExpiry || ''),
    is_long_term_valid: isLongTermValid,
    zone_key: locationZoneKey,
    location_zone: locationZone,
    location_detail: locationDetail,
    location: composeLocation(locationZoneName || locationZone, locationDetail),
    quantity: {
      val: 1,
      unit: material.default_unit || material.unit || 'kg'
    },
    unique_code: String(uniqueCode || '').trim(),
    thickness_um: material && material.specs && material.specs.thickness_um !== undefined
      ? Number(material.specs.thickness_um)
      : undefined,
    batch_width_mm: defaults.currentBatchWidthMm !== undefined && defaults.currentBatchWidthMm !== null && String(defaults.currentBatchWidthMm).trim() !== ''
      ? Number(defaults.currentBatchWidthMm)
      : (
        material && material.specs
          ? Number(
            material.specs.standard_width_mm !== undefined
              ? material.specs.standard_width_mm
              : material.specs.width_mm
          ) || undefined
          : undefined
      )
  };
}

function findDuplicateBatchUniqueCode(list = [], uniqueCode = '') {
  const normalizedCode = String(uniqueCode || '').trim();
  if (!normalizedCode) {
    return false;
  }

  return list.some((item) => String((item && item.unique_code) || '').trim() === normalizedCode);
}

function buildBatchEmptyState(hasSelectedMaterial) {
  return hasSelectedMaterial
    ? '暂无条目，请开始连续扫描标签'
    : '请先选择产品代码';
}

function toISOStringOrNull(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function buildBatchSubmitItems(items, defaults = {}) {
  const defaultLocation = composeLocation(defaults.defaultLocationZoneName || defaults.defaultLocationZone, defaults.defaultLocationDetail);
  const defaultZoneKey = String(defaults.defaultLocationZoneKey || '').trim();
  const defaultIsLongTermValid = !!defaults.defaultIsLongTermValid;

  return (items || []).map((item) => {
    const hasOwnZone = !!String(item.location_zone || '').trim();
    const hasOwnZoneKey = !!String(item.zone_key || '').trim();
    const resolvedZoneName = hasOwnZone
      ? item.location_zone
      : (defaults.defaultLocationZoneName || defaults.defaultLocationZone || '');
    const resolvedLocationDetail = hasOwnZone || hasOwnZoneKey
      ? String(item.location_detail || '').trim()
      : String(defaults.defaultLocationDetail || '').trim();
    const itemLocation = composeLocation(resolvedZoneName, resolvedLocationDetail) || item.location || defaultLocation;
    const zoneKey = String(item.zone_key || defaultZoneKey || '').trim();
    const locationDetail = String(
      hasOwnZone || hasOwnZoneKey
        ? (item.location_detail || '')
        : (item.location_detail || defaults.defaultLocationDetail || '')
    ).trim();

    const explicitLongTerm = item.is_long_term_valid === true;
    const useLongTerm = explicitLongTerm || (!item.expiry_date && defaultIsLongTermValid);
    const resolvedExpiry = item.expiry_date
      ? toISOStringOrNull(item.expiry_date)
      : (useLongTerm ? null : toISOStringOrNull(defaults.defaultExpiry));

    return {
      ...item,
      unique: undefined,
      zone_key: zoneKey,
      location_detail: locationDetail,
      location_text: itemLocation,
      location: itemLocation,
      batch_number: item.batch_number || defaults.defaultBatchNo || '',
      expiry_date: resolvedExpiry,
      expiry_date_str: useLongTerm
        ? '长期有效'
        : (item.expiry_date_str || defaults.defaultExpiry || ''),
      is_long_term_valid: useLongTerm
    };
  });
}

module.exports = {
  resolveBatchEntryTab,
  resolveBatchEntryTitle,
  assertBatchEntryMaterialCategory,
  buildSelectedMaterialSummary,
  buildBatchListItem,
  buildBatchSubmitItems,
  findDuplicateBatchUniqueCode,
  buildBatchEmptyState
};
