function buildStableExportSort() {
  return {
    create_time: -1,
    _id: -1
  };
}

function compareExportRows(a, b) {
  const timeA = a && a.create_time ? new Date(a.create_time).getTime() : 0;
  const timeB = b && b.create_time ? new Date(b.create_time).getTime() : 0;

  if (timeA !== timeB) {
    return timeB - timeA;
  }

  return String((b && b._id) || '').localeCompare(String((a && a._id) || ''));
}

function sortExportRows(rows) {
  return [...(rows || [])].sort(compareExportRows);
}

function paginateSortedRows(rows, pageSize) {
  const size = Math.max(1, Number(pageSize) || 500);
  const pages = [];

  for (let i = 0; i < rows.length; i += size) {
    pages.push(rows.slice(i, i + size));
  }

  return pages;
}

module.exports = {
  buildStableExportSort,
  compareExportRows,
  sortExportRows,
  paginateSortedRows
};
