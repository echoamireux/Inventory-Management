// cloudfunctions/getInventoryGrouped/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

exports.main = async (event, context) => {
  const { searchVal, category } = event;

  try {
    // 1. Build Match Stage (Filter)
    let matchStage = {
      status: 'in_stock'
    };

    if (category === 'chemical') matchStage.category = 'chemical';
    if (category === 'film') matchStage.category = 'film';

    if (searchVal) {
      // Fuzzy search across multiple fields
      matchStage = _.or([
        { material_name: db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' }) },
        { product_code: db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' }) },
        { batch_number: db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' }) },
        { unique_code: db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' }) }
      ]);
      // Note: If using _.or with other fields, we need to wrap properly.
      // But currently aggregate $match doesn't support advanced query operators like _.or as easily as collection.where().
      // Correction: $match uses standard query selectors. db.RegExp works.
      // However, typical aggregation $match usually takes a single object.
      // The logic above with _.or inside a match object might be tricky.
      // Simplification: Let's use collection where if possible, but here we need aggregate.
      // Let's stick to standard Mongo query syntax for $match if possible, or simple object.
      // To keep it robust, let's use a simpler match if searchVal is present.
    }

    // For safer regex match in aggregate, we often pass regex objects directly.
    let matchObj = { status: 'in_stock' };
    if (category) matchObj.category = category;

    // If search exists, we mix it in.
    // Since 'where' style logic is complex in simple match object, we might need multiple match or $or operator.
    // { $match: { $or: [ ... ] } }
    if (searchVal) {
        const regex = db.RegExp({ regexp: '.*' + searchVal + '.*', options: 'i' });
        matchObj = {
            ...matchObj,
            $or: [
                { material_name: regex },
                { product_code: regex },
                { batch_number: regex },
                { supplier: regex }, // Added Supplier
                { unique_code: regex } // Added Unique Code just in case
            ]
        };
    }

    // 2. Build Pipeline
    const result = await db.collection('inventory').aggregate()
      .match(matchObj)
      .group({
        // Group by product_code. If missing, fallback to name.
        _id: {
            code: '$product_code',
            name: '$material_name',
            category: '$category'
        },
        // Aggregate Data
        totalQuantity: $.sum('$quantity.val'),
        totalCount: $.sum(1),
        minExpiry: $.min('$expiry_date'),
        locations: $.addToSet('$location'), // Unique locations
        // Basic Info (Should be same for group)
        unit: $.first('$quantity.unit'),
        sub_category: $.first('$sub_category')
      })
      .sort({
          minExpiry: 1, // Prioritize expiring items
          '_id.code': 1
      })
      .limit(50)
      .end();

    // 3. Format Output
    const list = result.list.map(item => {
        return {
            product_code: item._id.code || '无代码',
            material_name: item._id.name,
            category: item._id.category,
            sub_category: item.sub_category,
            totalQuantity: parseFloat(item.totalQuantity.toFixed(2)),
            totalCount: item.totalCount,
            unit: item.unit,
            minExpiry: item.minExpiry,
            locations: item.locations,
            // Calculate status
            isExpiring: checkExpiring(item.minExpiry, item._id.category)
        };
    });

    return { success: true, list };

  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};

function checkExpiring(dateStr, category) {
    if (category !== 'chemical' || !dateStr) return false;
    const now = new Date();
    const target = new Date(dateStr);
    const diff = target - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days <= 30;
}
