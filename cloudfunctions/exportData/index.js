// cloudfunctions/exportData/index.js
const cloud = require('wx-server-sdk');
const { buildStableExportSort } = require('./export-order');
const {
  ensureBuiltinZones,
  ensureBuiltinLocationDetails,
  sortZoneRecords,
  buildZoneMap,
  buildLocationDetailMapByZone
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
const { buildContainsRegExp } = require('./search');
const { assertActiveUserAccess } = require('./auth');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { searchVal, category } = event;

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可导出库存报表');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    const dbCmd = db.command;
    let match = {};

    // 1. Filter Logic
    if (category) {
        match.category = category;
    }

    const searchRegex = buildContainsRegExp(db, searchVal);
    if (searchRegex) {
        match.$or = [
            { material_name: searchRegex },
            { product_code: searchRegex },
            { unique_code: searchRegex },
            { batch_number: searchRegex },
            { supplier: searchRegex },
            { supplier_model: searchRegex },
            { location: searchRegex },
            { location_text: searchRegex }
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
    const detailRecords = await ensureBuiltinLocationDetails(db, zoneRecords);
    const zoneMap = buildZoneMap(zoneRecords);
    const detailMapByZone = buildLocationDetailMapByZone(detailRecords, { includeDisabled: true });
    const subcategoryRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

    const rows = dataList.map((item) => buildInventoryExportRow(item, {
      material: (item.material_info && item.material_info[0]) || {},
      zoneMap,
      detailMapByZone,
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
      fileName: buildInventoryExportFileName(exportedAt),
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
