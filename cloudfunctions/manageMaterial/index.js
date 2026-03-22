// cloudfunctions/manageMaterial/index.js
const cloud = require('wx-server-sdk');
const { normalizeUnitInput } = require('./material-units');
const { validateStandardProductCode } = require('./product-code');
const { createImportResultTracker } = require('./import-batch-results');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategoryDisplay,
  resolveSubcategorySelection
} = require('./material-subcategories');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function loadSubcategoryContext(category = '') {
  const allRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const records = category
    ? filterSubcategoryRecordsByCategory(allRecords, category, { includeDisabled: true })
    : allRecords;

  return {
    records,
    map: buildSubcategoryMap(records)
  };
}

async function resolveMaterialSubcategory(data, category) {
  const context = await loadSubcategoryContext(category);
  const resolved = resolveSubcategorySelection({
    category,
    subcategory_key: data && data.subcategory_key,
    sub_category: data && data.sub_category
  }, context.records, context.map);

  if (!resolved.subcategory_key) {
    return {
      ok: false,
      msg: '请选择有效子类别'
    };
  }

  return {
    ok: true,
    ...resolved
  };
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  return normalized;
}

async function getOperator(openid) {
  const operatorRes = await db.collection('users').where({
    _openid: openid
  }).limit(1).get();

  return operatorRes.data && operatorRes.data.length > 0
    ? operatorRes.data[0]
    : null;
}

function buildGovernedMaterialMasterFields(source = {}, category, options = {}) {
  const removeIrrelevant = !!options.removeIrrelevant;
  const fields = {
    material_name: sanitizeText(source.material_name),
    category,
    supplier: sanitizeText(source.supplier),
    supplier_model: sanitizeText(source.supplier_model),
    default_unit: sanitizeText(source.default_unit)
  };

  if (category === 'chemical') {
    fields.package_type = sanitizeText(source.package_type);
    if (removeIrrelevant) {
      fields.specs = _.remove();
    }
    return fields;
  }

  if (category === 'film') {
    const thicknessUm = normalizeOptionalNumber(
      source.thickness_um !== undefined
        ? source.thickness_um
        : source.specs && source.specs.thickness_um
    );
    const standardWidthMm = normalizeOptionalNumber(
      source.width_mm !== undefined
        ? source.width_mm
        : (
          source.standard_width_mm !== undefined
            ? source.standard_width_mm
            : (source.specs && (
              source.specs.standard_width_mm !== undefined
                ? source.specs.standard_width_mm
                : source.specs.width_mm
            ))
        )
    );
    const specs = {};

    if (thicknessUm !== null) {
      specs.thickness_um = thicknessUm;
    }
    if (standardWidthMm !== null) {
      specs.standard_width_mm = standardWidthMm;
    }

    fields.specs = specs;
    if (removeIrrelevant) {
      fields.package_type = _.remove();
    }
  }

  return fields;
}

/**
 * 物料主数据管理云函数
 *
 * @param {string} action - 操作类型: list / get / create / update / archive
 * @param {object} data - 操作数据
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, data } = event;

  try {
    switch (action) {
      case 'list':
        return await listMaterials(data);
      case 'get':
        return await getMaterial(data);
      case 'create':
        return await createMaterial(data, OPENID);
      case 'update':
        return await updateMaterial(data, OPENID);
      case 'completeFilmSpecsFromInbound':
        return await completeFilmSpecsFromInbound(data, OPENID);
      case 'archive':
        return await archiveMaterial(data, OPENID);
      case 'batchCreate':
        return await batchCreateMaterials(data, OPENID);
      case 'batchDelete':
        return await batchDeleteMaterials(data, OPENID);
      case 'restore':
        return await restoreMaterial(data, OPENID);
      case 'checkStatus':
        return await checkMaterialStatus(data);
      case 'checkHistory':
        return await checkMaterialHistory(data);
      default:
        return { success: false, msg: '未知操作' };
    }
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};

/**
 * 获取物料列表
 */
