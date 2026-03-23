function calculateDashboardStatsFromItems(items, alertConfig) {
  const grouped = new Map();
  const futureTime = Date.now() + (alertConfig.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  for (const item of items || []) {
    const productCode = item.product_code || 'UNKNOWN';
    if (!grouped.has(productCode)) {
      grouped.set(productCode, {
        category: item.category,
        earliestExpiryTime: Number.POSITIVE_INFINITY,
        totalChemicalQty: 0,
        totalFilmLength: 0
      });
    }

    const current = grouped.get(productCode);
    if (!current.category && item.category) {
      current.category = item.category;
    }

    const rawExpiry = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);
    if (rawExpiry) {
      const expiryTime = new Date(rawExpiry).getTime();
      if (!Number.isNaN(expiryTime)) {
        current.earliestExpiryTime = Math.min(current.earliestExpiryTime, expiryTime);
      }
    }

    if (item.category === 'film') {
      current.totalFilmLength += Number(item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
    } else {
      current.totalChemicalQty += Number(item.quantity && item.quantity.val) || 0;
    }
  }

  let riskCount = 0;
  grouped.forEach((item) => {
    const hasExplicitExpiry = Number.isFinite(item.earliestExpiryTime);
    const isExpiring = hasExplicitExpiry && item.earliestExpiryTime <= futureTime;
    const isLowStock = item.category === 'film'
      ? item.totalFilmLength <= alertConfig.LOW_STOCK.film
      : item.totalChemicalQty <= alertConfig.LOW_STOCK.chemical;

    if (isExpiring || isLowStock) {
      riskCount += 1;
    }
  });

  return {
    totalMaterials: grouped.size,
    lowStock: riskCount,
    riskCount
  };
}

module.exports = {
  calculateDashboardStatsFromItems
};
