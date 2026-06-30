const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMovePageAccessState,
  canManageZones
} = require('../miniprogram/utils/move-page-access');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('move page waits when user info is not ready yet', () => {
  assert.equal(getMovePageAccessState(null), 'wait');
  assert.equal(getMovePageAccessState(undefined), 'wait');
});

test('move page only allows active users after user info is ready', () => {
  assert.equal(getMovePageAccessState({ role: 'user', status: 'active' }), 'allow');
  assert.equal(getMovePageAccessState({ role: 'admin', status: 'active' }), 'allow');
  assert.equal(getMovePageAccessState({ role: 'user', status: 'pending' }), 'deny');
  assert.equal(getMovePageAccessState({ role: 'user', status: 'disabled' }), 'deny');
});

test('zone management stays admin-only', () => {
  assert.equal(canManageZones({ role: 'user', status: 'active' }), false);
  assert.equal(canManageZones({ role: 'admin', status: 'active' }), true);
  assert.equal(canManageZones({ role: 'super_admin', status: 'active' }), true);
});

test('move page loads active category zones from cloud zone service instead of legacy defaults', () => {
  const pageJs = read('miniprogram/pages/material-edit/index.js');
  const pageWxml = read('miniprogram/pages/material-edit/index.wxml');

  assert.match(pageJs, /listZoneRecords\(category,\s*false\)/);
  assert.match(pageJs, /buildLocationZoneActions\(zoneRecords,\s*this\.data\.canManageZones\)/);
  assert.match(pageJs, /buildLocationPayload\(\s*form\.zone_key,\s*form\.location_detail,\s*buildZoneMap\(zoneRecords\)\s*\)/);
  assert.match(pageWxml, /actions="{{ locationZoneActions }}"/);

  assert.doesNotMatch(pageJs, /实验室1|lab1|zone1|builtin:film:warehouse1|DEFAULT_ZONES|buildLocationZoneState/);
  assert.doesNotMatch(pageWxml, /实验室1|lab1|zone1|builtin:film:warehouse1/);
});
