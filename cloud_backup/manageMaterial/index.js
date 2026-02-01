// cloudfunctions/manageMaterial/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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

  return {
    success: true,
    list: res.data,
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
  } else if (product_code) {
    res = await db.collection('materials').where({ product_code }).get();
    if (res.data.length === 0) {
      return { success: false, msg: '物料不存在' };
    }
    return { success: true, data: res.data[0] };
  } else {
    return { success: false, msg: '缺少查询参数' };
  }

  return { success: true, data: res.data };
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

  // 检查 product_code 是否已存在
  const existing = await db.collection('materials')
    .where({ product_code })
    .count();

  if (existing.total > 0) {
    return { success: false, msg: '产品代码已存在' };
  }

  const now = db.serverDate();
  const newMaterial = {
    ...data,
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
    product_code,
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

  // 如果修改了 product_code，检查是否冲突
  if (updateData.product_code && updateData.product_code !== oldData.product_code) {
    const existing = await db.collection('materials')
      .where({ product_code: updateData.product_code })
      .count();
    if (existing.total > 0) {
      return { success: false, msg: '产品代码已存在' };
    }
  }

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
  let skipped = 0;
  let errors = 0;
  const now = db.serverDate();

  for (const item of items) {
    try {
      // 跳过有错误的数据
      if (item.error) {
        errors++;
        continue;
      }

      const { product_code, material_name, category, sub_category, default_unit, supplier, supplier_model, shelf_life_days } = item;

      // 检查是否已存在
      const existing = await db.collection('materials')
        .where({ product_code })
        .count();

      if (existing.total > 0) {
        skipped++;
        continue;
      }

      // 创建物料
      const newMaterial = {
        product_code,
        material_name,
        category,
        sub_category,
        default_unit: default_unit || (category === 'film' ? 'm' : 'kg'),
        supplier: supplier || '',
        supplier_model: supplier_model || '',
        shelf_life_days: shelf_life_days || null,
        status: 'active',
        created_by: openid,
        created_at: now,
        updated_by: openid,
        updated_at: now
      };

      await db.collection('materials').add({ data: newMaterial });
      created++;

    } catch (err) {
      console.error('创建物料失败:', item.product_code, err);
      errors++;
    }
  }

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
