const test = require('node:test');
const assert = require('node:assert/strict');

const frontendUnits = require('../miniprogram/utils/material-units');
const backendUnits = require('../cloudfunctions/_shared/material-units');

const implementations = [
  ['frontend', frontendUnits],
  ['backend', backendUnits]
];

for (const [label, units] of implementations) {
  test(`${label}: category-specific unit lists stay strict`, () => {
    assert.deepEqual(units.CHEMICAL_UNITS, ['kg', 'g', 'L', 'mL']);
    assert.deepEqual(units.FILM_UNITS, ['m', 'm²']);
    assert.deepEqual(units.getAllowedUnits('chemical'), ['kg', 'g', 'L', 'mL']);
    assert.deepEqual(units.getAllowedUnits('film'), ['m', 'm²']);
    assert.equal(units.getDefaultUnit('chemical'), 'kg');
    assert.equal(units.getDefaultUnit('film'), 'm');
    assert.equal(units.isAllowedUnit('chemical', 'm'), false);
    assert.equal(units.isAllowedUnit('film', 'kg'), false);
  });

  test(`${label}: invalid historical unit is preserved for display instead of silently replacing it`, () => {
    const state = units.buildUnitFieldState('film', '卷');
    assert.deepEqual(state.options, ['m', 'm²']);
    assert.equal(state.value, '卷');
    assert.equal(state.selectedIndex, 0);
    assert.equal(state.isCurrentUnitValid, false);
  });

  test(`${label}: empty unit falls back to category default while invalid cross-category units are rejected`, () => {
    assert.deepEqual(units.normalizeUnitInput('chemical', ''), {
      ok: true,
      unit: 'kg'
    });
    assert.deepEqual(units.normalizeUnitInput('film', '  '), {
      ok: true,
      unit: 'm'
    });
    assert.deepEqual(units.normalizeUnitInput('film', 'kg'), {
      ok: false,
      msg: '膜材默认单位仅支持 m / m²'
    });
    assert.deepEqual(units.normalizeUnitInput('chemical', 'm'), {
      ok: false,
      msg: '化材默认单位仅支持 kg / g / L / mL'
    });
  });
}
