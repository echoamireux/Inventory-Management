const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { name } = event;

  if (!name) {
    return { success: false, msg: 'Name is required' };
  }

  try {
    // 1. Check if user already exists
    const userRes = await db.collection('users').where({
      _openid: OPENID
    }).get();

    if (userRes.data.length > 0) {
      return { success: true, msg: 'User already exists', user: userRes.data[0] };
    }

    // 2. Check total user count to determine role
    const countRes = await db.collection('users').count();
    const total = countRes.total;

    const role = total === 0 ? 'admin' : 'user';
    const status = total === 0 ? 'active' : 'pending'; // Auto-activate admin, pending for others

    // 3. Add user
    const addRes = await db.collection('users').add({
      data: {
        _openid: OPENID,
        name: name,
        role: role,
        status: status,
        create_time: db.serverDate()
      }
    });

    return {
      success: true,
      role: role,
      userId: addRes._id
    };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