async function listMaterials(params = {}) {
  const { searchVal, category, status, page = 1, pageSize = 20 } = params;

  // Default to non-archived if status not specified
  // If status === 'archived', query archived
  // If status === 'active', query active (which is status!=archived AND status!=deleted, but here assume 'active' or undefined for simplicity)

  let query = {};
  if (status === 'archived') {
      query.status = 'archived';
  } else {
      query.status = _.neq('archived');
  }

  if (category) {
    query.category = category;
  }

  if (searchVal) {
    const regex = db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' });
    query = _.and([
      query,
      _.or([
        { product_code: regex },
        { material_name: regex },
        { supplier: regex }
      ])
    ]);
  }

  const countRes = await db.collection('materials').where(query).count();
  const total = countRes.total;

  const res = await db.collection('materials')
    .where(query)
    .orderBy('product_code', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const context = await loadSubcategoryContext();
  const list = (res.data || []).map(item => ({
    ...item,
    sub_category: resolveSubcategoryDisplay(item, context.map)
  }));

  return {
    success: true,
    list,
    total,
    page,
    pageSize
  };
}

/**
 * 获取单个物料详情
 */
async function getMaterial(params) {
  const { id, product_code } = params;

  let res;
  if (id) {
    res = await db.collection('materials').doc(id).get();
    const context = await loadSubcategoryContext(res.data && res.data.category);
    return {
      success: true,
      data: {
        ...res.data,
        sub_category: resolveSubcategoryDisplay(res.data, context.map)
      }
    };
  } else if (product_code) {
    res = await db.collection('materials').where({ product_code }).get();
    if (res.data.length === 0) {
      return { success: false, msg: '物料不存在' };
    }
    const context = await loadSubcategoryContext(res.data[0] && res.data[0].category);
    return {
      success: true,
      data: {
        ...res.data[0],
        sub_category: resolveSubcategoryDisplay(res.data[0], context.map)
      }
    };
  } else {
    return { success: false, msg: '缺少查询参数' };
  }
}

/**
 * 创建新物料
 */
async function createMaterial(data, openid) {
  const { product_code, material_name, category } = data;

  // 验证必填字段
  if (!product_code || !material_name || !category) {
    return { success: false, msg: '缺少必填字段' };
  }

  const normalizedCode = validateStandardProductCode(category, product_code);
  if (!normalizedCode.ok) {
    return { success: false, msg: normalizedCode.msg };
  }

  const normalizedUnit = normalizeUnitInput(category, data.default_unit);
  if (!normalizedUnit.ok) {
    return { success: false, msg: normalizedUnit.msg };
  }
  const resolvedSubcategory = await resolveMaterialSubcategory(data, category);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }

  // 检查 product_code 是否已存在
  const existing = await db.collection('materials')
    .where({ product_code: normalizedCode.product_code })
    .count();

  if (existing.total > 0) {
    return { success: false, msg: '产品代码已存在' };
  }

  const now = db.serverDate();
  const masterFields = buildGovernedMaterialMasterFields({
    ...data,
    default_unit: normalizedUnit.unit,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category
  }, category);
  const newMaterial = {
    product_code: normalizedCode.product_code,
    subcategory_key: resolvedSubcategory.subcategory_key,
    sub_category: resolvedSubcategory.sub_category,
    ...masterFields,
    status: 'active',
    created_by: openid,
    created_at: now,
    updated_by: openid,
    updated_at: now
  };

  const res = await db.collection('materials').add({ data: newMaterial });

  // 记录日志
  await logMaterialChange({
    material_id: res._id,
    product_code: normalizedCode.product_code,
    action: 'create',
    operator: openid,
    changes: newMaterial
  });

  return { success: true, id: res._id };
}

/**
 * 更新物料信息
 */
