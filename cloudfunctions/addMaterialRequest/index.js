// cloudfunctions/addMaterialRequest/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
      product_code,
      category,
      material_name,
      sub_category,
      supplier,
      suggested_sub_category // "其他" 填写的建议
  } = event;

  // 1. 必填校验
  if (!product_code || !category || !material_name) {
    return { success: false, msg: '缺少必填信息' };
  }

  try {
    // 2. 查重：是否已有该代码的待审批申请
    const existing = await db.collection('material_requests')
      .where({
        product_code: product_code,
        status: 'pending'
      })
      .count();

    if (existing.total > 0) {
      return { success: false, msg: '该代码已有待审批的申请，请勿重复提交' };
    }

    // 3. 查重：是否已存在于主数据 (Double Check)
    const activeMaterial = await db.collection('materials')
      .where({ product_code: product_code })
      .count();

    if (activeMaterial.total > 0) {
        return { success: false, msg: '该代码已存在于标准库，无需申请' };
    }

    // 4. 写入申请表
    await db.collection('material_requests').add({
      data: {
        product_code,
        category,
        material_name,
        sub_category,
        suggested_sub_category: suggested_sub_category || '',
        supplier: supplier || '',
        status: 'pending', // pending | approved | rejected
        applicant: OPENID,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });

    return { success: true, msg: '申请已提交，请等待管理员审核' };

  } catch (err) {
    console.error('Submit Request Fail:', err);
    return { success: false, msg: '提交失败: ' + err.message };
  }
};
