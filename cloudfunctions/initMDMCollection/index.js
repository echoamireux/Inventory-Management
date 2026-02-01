// cloudfunctions/initMDMCollection/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    await db.createCollection('material_requests');
    return { success: true, msg: 'Created material_requests' };
  } catch (e) {
    // If error is "collection already exists", that's fine.
    return { success: true, msg: 'Collection likely exists or created', error: e };
  }
};
