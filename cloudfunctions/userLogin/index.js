const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    // 1. Check if user exists
    const userRes = await db.collection('users').where({
      _openid: OPENID
    }).get();

    if (userRes.data.length > 0) {
      // User exists, return info
      return {
        registered: true,
        user: userRes.data[0]
      };
    } else {
      // User not found
      // Check if it's the very first user (to be auto-admin)
      // Note: This check is for informational purpose for the frontend to know "what will happen"
      // or we can verify this again during registration.
      // But userLogin is mainly for "check status". If not registered, return registered: false.

      // Wait, the requirement says userLogin should handle the logic.
      // But usually login is read-only. Registration is write.
      // Let's stick to the plan:
      // userLogin returns user info if exists.
      // If NOT exists, frontend redirects to register page.

      // Wait, the prompt said: "modify or create a cloud function userLogin... logic: get openid -> query users -> ... return complete info".
      // It implies this is a "check status" function.

      return {
        registered: false,
        openid: OPENID // Frontend might need this for debugging or pre-filling
      };
    }

  } catch (err) {
    console.error(err);
    return { error: err.message };
  }
};
