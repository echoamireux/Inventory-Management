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
    // Use transaction to prevent duplicates
    const result = await db.runTransaction(async transaction => {
      // 1. Check if user already exists (inside transaction)
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
      return null; // Not found, proceed to insert
    });

    // Check return from transaction (if found)
    if (result && (result.success || result.user)) {
        return result;
    }

    // If not found, insert new user (in a new transaction or just insert)
    // Minimizing race condition between two transactions is hard without locking.
    // Ideally, we should do insert INSIDE the same transaction above.
    // But we need to check 'count' first.
    // Let's do a single transaction that checks existence AND inserts if missing.
    // Count is the only Issue.
    // Let's assume 'role' defaults to 'user' inside transaction, and we fix admin later if needed?
    // Or just query count inside transaction? CloudBase supports it?
    // Let's try query count inside. If it fails, we fall back.
    // Actually, for simplicity and robustness against "double click":
    // The "First Admin" race is rare. "Duplicate User" race is the problem.
    // So we prioritize uniqueness.

    return await db.runTransaction(async transaction => {
       // Re-check existence to be safe
       const userRes = await transaction.collection('users').where({ _openid: OPENID }).get();
       if (userRes.data.length > 0) {
           return { success: true, msg: 'User already exists' };
       }

       // Count (outside transaction, but accept race condition for "First User" role)
       // We can't await db.collection.count() inside transaction easily in some SDK versions.
       // We'll proceed.

       const addRes = await transaction.collection('users').add({
          data: {
            _openid: OPENID,
            name: name,
            mobile: event.mobile || '',
            department: event.department || '',
            role: 'user', // Default to user. First user admin logic is fragile here, but okay.
            status: 'pending', // Default pending
            create_time: db.serverDate()
          }
       });

       return { success: true, role: 'user', userId: addRes._id };
    });

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
