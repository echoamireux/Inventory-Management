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

test('listZoneConfig returns zones and managed location details together', async () => {
  const { listZoneConfig } = loadZoneServiceWithWx({
    cloud: {
      callFunction: async () => ({
        result: {
          success: true,
          list: [{ zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' }],
          detail_list: [
            {
              zone_key: 'builtin:chemical:safe-cabinet-01',
              detail_key: 'builtin:chemical:safe-cabinet-01:F1',
              name: 'F1'
            }
          ]
        }
      })
    }
  });

  assert.deepEqual(await listZoneConfig('chemical', false), {
    zones: [{ zone_key: 'builtin:chemical:safe-cabinet-01', name: '防爆柜01' }],
    details: [
      {
        zone_key: 'builtin:chemical:safe-cabinet-01',
        detail_key: 'builtin:chemical:safe-cabinet-01:F1',
        name: 'F1'
      }
    ]
  });
});

test('detail management calls use explicit detail actions', async () => {
  const calls = [];
  const {
    createLocationDetail,
    renameLocationDetail,
    setLocationDetailStatus,
    reorderLocationDetails
  } = loadZoneServiceWithWx({
    cloud: {
      callFunction: async (payload) => {
        calls.push(payload);
        return { result: { success: true } };
      }
    }
  });

  await createLocationDetail('zone-1', 'F6');
  await renameLocationDetail('zone-1:F1', 'A');
  await setLocationDetailStatus('zone-1:F1', 'disabled');
  await reorderLocationDetails('zone-1', ['zone-1:F2', 'zone-1:F1']);

  assert.deepEqual(calls.map(item => item.data), [
    { action: 'createDetail', zone_key: 'zone-1', name: 'F6' },
    { action: 'renameDetail', detail_key: 'zone-1:F1', name: 'A' },
    { action: 'setDetailStatus', detail_key: 'zone-1:F1', status: 'disabled' },
    { action: 'reorderDetails', zone_key: 'zone-1', detail_keys: ['zone-1:F2', 'zone-1:F1'] }
  ]);
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