async function updateMaterial(data, openid) {
  const { id, ...updateData } = data;

  if (!id) {
    return { success: false, msg: '缺少物料ID' };
  }

  // 获取原数据用于日志
  const oldRes = await db.collection('materials').doc(id).get();
  const oldData = oldRes.data;
  const nextCategory = updateData.category || oldData.category;

  if (updateData.product_code) {
    const normalizedCode = validateStandardProductCode(nextCategory, updateData.product_code);
    if (!normalizedCode.ok) {
      return { success: false, msg: normalizedCode.msg };
    }
    updateData.product_code = normalizedCode.product_code;
  }

  // 如果修改了 product_code，检查是否冲突
  if (updateData.product_code && updateData.product_code !== oldData.product_code) {
    const existing = await db.collection('materials')
      .where({ product_code: updateData.product_code })
      .count();
    if (existing.total > 0) {
      return { success: false, msg: '产品代码已存在' };
    }
  }

  const nextUnit = Object.prototype.hasOwnProperty.call(updateData, 'default_unit')
    ? updateData.default_unit
    : oldData.default_unit;
  const normalizedUnit = normalizeUnitInput(nextCategory, nextUnit);
  if (!normalizedUnit.ok) {
    return { success: false, msg: normalizedUnit.msg };
  }
  const resolvedSubcategory = await resolveMaterialSubcategory({
    subcategory_key: updateData.subcategory_key || oldData.subcategory_key,
    sub_category: Object.prototype.hasOwnProperty.call(updateData, 'sub_category')
      ? updateData.sub_category
      : oldData.sub_category
  }, nextCategory);
  if (!resolvedSubcategory.ok) {
    return { success: false, msg: resolvedSubcategory.msg };
  }

  updateData.default_unit = normalizedUnit.unit;
  updateData.subcategory_key = resolvedSubcategory.subcategory_key;
  updateData.sub_category = resolvedSubcategory.sub_category;
  Object.assign(
    updateData,
    buildGovernedMaterialMasterFields({
      ...oldData,
      ...updateData,
      default_unit: normalizedUnit.unit,
      subcategory_key: resolvedSubcategory.subcategory_key,
      sub_category: resolvedSubcategory.sub_category
    }, nextCategory, { removeIrrelevant: true })
  );
  updateData.updated_by = openid;
  updateData.updated_at = db.serverDate();

  await db.collection('materials').doc(id).update({ data: updateData });

  // 记录日志
  await logMaterialChange({
    material_id: id,
    product_code: updateData.product_code || oldData.product_code,
    action: 'update',
    operator: openid,
    old_data: oldData,
    new_data: updateData
  });

  return { success: true };
}

async function completeFilmSpecsFromInbound(data, openid) {
  const { id, thickness_um, batch_width_mm, width_mm } = data || {};

  if (!id) {
    return { success: false, msg: '缺少物料ID' };
  }

  const operator = await getOperator(openid);
  if (!operator || operator.status !== 'active') {
    return { success: false, msg: '仅已激活用户可补齐首批膜材规格' };
  }

  const materialRes = await db.collection('materials').doc(id).get();
  const material = materialRes.data;
  if (!material) {
    return { success: false, msg: '物料不存在' };
  }
  if (material.category !== 'film') {
    return { success: false, msg: '仅膜材支持首批规格补录' };
  }

  const nextThicknessUm = normalizeOptionalNumber(thickness_um);
  const nextBatchWidthMm = normalizeOptionalNumber(
    batch_width_mm !== undefined ? batch_width_mm : width_mm
  );

  const currentSpecs = material.specs || {};
  const currentThicknessUm = normalizeOptionalNumber(currentSpecs.thickness_um);
  const currentWidthMm = normalizeOptionalNumber(
    currentSpecs.standard_width_mm !== undefined
      ? currentSpecs.standard_width_mm
      : currentSpecs.width_mm
  );

  if (!currentThicknessUm && !nextThicknessUm) {
    return { success: false, msg: '请填写有效的补录厚度' };
  }
  if (!nextBatchWidthMm) {
    return { success: false, msg: '请填写有效的本批次实际幅宽' };
  }

  if (currentThicknessUm && nextThicknessUm && currentThicknessUm !== nextThicknessUm) {
    return {
      success: false,
      msg: `当前物料厚度已锁定为 ${currentThicknessUm} μm，请按主数据入库；如需修改请联系管理员在物料管理中调整`
    };
  }

  const updateData = {
    updated_by: openid,
    updated_at: db.serverDate()
  };
  const newData = {};

  if (!currentThicknessUm) {
    updateData['specs.thickness_um'] = nextThicknessUm;
    newData['specs.thickness_um'] = nextThicknessUm;
  }
  if (!currentWidthMm) {
    updateData['specs.standard_width_mm'] = nextBatchWidthMm;
    newData['specs.standard_width_mm'] = nextBatchWidthMm;
  }

  if (Object.keys(newData).length > 0) {
    await db.collection('materials').doc(id).update({ data: updateData });
    await logMaterialChange({
      material_id: id,
      product_code: material.product_code,
      action: 'complete_specs_from_inbound',
      operator: openid,
      old_data: {
        specs: {
          thickness_um: currentThicknessUm || null,
          standard_width_mm: currentWidthMm || null
        }
      },
      new_data: newData
    });
  }

  return {
    success: true,
    data: {
      material_thickness_um: currentThicknessUm || nextThicknessUm,
      material_standard_width_mm: currentWidthMm || nextBatchWidthMm,
      batch_width_mm: nextBatchWidthMm
    }
  };
}

