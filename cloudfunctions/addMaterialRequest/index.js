// cloudfunctions/addMaterialRequest/index.js
const cloud = require('wx-server-sdk');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategorySelection
} = require('./material-subcategories');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function resolveApplicantName(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).field({ name: true }).get();
    return (res.data && res.data[0] && res.data[0].name) || '';
  } catch (err) {
    return '';
  }
}

async function submitRequest(event, openid) {
  const {
    product_code,
    category,
    material_name,
    subcategory_key,
    sub_category,
    supplier
  } = event;

  if (!product_code || !category || !material_name) {
    return { success: false, msg: '缺少必填信息' };
  }

  const subcategoryRecords = filterSubcategoryRecordsByCategory(
    sortSubcategoryRecords(await ensureBuiltinSubcategories(db)),
    category,
    { includeDisabled: true }
  );
  const subcategoryMap = buildSubcategoryMap(subcategoryRecords);
  const resolvedSubcategory = resolveSubcategorySelection({
    category,
    subcategory_key,
    sub_category
  }, subcategoryRecords, subcategoryMap);
  if (!resolvedSubcategory.subcategory_key) {
    return { success: false, msg: '请选择有效子类别' };
  }

  const existing = await db.collection('material_requests')
    .where({
      product_code,
      status: 'pending'
    })
    .count();

  if (existing.total > 0) {
    return { success: false, msg: '该代码已有待审批的申请，请勿重复提交' };
  }

  const activeMaterial = await db.collection('materials')
    .where({ product_code })
    .count();

  if (activeMaterial.total > 0) {
    return { success: false, msg: '该代码已存在于标准库，无需申请' };
  }

  const applicant_name = await resolveApplicantName(openid);
  await db.collection('material_requests').add({
    data: {
      product_code,
      category,
      material_name,
      subcategory_key: resolvedSubcategory.subcategory_key,
      sub_category: resolvedSubcategory.sub_category,
      supplier: supplier || '',
      status: 'pending',
      applicant: openid,
      applicant_name: applicant_name || '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return { success: true, msg: '申请已提交，请等待管理员审核' };
}

async function listMine(openid) {
  const res = await db.collection('material_requests')
    .where(_.or([
      { applicant: openid },
      { _openid: openid }
    ]))
    .orderBy('created_at', 'desc')
    .get();

  return {
    success: true,
    list: res.data || []
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : 'submit';

  try {
    if (action === 'listMine') {
      return await listMine(OPENID);
    }

    if (action === 'submit') {
      return await submitRequest(event, OPENID);
    }

    return { success: false, msg: '未知操作类型' };
  } catch (err) {
    console.error('Material Request Error:', err);
    return { success: false, msg: '提交失败: ' + err.message };
  }
};
