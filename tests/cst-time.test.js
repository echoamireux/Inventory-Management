const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCstDayStart,
  getCstRange,
  parseCstDateBoundary,
  parseCstDateRange
} = require('../cloudfunctions/_shared/cst-time');

test('cst day start is stable regardless of UTC offset of input date', () => {
  const now = new Date('2026-03-21T05:30:00.000Z');
  assert.equal(getCstDayStart(now).toISOString(), '2026-03-20T16:00:00.000Z');
});

test('cst week range starts on Monday and month range aligns to UTC+8 calendar', () => {
  const now = new Date('2026-03-21T05:30:00.000Z');

  assert.equal(getCstRange('week', now).start.toISOString(), '2026-03-15T16:00:00.000Z');
  assert.equal(getCstRange('month', now).start.toISOString(), '2026-02-28T16:00:00.000Z');
});

test('project report date-only filters cover the complete CST calendar day', () => {
  assert.equal(parseCstDateBoundary('2026-07-10').toISOString(), '2026-07-09T16:00:00.000Z');
  assert.equal(parseCstDateBoundary('2026-07-10', true).toISOString(), '2026-07-10T15:59:59.999Z');

  for (const relativePath of [
    '../cloudfunctions/getProjectUsageReport/index.js',
    '../cloudfunctions/exportProjectUsageReport/index.js'
  ]) {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, relativePath), 'utf8');
    assert.match(source, /parseCstDateRange/);
    assert.match(source, /startTime:\s*dateRange\.start[\s\S]*endTime:\s*dateRange\.end/);
  }
});

test('project report date ranges reject invalid or reversed non-empty dates', () => {
  assert.throws(
    () => parseCstDateRange('2026-02-30', '2026-03-01'),
    /开始日期格式无效/
  );
  assert.throws(
    () => parseCstDateRange('2026-07-11', '2026-07-10'),
    /开始日期不能晚于结束日期/
  );

  const range = parseCstDateRange('2026-07-10', '2026-07-10');
  assert.equal(range.start.toISOString(), '2026-07-09T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-10T15:59:59.999Z');
});