/**
 * 归档物料（软删除）
 */
async function archiveMaterial(data, openid) {
  const { id } = data;

  if (!id) {
    return { success: false, msg: '缺少物料ID' };
  }

  const oldRes = await db.collection('materials').doc(id).get();
  const oldData = oldRes.data;

  await db.collection('materials').doc(id).update({
    data: {
      status: 'archived',
      updated_by: openid,
      updated_at: db.serverDate()
    }
  });

  // 记录日志
  await logMaterialChange({
    material_id: id,
    product_code: oldData.product_code,
    action: 'archive',
    operator: openid
  });

  return { success: true };
}

/**
 * 记录物料变更日志
 */
async function logMaterialChange(logData) {
  try {
    await db.collection('material_log').add({
      data: {
        ...logData,
        timestamp: db.serverDate()
      }
    });
  } catch (err) {
    console.error('记录物料日志失败:', err);
  }
}

/**
 * 批量创建物料
 */
async function batchCreateMaterials(data, openid) {
  const { items } = data;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, msg: '无有效数据' };
  }

  // 限制单次最多导入 100 条
  if (items.length > 100) {
    return { success: false, msg: '单次最多导入 100 条' };
  }

  let created = 0;
  const now = db.serverDate();
  const tracker = createImportResultTracker();
  const subcategoryContexts = {
    chemical: await loadSubcategoryContext('chemical'),
    film: await loadSubcategoryContext('film')
  };

  for (const item of items) {
    try {
      // 跳过有错误的数据
      if (item.error) {
        tracker.recordError(item.rowIndex, item.product_code, item.error);
        continue;
      }

      const { product_code, material_name, category, default_unit, supplier, supplier_model } = item;
      const normalizedCode = validateStandardProductCode(category, product_code);
      if (!normalizedCode.ok) {
        tracker.recordError(item.rowIndex, product_code, normalizedCode.msg);
        continue;
      }
      const normalizedUnit = normalizeUnitInput(category, default_unit);
      if (!normalizedUnit.ok) {
        tracker.recordError(item.rowIndex, normalizedCode.product_code, normalizedUnit.msg);
        continue;
      }
      const context = subcategoryContexts[category === 'film' ? 'film' : 'chemical'];
      const resolvedSubcategory = resolveSubcategorySelection({
        category,
        subcategory_key: item.subcategory_key,
        sub_category: item.sub_category
      }, context.records, context.map);
      if (!resolvedSubcategory.subcategory_key) {
        tracker.recordError(item.rowIndex, normalizedCode.product_code, '子类别无效');
        continue;
      }

      // 检查是否已存在
      const existing = await db.collection('materials')
        .where({ product_code: normalizedCode.product_code })
        .count();

      if (existing.total > 0) {
        tracker.recordSkipped(item.rowIndex, normalizedCode.product_code, '产品代码已存在');
        continue;
      }

      // 创建物料
      const newMaterial = {
        product_code: normalizedCode.product_code,
        material_name,
        category,
        subcategory_key: resolvedSubcategory.subcategory_key,
        sub_category: resolvedSubcategory.sub_category,
        default_unit: normalizedUnit.unit,
        supplier: supplier || '',
        supplier_model: supplier_model || '',
        status: 'active',
        created_by: openid,
        created_at: now,
        updated_by: openid,
        updated_at: now
      };

      await db.collection('materials').add({ data: newMaterial });
      created++;
      tracker.recordCreated(item.rowIndex, normalizedCode.product_code);

    } catch (err) {
      console.error('创建物料失败:', item.product_code, err);
      tracker.recordError(item.rowIndex, item.product_code, err.message || '创建物料失败');
    }
  }

  const importResult = tracker.toResponse();
  const skipped = importResult.skipped;
  const errors = importResult.errors;

  // 记录批量导入日志
  await logMaterialChange({
    action: 'batch_create',
    operator: openid,
    changes: { total: items.length, created, skipped, errors }
  });

  return {
    success: true,
    created,
    skipped,
    errors,
    results: importResult.results,
    msg: `成功导入 ${created} 条`
  };
}

