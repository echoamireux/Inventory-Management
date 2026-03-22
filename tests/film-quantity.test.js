const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeFilmUnit,
  getFilmDisplayQuantityFromBaseLength,
  buildFilmInventoryState,
  getFilmDisplayState,
  summarizeFilmDisplayQuantities
} = require('../cloudfunctions/_shared/film-quantity');

test('film units normalize to canonical forms', () => {
  assert.equal(normalizeFilmUnit('米'), 'm');
  assert.equal(normalizeFilmUnit('m2'), 'm²');
  assert.equal(normalizeFilmUnit('卷装'), '卷');
});

test('base meter inventory converts to square meters and rolls', () => {
  assert.equal(getFilmDisplayQuantityFromBaseLength(100, 'm²', 500, 100), 50);
  assert.equal(getFilmDisplayQuantityFromBaseLength(200, '卷', 500, 100), 2);
  assert.equal(getFilmDisplayQuantityFromBaseLength(123.456, 'm', 500, 100), 123.46);
});

test('film inventory state keeps base truth and display layer aligned', () => {
  const state = buildFilmInventoryState(80, 'm²', 1000, 80);

  assert.deepEqual(state, {
    quantityVal: 80,
    quantityUnit: 'm²',
    currentLengthM: 80,
    initialLengthM: 80
  });
});

test('display state prefers dynamic base length and material display unit', () => {
  const state = getFilmDisplayState({
    quantity: { unit: '卷' },
    default_unit: '卷',
    dynamic_attrs: {
      current_length_m: 50,
      initial_length_m: 100,
      width_mm: 600
    }
  });

  assert.equal(state.baseLengthM, 50);
  assert.equal(state.displayUnit, '卷');
  assert.equal(state.displayQuantity, 0.5);
});

test('mixed roll lengths are summed per record instead of using one shared roll length', () => {
  const summary = summarizeFilmDisplayQuantities([
    {
      quantity: { unit: '卷' },
      dynamic_attrs: {
        current_length_m: 100,
        initial_length_m: 100,
        width_mm: 500
      }
    },
    {
      quantity: { unit: '卷' },
      dynamic_attrs: {
        current_length_m: 200,
        initial_length_m: 200,
        width_mm: 500
      }
    }
  ], '卷');

  assert.equal(summary.baseLengthM, 300);
  assert.equal(summary.displayQuantity, 2);
  assert.equal(summary.displayUnit, '卷');
});

test('mixed widths still sum square-meter display per record', () => {
  const summary = summarizeFilmDisplayQuantities([
    {
      quantity: { unit: 'm²' },
      dynamic_attrs: {
        current_length_m: 100,
        initial_length_m: 100,
        width_mm: 500
      }
    },
    {
      quantity: { unit: 'm²' },
      dynamic_attrs: {
        current_length_m: 100,
        initial_length_m: 100,
        width_mm: 1000
      }
    }
  ], 'm²');

  assert.equal(summary.displayQuantity, 150);
  assert.equal(summary.displayUnit, 'm²');
});
