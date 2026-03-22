function chunkValues(values, batchSize) {
  const size = Math.max(1, Number(batchSize) || 100);
  const uniqueValues = Array.from(new Set((values || []).filter(Boolean)));
  const chunks = [];

  for (let i = 0; i < uniqueValues.length; i += size) {
    chunks.push(uniqueValues.slice(i, i + size));
  }

  return chunks;
}

async function loadMaterialMapByProductCodes(productCodes, fetchBatch, options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize) || 100);
  const pageSize = Math.max(1, Number(options.pageSize) || 100);
  const batches = chunkValues(productCodes, batchSize);
  const materialMap = new Map();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    let skip = 0;

    while (true) {
      const rows = await fetchBatch({
        productCodes: batch,
        skip,
        limit: pageSize
      });

      const list = rows || [];
      for (let j = 0; j < list.length; j += 1) {
        const row = list[j];
        if (row && row.product_code) {
          materialMap.set(row.product_code, row);
        }
      }

      if (list.length < pageSize) {
        break;
      }

      skip += pageSize;
    }
  }

  return materialMap;
}

module.exports = {
  chunkValues,
  loadMaterialMapByProductCodes
};
