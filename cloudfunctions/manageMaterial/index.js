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
  const { searchVal, category, page = 1, pageSize = 20 } = params;

  let query = { status: _.neq('archived') };

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
