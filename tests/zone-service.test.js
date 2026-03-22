const test = require('node:test');
const assert = require('node:assert/strict');

function loadZoneServiceWithWx(wxStub) {
  global.wx = wxStub;
  delete require.cache[require.resolve('../miniprogram/utils/zone-service')];
  return require('../miniprogram/utils/zone-service');
}

test('listZoneRecords returns the current zone list from the deployed cloud function', async () => {
  const { listZoneRecords } = loadZoneServiceWithWx({
    cloud: {
      callFunction: async () => ({
        result: {
          success: true,
          list: [{ zone_key: 'builtin:chemical:lab1', name: '实验室1' }]
        }
      })
    }
  });

  await assert.doesNotReject(async () => {
    const list = await listZoneRecords('chemical', false);
    assert.deepEqual(list, [{ zone_key: 'builtin:chemical:lab1', name: '实验室1' }]);
  });
});

test('listZoneRecords surfaces a deploy hint when the old zone cloud function is still running', async () => {
  const { listZoneRecords } = loadZoneServiceWithWx({
    cloud: {
      callFunction: async () => ({
        result: {
          success: false,
          msg: 'Zone name is required'
        }
      })
    }
  });

  await assert.rejects(
    () => listZoneRecords('chemical', false),
    /当前云函数版本过旧，请部署最新版 addWarehouseZone/
  );
});
