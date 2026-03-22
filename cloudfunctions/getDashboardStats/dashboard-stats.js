function calculateDashboardStatsFromItems(items, alertConfig) {
  const uniqueMaterials = new Set();
  const riskyProducts = new Set();
  const futureTime = Date.now() + (alertConfig.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  for (const item of items || []) {
    const productCode = item.product_code || 'UNKNOWN';
    uniqueMaterials.add(productCode);

    let isRisky = false;
    let expiry = null;

    if (item.expiry_date) {
      expiry = new Date(item.expiry_date);
    } else if (item.dynamic_attrs && item.dynamic_attrs.expiry_date) {
      expiry = new Date(item.dynamic_attrs.expiry_date);
    }

    if (expiry && !isNaN(expiry.getTime()) && expiry.getTime() <= futureTime) {
      isRisky = true;
    }

    if (!isRisky) {
      if (item.category === 'chemical') {
        const qty = Number(item.quantity && item.quantity.val) || 0;
        if (qty <= alertConfig.LOW_STOCK.chemical) isRisky = true;
      } else if (item.category === 'film') {
        const len = Number(item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
        if (len <= alertConfig.LOW_STOCK.film) isRisky = true;
      }
    }

    if (isRisky) {
      riskyProducts.add(productCode);
    }
  }

  return {
    totalMaterials: uniqueMaterials.size,
    lowStock: riskyProducts.size
  };
}

module.exports = {
  calculateDashboardStatsFromItems
};