/**
 * 批量删除/归档物料 (智能策略)
 */
async function batchDeleteMaterials(data, openid) {
  const { ids, archive_reason } = data;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { success: false, msg: '请选择要删除的物料' };
  }

  let deletedCount = 0;
  let archivedCount = 0;
  const now = db.serverDate();

  for (const id of ids) {
    try {
      // 1. 获取物料信息
      const material = await db.collection('materials').doc(id).get();
      if (!material.data) continue;

      const { product_code } = material.data;

      // 2. 检查是否有库存记录 (Inventory)
      const invCount = await db.collection('inventory')
        .where({ product_code })
        .count();

      if (invCount.total > 0) {
        // A. 有库存记录 -> 执行归档 (软删除)
        await db.collection('materials').doc(id).update({
          data: {
            status: 'archived',
            archive_reason: archive_reason || '批量删除归档',
            updated_by: openid,
            updated_at: now
          }
        });
        archivedCount++;
      } else {
        // B. 无库存记录 -> 执行物理删除
        await db.collection('materials').doc(id).remove();
        deletedCount++;
      }
    } catch (err) {
      console.error(`处理物料 ${id} 失败:`, err);
    }
  }

  return {
    success: true,
    deleted: deletedCount,
    archived: archivedCount,
    msg: `成功删除 ${deletedCount} 条，归档 ${archivedCount} 条`
  };
}

/**
 * 还原归档物料
 */
async function restoreMaterial(data, openid) {
  const { id } = data;
  if (!id) return { success: false, msg: '缺少参数' };

  try {
    const material = await db.collection('materials').doc(id).get();
    if (!material.data) return { success: false, msg: '物料不存在' };

    // 检查是否有同名的 Active 物料 (防重)
    const conflict = await db.collection('materials').where({
      product_code: material.data.product_code,
      status: _.neq('archived')
    }).count();

    if (conflict.total > 0) {
      return { success: false, msg: '当前活跃库中已存在相同代码的物料，无法还原' };
    }

    // 执行还原
    await db.collection('materials').doc(id).update({
      data: {
        status: 'active',
        archive_reason: _.remove(), // 清除归档原因
        updated_by: openid,
        updated_at: db.serverDate()
      }
    });

    return { success: true, msg: '已还原' };
  } catch (err) {
    console.error(err);
    return { success: false, msg: '还原失败' };
  }
}

/**
 * 检查物料状态 (用于入库页)
 */
async function checkMaterialStatus(data) {
  const { product_code } = data;
  if (!product_code) return { success: false };

  // 构造可能的前缀组合
  const codes = [product_code];
  if (!product_code.startsWith('J-') && !product_code.startsWith('M-')) {
    codes.push(`J-${product_code}`);
    codes.push(`M-${product_code}`);
  }

  // 使用 in 查询匹配任意一种情况
  const res = await db.collection('materials').where({
    product_code: db.command.in(codes),
    status: 'archived'
  }).get();

  if (res.data.length > 0) {
    return {
      success: true,
      isArchived: true,
      product_code: res.data[0].product_code,
      reason: res.data[0].archive_reason || '未说明'
    };
  }

  return { success: true, isArchived: false };
}

/**
 * 检查物料历史记录 (用于删除/归档前的确认)
 * 返回 toDelete (无历史记录) 和 toArchive (有历史记录) 两个列表
 */
async function checkMaterialHistory(data) {
  const { ids } = data;
  if (!ids || ids.length === 0) return { success: false, msg: '缺少参数' };

  const toDelete = [];
  const toArchive = [];

  for (const id of ids) {
    try {
      // 获取物料信息
      const materialRes = await db.collection('materials').doc(id).get();
      if (!materialRes.data) continue;

      const material = materialRes.data;

      // 检查是否有库存记录
      const inventoryCount = await db.collection('inventory')
        .where({ product_code: material.product_code })
        .count();

      if (inventoryCount.total > 0) {
        // 有历史记录 -> 归档
        toArchive.push({ _id: id, product_code: material.product_code });
      } else {
        // 无历史记录 -> 可删除
        toDelete.push({ _id: id, product_code: material.product_code });
      }
    } catch (err) {
      console.error('Check history error for id:', id, err);
    }
  }

  return {
    success: true,
    toDelete,
    toArchive
  };
}
