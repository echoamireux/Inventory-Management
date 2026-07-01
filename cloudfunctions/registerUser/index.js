const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function buildUserDocId(openid) {
  return `user_${crypto.createHash('sha1').update(String(openid || '')).digest('hex')}`;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { name } = event;

  if (!name) {
    return { success: false, msg: 'Name is required' };
  }

  try {
    return await db.runTransaction(async transaction => {
      const userRes = await transaction.collection('users').where({
        _openid: OPENID
      }).get();

      if (userRes.data.length > 0) {
        const existingUser = userRes.data[0];
        // 如果用户是被拒绝状态，允许重新提交
        if (existingUser.status === 'rejected') {
          await transaction.collection('users').doc(existingUser._id).update({
            data: {
              name: name,
              mobile: event.mobile || '',
              department: event.department || '',
              status: 'pending',
              update_time: db.serverDate()
            }
          });
          return { success: true, msg: 'Re-submitted successfully', role: existingUser.role, userId: existingUser._id };
        }
        return { success: true, msg: 'User already exists', user: existingUser };
      }

      const userId = buildUserDocId(OPENID);
      await transaction.collection('users').doc(userId).set({
        data: {
          _openid: OPENID,
          name: name,
          mobile: event.mobile || '',
          department: event.department || '',
          role: 'user',
          status: 'pending',
          create_time: db.serverDate()
        }
      });

      return { success: true, role: 'user', userId };
    });

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
