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
  assert.equal(inventoryQuantity.parseChemicalQuantity('0.001', '领用数量'), 0.001);
  assert.throws(
    () => inventoryQuantity.parseChemicalQuantity('0.0005', '领用数量'),
    /最多保留三位小数/
  );
  assert.throws(
    () => inventoryQuantity.parseChemicalQuantity('1.2345', '领用数量'),
    /最多保留三位小数/
  );
  assert.equal(inventoryQuantity.parsePositiveIntegerMeters('1', '膜材长度'), 1);
  assert.throws(
    () => inventoryQuantity.parsePositiveIntegerMeters('1.5', '膜材长度'),
    /必须为正整数米/
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

test('template import payload enforces chemical precision and integer film meters', () => {
  const {
    buildInventoryImportPayload
  } = require('../cloudfunctions/importInventoryTemplate/inventory-import');

  assert.throws(
    () => buildInventoryImportPayload({
      rowIndex: 5,
      category: 'chemical',
      unique_code: 'L000801',
      product_code: 'J-001',
      batch_number: 'B001',
      zone_key: 'builtin:chemical:safe-cabinet-01',
      location: '防爆柜01 | F1',
      net_content: '0.0005',
      expiry_date: '2026-12-31'
    }, {
      _id: 'mat-chemical',
      product_code: 'J-001',
      category: 'chemical',
      status: 'active',
      material_name: '化材',
      default_unit: 'kg'
    }),
    /最多保留三位小数/
  );

  assert.throws(
    () => buildInventoryImportPayload({
      rowIndex: 6,
      category: 'film',
      unique_code: 'L000802',
      product_code: 'M-001',
      batch_number: 'B002',
      zone_key: 'builtin:film:research-warehouse-01',
      location: '研发仓1',
      thickness_um: 25,
      batch_width_mm: 500,
      length_m: '1.5',
      expiry_date: '2026-12-31',
      quantity_unit: 'm'
    }, {
      _id: 'mat-film',
      product_code: 'M-001',
      category: 'film',
      status: 'active',
      material_name: '膜材',
      default_unit: 'm',
      specs: {
        thickness_um: 25,
        standard_width_mm: 500
      }
    }),
    /必须为正整数米/
  );
});

test('withdrawal validates finite quantities, test-material model and canonical project data', () => {
  const cloudFunction = read('cloudfunctions/updateInventory/index.js');
  const homePage = read('miniprogram/pages/index/index.js');

  assert.match(cloudFunction, /parseChemicalQuantity/);
  assert.match(cloudFunction, /parsePositiveIntegerMeters/);
  assert.match(cloudFunction, /supplier_model/);
  assert.match(cloudFunction, /project_codes/);
  assert.match(cloudFunction, /status:\s*'active'/);
  assert.doesNotMatch(cloudFunction, /newStock\s*<=\s*0\.1/);
  assert.match(homePage, /payload\.supplier_model\s*=\s*withdrawItem\.supplier_model/);
});

test('stocktake adjustment uses the shared quantity precision rules', () => {
  const editInventory = read('cloudfunctions/editInventory/index.js');

  assert.match(editInventory, /parseChemicalQuantity/);
  assert.match(editInventory, /parsePositiveIntegerMeters/);
  assert.doesNotMatch(editInventory, /const nextBaseQuantity = Number\(updates\.stocktake_quantity\)/);
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

test('single stock-in trusts master category for location validation instead of client category', () => {
  const singleStockIn = read('cloudfunctions/addMaterial/index.js');

  assert.match(singleStockIn, /transaction\.collection\('materials'\)\.where/);
  assert.match(singleStockIn, /filterZoneRecordsByCategory\(zoneRecords,\s*category\)/);
  assert.doesNotMatch(singleStockIn, /filterZoneRecordsByCategory\(zoneRecords,\s*base\.category\)/);
});

test('duplicate chemical labels require an explicit refill action on write APIs', () => {
  const singleStockIn = read('cloudfunctions/addMaterial/index.js');
  const batchStockIn = read('cloudfunctions/batchAddInventory/index.js');
  const templateStockIn = read('cloudfunctions/importInventoryTemplate/index.js');

  assert.match(singleStockIn, /submitAction[\s\S]{0,260}refill/);
  assert.match(singleStockIn, /refill_inventory_id/);
  assert.match(batchStockIn, /submitAction[\s\S]{0,260}refill/);
  assert.match(batchStockIn, /refill_inventory_id/);
  assert.match(templateStockIn, /submitAction\s*===\s*'refill'/);
  assert.match(templateStockIn, /refill_inventory_id/);
});

test('inventory write frontends submit stable operation ids', () => {
  const singleStockInPage = read('miniprogram/pages/material-add/index.js');
  const batchStockInPage = read('miniprogram/pages/material-add/batch-entry.js');
  const templateStockInPage = read('miniprogram/pages/material-add/template-import/index.js');
  const homePage = read('miniprogram/pages/index/index.js');
  const detailPage = read('miniprogram/pages/inventory-detail/index.js');
  const movePage = read('miniprogram/pages/material-edit/index.js');
  const approvalCenterPage = read('miniprogram/pages/admin/approval-center/index.js');

  for (const source of [
    singleStockInPage,
    batchStockInPage,
    templateStockInPage,
    homePage,
    detailPage,
    movePage,
    approvalCenterPage
  ]) {
    assert.match(source, /ensureOperationId/);
    assert.match(source, /operation_id/);
    assert.match(source, /clearOperationId/);
  }
});

test('material unit and archive mutations are blocked after inventory exists', () => {
  const source = read('cloudfunctions/manageMaterial/index.js');

  assert.match(source, /default_unit[\s\S]{0,1200}inventory/);
  assert.match(source, /status:\s*'in_stock'/);
  assert.match(source, /存在在库库存|在库记录/);
});

test('material-wide cascade deletion is disabled and audit operator is server-derived', () => {
  const source = read('cloudfunctions/removeInventory/index.js');
  const correctionApproval = read('cloudfunctions/approveInventoryCorrectionRequest/index.js');

  assert.match(source, /不再支持整物料删除|仅支持按库存标签/);
  assert.doesNotMatch(source, /operator:\s*operator_name/);
  assert.match(source, /库存删除入口已停用/);
  assert.match(correctionApproval, /inventory\.status !== 'in_stock'/);
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
