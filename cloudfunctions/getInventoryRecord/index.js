const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function getOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

async function loadMaterialByInventory(item = {}) {
  if (item.material_id) {
    try {
      const res = await db.collection('materials').doc(item.material_id).get();
      if (res.data) {
        return res.data;
      }
    } catch (err) {
      console.warn('material lookup by id failed', err);
    }
  }

  const productCode = normalizeText(item.product_code);
  if (!productCode) {
    return null;
  }

  const res = await db.collection('materials')
    .where({ product_code: productCode })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function getDetail(event = {}) {
  const id = normalizeText(event.id || event.inventory_id);
  if (!id) {
    return { success: false, msg: '缺少库存记录ID' };
  }

  const res = await db.collection('inventory').doc(id).get();
  if (!res.data) {
    return { success: false, msg: '库存记录不存在' };
  }

  const material = await loadMaterialByInventory(res.data);
  return {
    success: true,
    data: res.data,
    item: res.data,
    material: material || null
  };
}

async function checkLabel(event = {}) {
  const uniqueCode = normalizeText(event.unique_code || event.uniqueCode);
  if (!uniqueCode) {
    return { success: false, msg: '缺少标签编号' };
  }

  const res = await db.collection('inventory')
    .where({ unique_code: uniqueCode })
    .limit(20)
    .get();

  return {
    success: true,
    exists: (res.data || []).length > 0,
    list: res.data || [],
    item: res.data && res.data[0] ? res.data[0] : null
  };
}

async function getByUniqueCode(event = {}) {
  const uniqueCode = normalizeText(event.unique_code || event.uniqueCode);
  if (!uniqueCode) {
    return { success: false, msg: '缺少标签编号' };
  }

  const res = await db.collection('inventory')
    .where({ unique_code: uniqueCode })
    .limit(1)
    .get();
  const item = res.data && res.data[0] ? res.data[0] : null;
  const material = item ? await loadMaterialByInventory(item) : null;

  return {
    success: true,
    list: item ? [item] : [],
    item,
    material: material || null
  };
}

async function getBatchLabels(event = {}) {
  const batchNumber = normalizeText(event.batchNumber || event.batch_number);
  const productCode = normalizeText(event.productCode || event.product_code);
  const materialName = normalizeText(event.materialName || event.material_name);
  const supplierModel = normalizeText(event.supplierModel || event.supplier_model);
  const category = normalizeText(event.category);
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(event.pageSize) || 20));

  if (!batchNumber) {
    return { success: true, list: [], total: 0, page, pageSize, isEnd: true };
  }

  const conditions = [
    { status: 'in_stock' },
    { batch_number: batchNumber }
  ];
  if (productCode && productCode !== '无产品代码') {
    conditions.push({ product_code: productCode });
  } else if (materialName) {
    conditions.push({ material_name: materialName });
  }
  if (category) {
    conditions.push({ category });
  }
  if (supplierModel) {
    conditions.push({ supplier_model: supplierModel });
  }

  const where = conditions.length === 1 ? conditions[0] : _.and(conditions);
  const totalRes = await db.collection('inventory').where(where).count();
  const res = await db.collection('inventory')
    .where(where)
    .orderBy('expiry_date', 'asc')
    .orderBy('create_time', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const productCodes = Array.from(new Set((res.data || []).map(item => item.product_code).filter(Boolean)));
  const materialMap = new Map();
  if (productCodes.length > 0) {
    const materialRes = await db.collection('materials')
      .where({ product_code: _.in(productCodes) })
      .get();
    (materialRes.data || []).forEach((material) => {
      if (material.product_code) {
        materialMap.set(material.product_code, material);
      }
    });
  }

  return {
    success: true,
    list: res.data || [],
    materials: Array.from(materialMap.values()),
    total: Number(totalRes.total) || 0,
    page,
    pageSize,
    isEnd: page * pageSize >= (Number(totalRes.total) || 0)
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = normalizeText(event.action || 'detail');

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看库存信息');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    if (action === 'detail') {
      return await getDetail(event);
    }
    if (action === 'checkLabel') {
      return await checkLabel(event);
    }
    if (action === 'getByUniqueCode') {
      return await getByUniqueCode(event);
    }
    if (action === 'batchLabels') {
      return await getBatchLabels(event);
    }

    return { success: false, msg: '未知操作' };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message || '读取库存信息失败'
    };
  }
};
