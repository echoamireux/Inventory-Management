// cloudfunctions/searchInventory/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { keyword, type } = event;

  if (!keyword) {
    return { success: false, msg: 'Keyword is required' };
  }

  try {
    if (type === 'suggestion') {
        // Search in MATERIALS collection for templates
        // Match product_code OR name
        const res = await db.collection('materials').where(_.or([
            {
                product_code: db.RegExp({
                    regexp: keyword,
                    options: 'i'
                })
            },
            {
                name: db.RegExp({
                    regexp: keyword,
                    options: 'i'
                })
            }
        ]))
        .limit(10)
        .get();

        return {
            success: true,
            list: res.data
        };
    }

    // Default: Search in Inventory (Real Stock)
    // ... (Existing logic if any, or implement generic search)
    return { success: false, msg: 'Unknown search type' };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
