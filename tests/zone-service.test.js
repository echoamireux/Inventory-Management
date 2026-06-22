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
          list: [{ zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' }]
        }
      })
    }
  });

  await assert.doesNotReject(async () => {
    const list = await listZoneRecords('chemical', false);
    assert.deepEqual(list, [{ zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' }]);
  });
});

test('createZone sends the selected scope to the zone cloud function', async () => {
  const calls = [];
  const { createZone } = loadZoneServiceWithWx({
    cloud: {
      callFunction: async (payload) => {
        calls.push(payload);
        return {
          result: {
            success: true,
            zone_key: 'custom-zone'
          }
        };
      }
    }
  });

  await createZone('防爆柜08', 'chemical');

  assert.deepEqual(calls, [
    {
      name: 'addWarehouseZone',
      data: {
        action: 'create',
        name: '防爆柜08',
        scope: 'chemical'
      }
    }
  ]);
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
