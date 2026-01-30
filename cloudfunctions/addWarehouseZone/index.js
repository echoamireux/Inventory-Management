const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { name } = event;

  if (!name) {
    return { success: false, msg: 'Zone name is required' };
  }

  try {
    const { OPENID } = cloud.getWXContext();
    // 0. Permission Check
    const userRes = await db.collection('users').where({ _openid: OPENID }).get();
    if (!userRes.data[0] || userRes.data[0].role !== 'admin') {
         return { success: false, msg: 'Permission denied: Admin only' };
    }

    // Check if exists
    const check = await db.collection('warehouse_zones').where({
        name: name
    }).get();

    if (check.data.length > 0) {
        return { success: true, msg: 'Already exists', id: check.data[0]._id };
    }

    // Get count for order
    const countRes = await db.collection('warehouse_zones').count();
    const order = countRes.total + 1;

    const res = await db.collection('warehouse_zones').add({
      data: {
        name: name,
        order: order,
        create_time: db.serverDate()
      }
    });

    return {
      success: true,
      msg: 'Created',
      id: res._id
    };

  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
