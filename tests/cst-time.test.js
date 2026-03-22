const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCstDayStart,
  getCstRange
} = require('../cloudfunctions/_shared/cst-time');

test('cst day start is stable regardless of UTC offset of input date', () => {
  const now = new Date('2026-03-21T05:30:00.000Z');
  assert.equal(getCstDayStart(now).toISOString(), '2026-03-20T16:00:00.000Z');
});

test('cst week and month range start align to UTC+8 calendar', () => {
  const now = new Date('2026-03-21T05:30:00.000Z');

  assert.equal(getCstRange('week', now).start.toISOString(), '2026-03-14T16:00:00.000Z');
  assert.equal(getCstRange('month', now).start.toISOString(), '2026-02-28T16:00:00.000Z');
});
