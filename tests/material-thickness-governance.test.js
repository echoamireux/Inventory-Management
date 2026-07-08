const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildContinueEntryForm,
  buildProductCodeResetForm,
  buildEmptyRequestForm,
  syncFormWithMaterialMaster
} = require('../miniprogram/utils/material-add-form');
const {
  resolveFilmThicknessGovernance
} = require('../cloudfunctions/addMaterial/thickness-governance');

test('save-and-continue re-syncs film thickness from material master instead of keeping stale local edits', () => {
  const form = {
    unique_code: 'TAG-001',
    product_code: '005',
    name: 'PET保护膜',
    supplier: '供应商A',
    supplier_model: 'Model-1',
    subcategory_key: 'builtin:film:protective-film',
    sub_category: '保护膜',
    unit: 'm²',
    thickness_um: '75',
    thickness_locked: false,
    width_mm: '1230',
    batch_number: '20260321',
    expiry_date: '2027-03-21',
    is_long_term_valid: false,
    length_m: '1000',
    zone_key: 'builtin:film:research-warehouse-01',
    location_zone: '研发仓1',
    location_detail: 'A-01'
  };

  const materialItem = {
    product_code: 'M-005',
    name: 'PET保护膜',
    supplier: '供应商A',
    supplier_model: 'Model-1',
    subcategory_key: 'builtin:film:protective-film',
    sub_category: '保护膜',
    unit: 'm²',
    specs: {
      thickness_um: 50,
      standard_width_mm: 1230
    }
  };

  const nextForm = buildContinueEntryForm(form, 'film', materialItem);

  assert.equal(nextForm.thickness_um, '50');
  assert.equal(nextForm.thickness_locked, true);
  assert.equal(nextForm.width_mm, '1230');
  assert.equal(nextForm.product_code, '005');
  assert.equal(nextForm.unique_code, '');
  assert.equal(nextForm.batch_number, '');
  assert.equal(nextForm.expiry_date, '');
  assert.equal(nextForm.is_long_term_valid, false);
  assert.equal(nextForm.length_m, '');
  assert.equal(nextForm.zone_key, 'builtin:film:research-warehouse-01');
});

test('material master sync maps standard material_name into the stock-in form name', () => {
  const nextForm = syncFormWithMaterialMaster({
    product_code: '',
    name: '',
    unit: ''
  }, 'chemical', {
    product_code: 'J-999',
    material_name: '测试料',
    supplier: '三和涂料',
    supplier_model: 'SA-810',
    sub_category: '测试料',
    unit: 'kg'
  }, 'J-');

  assert.equal(nextForm.product_code, '999');
  assert.equal(nextForm.name, '测试料');
  assert.equal(nextForm.supplier, '三和涂料');
  assert.equal(nextForm.supplier_model, 'SA-810');
  assert.equal(nextForm.sub_category, '测试料');
});

test('material master sync uses default_unit returned by material detail queries', () => {
  const chemicalForm = syncFormWithMaterialMaster({
    product_code: '',
    name: '',
    unit: ''
  }, 'chemical', {
    product_code: 'J-008',
    material_name: 'UV减粘胶',
    default_unit: 'mL',
    sub_category: '胶黏剂'
  }, 'J-');

  assert.equal(chemicalForm.unit, 'mL');

  const filmForm = syncFormWithMaterialMaster({
    product_code: '',
    name: '',
    unit: ''
  }, 'film', {
    product_code: 'M-008',
    material_name: 'PET离型膜 50um',
    default_unit: 'm²',
    specs: {
      thickness_um: 50,
      standard_width_mm: 1080
    }
  }, 'M-');

  assert.equal(filmForm.unit, 'm²');
  assert.equal(filmForm.thickness_um, '50');
  assert.equal(filmForm.width_mm, '1080');
});

test('film thickness governance rejects inbound thickness that conflicts with locked master data', () => {
  assert.throws(() => {
    resolveFilmThicknessGovernance({
      materialThicknessUm: 50,
      inboundThicknessUm: 75
    });
  }, /当前物料厚度已锁定为 50 μm，请按主数据入库；如需修改请联系管理员在物料管理中调整/);
});

test('material add page and addMaterial cloud function wire the new thickness governance helpers', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );
  const addMaterialJs = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/addMaterial/index.js'),
    'utf8'
  );

  assert.match(pageJs, /buildContinueEntryForm/);
  assert.match(addMaterialJs, /resolveFilmThicknessGovernance/);
});

test('product code reset helper clears the single-entry form while preserving tab unit and optional new digits', () => {
  const resetForm = buildProductCodeResetForm('film', '009');

  assert.deepEqual(resetForm, {
    unique_code: '',
    label_code_digits: '',
    name: '',
    sub_category: '',
    subcategory_key: '',
    product_code: '009',
    supplier: '',
    supplier_model: '',
    is_test_material: false,
    sample_note: '',
    batch_number: '',
    zone_key: '',
    location_zone: '',
    location_detail_key: '',
    location_detail: '',
    requires_location_detail: false,
    unit: 'm',
    net_content: '',
    package_type: '',
    expiry_date: '',
    is_long_term_valid: false,
    thickness_um: '',
    thickness_locked: false,
    width_mm: '',
    length_m: ''
  });

  assert.deepEqual(buildEmptyRequestForm(), {
    name: '',
    subcategory_key: '',
    sub_category: '',
    supplier: '',
    default_unit: ''
  });
});
