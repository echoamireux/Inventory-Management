const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inventoryQuantity = require('../cloudfunctions/_shared/inventory-quantity');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('chemical refill keeps test-material supplier models isolated and requires one unit', () => {
  const existing = {
    category: 'chemical',
    status: 'in_stock',
    product_code: 'J-999',
    batch_number: 'B-001',
    supplier_model: 'MODEL-A',
    is_test_material: true,
    quantity: { val: 1, unit: 'kg' }
  };

  assert.equal(inventoryQuantity.isChemicalRefillEligible(existing, {
    category: 'chemical',
    product_code: 'J-999',
    batch_number: 'B-001',
    supplier_model: 'MODEL-B',
    is_test_material: true,
    quantity: { val: 1, unit: 'kg' }
  }), false);

  assert.equal(inventoryQuantity.isChemicalRefillEligible(existing, {
    category: 'chemical',
    product_code: 'J-999',
    batch_number: 'B-001',
    supplier_model: 'MODEL-A',
    is_test_material: true,
    quantity: { val: 1, unit: 'g' }
  }), false);

  assert.equal(inventoryQuantity.isChemicalRefillEligible(existing, {
    category: 'chemical',
    product_code: 'J-999',
    batch_number: 'B-001',
    supplier_model: 'MODEL-A',
    is_test_material: true,
    quantity: { val: 1, unit: 'kg' }
  }), true);
});

test('formal chemical refill does not use supplier model as identity', () => {
  assert.equal(inventoryQuantity.isChemicalRefillEligible({
    category: 'chemical',
    status: 'in_stock',
    product_code: 'J-001',
    batch_number: 'B-001',
    supplier_model: 'OLD',
    is_test_material: false,
    quantity: { val: 1, unit: 'kg' }
  }, {
    category: 'chemical',
    product_code: 'J-001',
    batch_number: 'B-001',
    supplier_model: 'NEW',
    is_test_material: false,
    quantity: { val: 1, unit: 'kg' }
  }), true);
});

test('chemical quantity helpers reject invalid increments and mixed units', () => {
  assert.throws(
    () => inventoryQuantity.buildChemicalRefillUpdate({ quantity: { val: 1, unit: 'kg' } }, 'abc'),
    /有效正数/
  );
  assert.equal(typeof inventoryQuantity.assertConsistentChemicalUnits, 'function');
  assert.throws(
    () => inventoryQuantity.assertConsistentChemicalUnits([
      { category: 'chemical', quantity: { unit: 'kg' } },
      { category: 'chemical', quantity: { unit: 'g' } }
    ]),
    /单位不一致/
  );
});

test('withdrawal validates finite quantities, test-material model and canonical project data', () => {
  const cloudFunction = read('cloudfunctions/updateInventory/index.js');
  const homePage = read('miniprogram/pages/index/index.js');

  assert.match(cloudFunction, /Number\.isFinite\(totalNeed\)/);
  assert.match(cloudFunction, /supplier_model/);
  assert.match(cloudFunction, /project_codes/);
  assert.match(cloudFunction, /status:\s*'active'/);
  assert.match(homePage, /payload\.supplier_model\s*=\s*withdrawItem\.supplier_model/);
});

test('all inbound paths enforce active master data and the master chemical unit', () => {
  const singleStockIn = read('cloudfunctions/addMaterial/index.js');
  const batchStockIn = read('cloudfunctions/batchAddInventory/index.js');
  const templateStockIn = read('cloudfunctions/importInventoryTemplate/index.js');
  const batchPayload = read('cloudfunctions/_shared/batch-add.js');
  const templatePayload = read('cloudfunctions/importInventoryTemplate/inventory-import.js');

  for (const source of [singleStockIn, batchStockIn, templateStockIn]) {
    assert.match(source, /status[^\n]{0,80}active|active[^\n]{0,80}status/);
  }
  assert.match(singleStockIn, /materialRecord\.default_unit/);
  assert.match(batchPayload, /material\.default_unit/);
  assert.match(templatePayload, /material\.default_unit/);
});

test('material unit and archive mutations are blocked after inventory exists', () => {
  const source = read('cloudfunctions/manageMaterial/index.js');

  assert.match(source, /default_unit[\s\S]{0,1200}inventory/);
  assert.match(source, /status:\s*'in_stock'/);
  assert.match(source, /存在在库库存|在库记录/);
});

test('material-wide cascade deletion is disabled and audit operator is server-derived', () => {
  const source = read('cloudfunctions/removeInventory/index.js');

  assert.match(source, /不再支持整物料删除|仅支持按库存标签/);
  assert.doesNotMatch(source, /operator:\s*operator_name/);
});

test('inventory export only reads current stock, enforces a hard cap and uses a stable cloud path', () => {
  const source = read('cloudfunctions/exportData/index.js');

  assert.match(source, /status:\s*'in_stock'/);
  assert.match(source, /10000/);
  assert.match(source, /OPENID/);
  assert.match(source, /cloudPath/);
});

test('inventory risk queries share unit-aware global low-stock thresholds', () => {
  const alertConfig = require('../cloudfunctions/_shared/alert-config');
  const dashboardStats = read('cloudfunctions/_shared/dashboard-stats.js');
  const groupedInventory = read('cloudfunctions/getInventoryGrouped/index.js');
  const syncScript = read('cloudfunctions/sync_shared.sh');

  assert.deepEqual(alertConfig.LOW_STOCK, {
    chemical: {
      mass_g: 50,
      volume_ml: 50
    },
    film: {
      length_m: 50
    }
  });
  assert.match(dashboardStats, /require\(['"]\.\/low-stock['"]\)/);
  assert.match(groupedInventory, /require\(['"]\.\/low-stock['"]\)/);
  assert.match(groupedInventory, /lowStockQuantity:\s*Number\(item\.totalChemicalQty\)/);
  assert.match(groupedInventory, /totalQuantity:\s*item\.lowStockQuantity/);
  assert.match(groupedInventory, /checkLowStock\(\{[\s\S]{0,180}unit/);
  assert.match(syncScript, /_shared\/low-stock\.js/);
  assert.match(syncScript, /getDashboardStats\/low-stock\.js/);
  assert.match(syncScript, /getInventoryGrouped\/low-stock\.js/);
});
