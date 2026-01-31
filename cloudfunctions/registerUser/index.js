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
      const existingUser = userRes.data[0];
      // 如果用户是被拒绝状态，允许重新提交 (更新资料并重置为 pending)
      if (existingUser.status === 'rejected') {
        await db.collection('users').doc(existingUser._id).update({
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
        mobile: event.mobile || '',
        department: event.department || '',
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
