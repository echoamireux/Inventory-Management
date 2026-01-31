const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { userId, status } = event;

  // 1. Security Check: Is operator admin?
  const operatorRes = await db.collection('users').where({
    _openid: OPENID
  }).get();

  if (operatorRes.data.length === 0 || operatorRes.data[0].role !== 'admin') {
    return { success: false, msg: 'Permission denied' };
  }

  try {
    await db.collection('users').doc(userId).update({
      data: {
        status: status,
        reject_reason: event.rejectReason || '',
        update_time: db.serverDate()
      }
    });
    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
