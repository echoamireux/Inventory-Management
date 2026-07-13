const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { material_id, inventory_id } = event;

  if (!inventory_id) {
    return {
      success: false,
      msg: material_id
        ? '不再支持整物料删除，请通过盘点审批按库存标签纠错'
        : '仅支持按库存标签执行纠错'
    };
  }

  try {
    const preAuthRes = await db.collection('users').where({ _openid: OPENID }).get();
    const preAuthResult = assertAdminMutationAccess((preAuthRes.data || [])[0], 'Permission denied: Admin only');
    if (!preAuthResult.ok) {
      throw new Error(preAuthResult.msg);
    }

    return {
      success: false,
      msg: '库存删除入口已停用，请通过盘点纠错审批处理'
    };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
