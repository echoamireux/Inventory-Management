// cloudfunctions/exportData/index.js
const cloud = require('wx-server-sdk');
const { buildStableExportSort } = require('./export-order');
const {
  ensureBuiltinZones,
  sortZoneRecords,
  buildZoneMap,
} = require('./warehouse-zones');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  buildSubcategoryMap
} = require('./material-subcategories');
const {
  buildInventoryExportFileName,
  buildInventoryExportRow,
  buildInventoryExportWorkbook
} = require('./export-report');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { searchVal, category } = event;

  try {
    const dbCmd = db.command;
    let match = {};

    // 1. Filter Logic
    if (category) {
        match.category = category;
    }

    if (searchVal) {
        // Regex Match on Inventory Fields
        match.$or = [
            { material_name: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { product_code: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { unique_code: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { batch_number: db.RegExp({ regexp: searchVal, options: 'i' }) }
        ];
    }

    // 2. 聚合查询 (Join Materials to get Supplier/Model)
    const pageSize = 500;
    let skip = 0;
    let dataList = [];

    while (true) {
      const result = await db.collection('inventory').aggregate()
          .match(match)
          .lookup({
              from: 'materials',
              localField: 'material_id',
              foreignField: '_id',
              as: 'material_info'
          })
          .sort(buildStableExportSort())
          .skip(skip)
          .limit(pageSize)
          .end();

      dataList = dataList.concat(result.list);
      if (result.list.length < pageSize) break;
      skip += pageSize;
    }

    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const zoneMap = buildZoneMap(zoneRecords);
    const subcategoryRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

    const rows = dataList.map((item) => buildInventoryExportRow(item, {
      material: (item.material_info && item.material_info[0]) || {},
      zoneMap,
      subcategoryMap
    }));

    const exportedAt = new Date();
    const workbook = await buildInventoryExportWorkbook({
      exportedAt,
      filters: {
        categoryLabel: category === 'chemical' ? '化材' : (category === 'film' ? '膜材' : ''),
        searchVal: searchVal || ''
      },
      rows
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `exports/${buildInventoryExportFileName(exportedAt)}`;

    const uploadRes = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: buffer,
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      msg: '生成成功'
    };

  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
