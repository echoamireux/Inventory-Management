const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateDashboardStatsFromItems
} = require('../cloudfunctions/_shared/dashboard-stats');

test('dashboard stats count unique products and risky products correctly', () => {
  const now = Date.now();
  const alertConfig = {
    EXPIRY_DAYS: 30,
    LOW_STOCK: {
      chemical: 5,
      film: 20
    }
  };
  const items = [
    {
      product_code: 'J-001',
      category: 'chemical',
      quantity: { val: 3 }
    },
    {
      product_code: 'J-001',
      category: 'chemical',
      quantity: { val: 10 }
    },
    {
      product_code: 'M-001',
      category: 'film',
      dynamic_attrs: { current_length_m: 100 },
      expiry_date: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      product_code: 'M-002',
      category: 'film',
      dynamic_attrs: { current_length_m: 200 }
    }
  ];

  assert.deepEqual(calculateDashboardStatsFromItems(items, alertConfig), {
    totalMaterials: 3,
    lowStock: 1,
    riskCount: 1
  });
});
