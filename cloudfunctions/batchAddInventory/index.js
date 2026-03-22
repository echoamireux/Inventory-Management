// cloudfunctions/batchAddInventory/index.js
const cloud = require('wx-server-sdk');
const { assertUniqueCodes, buildBatchInventoryPayload } = require('./batch-add');
const {
  ensureBuiltinZones,
  sortZoneRecords,
  filterZoneRecordsByCategory,
  buildZoneMap,
  buildInventoryLocationPayload
} = require('./warehouse-zones');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { items, operator_name } = event;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, msg: '未提供待入库数据' };
  }

  try {
    assertUniqueCodes(items);

    const materialIds = Array.from(new Set(
      items.map(item => item && item.material_id).filter(Boolean)
    ));

    if (materialIds.length !== items.length && items.some(item => !item || !item.material_id)) {
      return { success: false, msg: '存在缺少物料主数据标识的入库项' };
    }

    const materialRes = await db.collection('materials')
      .where({ _id: _.in(materialIds) })
      .get();
    const materialMap = new Map((materialRes.data || []).map(item => [item._id, item]));
    const zoneRecords = sortZoneRecords(await ensureBuiltinZones(db));
    const zoneMaps = {
      chemical: buildZoneMap(filterZoneRecordsByCategory(zoneRecords, 'chemical')),
      film: buildZoneMap(filterZoneRecordsByCategory(zoneRecords, 'film'))
    };

    const preparedItems = items.map((item, index) => {
      const prepared = buildBatchInventoryPayload(item, materialMap.get(item.material_id), index);
      const category = prepared.inventoryData.category === 'film' ? 'film' : 'chemical';
      const locationPayload = buildInventoryLocationPayload({
        zoneKey: item && item.zone_key,
        locationDetail: item && item.location_detail
      }, zoneMaps[category]);

      prepared.inventoryData = Object.assign({}, prepared.inventoryData, locationPayload);
      return prepared;
    });

    return await db.runTransaction(async transaction => {
      const ids = [];

      for (let i = 0; i < preparedItems.length; i += 1) {
        const prepared = preparedItems[i];
        const inventoryData = Object.assign({}, prepared.inventoryData, {
          create_time: db.serverDate(),
          update_time: db.serverDate()
        });

        if (prepared.masterSpecBackfill && Object.keys(prepared.masterSpecBackfill).length > 0) {
          const materialUpdateData = {
            updated_by: OPENID,
            updated_at: db.serverDate()
          };

          if (prepared.masterSpecBackfill.thickness_um !== undefined) {
            materialUpdateData['specs.thickness_um'] = prepared.masterSpecBackfill.thickness_um;
          }
          if (prepared.masterSpecBackfill.standard_width_mm !== undefined) {
            materialUpdateData['specs.standard_width_mm'] = prepared.masterSpecBackfill.standard_width_mm;
          }

          await transaction.collection('materials').doc(inventoryData.material_id).update({
            data: materialUpdateData
          });
        }

        const exist = await transaction.collection('inventory').where({
          unique_code: inventoryData.unique_code
        }).get();
        if (exist.data && exist.data.length > 0) {
          throw new Error(`冲突：标签号 ${inventoryData.unique_code} 已存在，批量操作已回滚`);
        }

        const addRes = await transaction.collection('inventory').add({
          data: inventoryData
        });

        await transaction.collection('inventory_log').add({
          data: Object.assign({}, prepared.logData, {
            inventory_id: addRes._id,
            operator: operator_name || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate()
          })
        });

        ids.push(addRes._id);
      }

      return {
        success: true,
        total: ids.length,
        ids
      };
    });
  } catch (err) {
    console.error(err);
    return { success: false, msg: err.message };
  }
};
