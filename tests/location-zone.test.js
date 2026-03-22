const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLocationZoneActions,
  mergeLocationZones,
  buildLocationZoneState,
  buildZoneMap,
  buildLocationPayload,
  resolveInventoryLocation,
  extractLocationSelection
} = require('../miniprogram/utils/location-zone');

test('zone action list only exposes create entry to zone admins', () => {
  const zones = ['实验室1', '实验室2'];

  assert.deepEqual(buildLocationZoneActions(zones, false), [
    { name: '实验室1' },
    { name: '实验室2' }
  ]);

  assert.deepEqual(buildLocationZoneActions(zones, true), [
    { name: '实验室1' },
    { name: '实验室2' }
  ]);
});

test('location zones merge category defaults with shared zones without duplicates', () => {
  const defaults = {
    chemical: ['实验室1', '实验室2', '物料间'],
    film: ['研发仓1', '研发仓2', '实验线']
  };

  assert.deepEqual(
    mergeLocationZones('chemical', defaults, ['实验室2', '暂存区', '物料间', '其他']),
    ['实验室1', '实验室2', '物料间', '暂存区', '其他']
  );

  assert.deepEqual(
    mergeLocationZones('film', defaults, ['实验线', '膜材立库', '暂存区']),
    ['研发仓1', '研发仓2', '实验线', '膜材立库', '暂存区']
  );
});

test('location zone state stays consistent across pages for both categories', () => {
  const defaults = {
    chemical: ['实验室1', '实验室2', '物料间'],
    film: ['研发仓1', '研发仓2', '实验线']
  };
  const sharedZones = ['公共暂存', '研发仓2'];

  assert.deepEqual(
    buildLocationZoneState('chemical', defaults, sharedZones, false),
    {
      zones: ['实验室1', '实验室2', '物料间', '公共暂存', '研发仓2'],
      actions: [
        { name: '实验室1' },
        { name: '实验室2' },
        { name: '物料间' },
        { name: '公共暂存' },
        { name: '研发仓2' }
      ]
    }
  );

  assert.deepEqual(
    buildLocationZoneState('film', defaults, sharedZones, true),
    {
      zones: ['研发仓1', '研发仓2', '实验线', '公共暂存'],
      actions: [
        { name: '研发仓1' },
        { name: '研发仓2' },
        { name: '实验线' },
        { name: '公共暂存' }
      ]
    }
  );
});

test('zone-key payload keeps stable reference while display text follows current zone name', () => {
  const originalZoneMap = buildZoneMap([
    { zone_key: 'builtin:chemical:lab1', name: '实验室1' }
  ]);

  assert.deepEqual(
    buildLocationPayload('builtin:chemical:lab1', 'A-01', originalZoneMap),
    {
      zone_key: 'builtin:chemical:lab1',
      location_detail: 'A-01',
      location_text: '实验室1 | A-01',
      location: '实验室1 | A-01'
    }
  );

  const renamedZoneMap = buildZoneMap([
    { zone_key: 'builtin:chemical:lab1', name: '实验室一号' }
  ]);

  assert.equal(
    resolveInventoryLocation({
      zone_key: 'builtin:chemical:lab1',
      location_detail: 'A-01',
      location: '实验室1 | A-01'
    }, renamedZoneMap),
    '实验室一号 | A-01'
  );
});

test('location selection extraction only trusts structured zone fields', () => {
  const zoneMap = buildZoneMap([
    { zone_key: 'global:safe-cabinet', name: '防爆柜' }
  ]);

  assert.deepEqual(
    extractLocationSelection({
      zone_key: 'global:safe-cabinet',
      location_detail: 'B-02',
      location: '旧区域 | B-02'
    }, zoneMap),
    {
      zone_key: 'global:safe-cabinet',
      location_zone: '防爆柜',
      location_detail: 'B-02'
    }
  );

  assert.deepEqual(
    extractLocationSelection({
      location_text: '物料间 | C-03'
    }, zoneMap),
    {
      zone_key: '',
      location_zone: '',
      location_detail: ''
    }
  );
});

test('inventory location display no longer parses legacy location text when structured data is missing', () => {
  const zoneMap = buildZoneMap([
    { zone_key: 'builtin:chemical:lab1', name: '实验室1' }
  ]);

  assert.equal(
    resolveInventoryLocation({
      location_text: '实验室1 | A-01'
    }, zoneMap),
    '实验室1 | A-01'
  );

  assert.equal(
    resolveInventoryLocation({
      location: '旧区域 | B-02'
    }, zoneMap),
    ''
  );
});
