const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStableExportSort,
  sortExportRows,
  paginateSortedRows
} = require('../cloudfunctions/_shared/export-order');

test('export uses stable create_time plus _id sort spec', () => {
  assert.deepEqual(buildStableExportSort(), {
    create_time: -1,
    _id: -1
  });
});

test('export sorting stays stable when create_time is duplicated', () => {
  const rows = [
    { _id: '001', create_time: '2026-03-21T10:00:00.000Z' },
    { _id: '003', create_time: '2026-03-21T10:00:00.000Z' },
    { _id: '002', create_time: '2026-03-21T10:00:00.000Z' },
    { _id: '004', create_time: '2026-03-20T10:00:00.000Z' }
  ];

  assert.deepEqual(
    sortExportRows(rows).map((item) => item._id),
    ['003', '002', '001', '004']
  );
});

test('export pagination over sorted rows does not duplicate or skip boundary items', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    _id: String(index + 1).padStart(3, '0'),
    create_time: index < 4 ? '2026-03-21T10:00:00.000Z' : '2026-03-20T10:00:00.000Z'
  }));

  const pages = paginateSortedRows(sortExportRows(rows), 3);
  assert.deepEqual(
    pages.flat().map((item) => item._id),
    ['004', '003', '002', '001', '008', '007', '006', '005']
  );
});
