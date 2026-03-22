const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getMaterialSubmitValidationMessage,
  getCategorySpecificValidationMessage
} = require('../miniprogram/utils/stock-form');

test('material add submit validation reports missing batch number before storage zone', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '',
      zone_key: '',
      location_zone: '实验室2'
    }),
    '请填写生产批号'
  );
});

test('material add submit validation reports missing storage zone when batch number exists', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: '',
      location_zone: '实验室2'
    }),
    '请选择存储区域'
  );
});

test('material add submit validation passes when batch number and structured storage zone are both ready', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: 'builtin:chemical:lab2',
      location_zone: '实验室2'
    }),
    ''
  );
});

test('chemical submit validation reports the first missing spec field precisely', () => {
  assert.equal(
    getCategorySpecificValidationMessage('chemical', {
      unit: '',
      net_content: '',
      expiry_date: ''
    }),
    '请填写净含量'
  );
});

test('film submit validation reports the first missing spec field precisely', () => {
  assert.equal(
    getCategorySpecificValidationMessage('film', {
      thickness_um: '',
      width_mm: '',
      length_m: '',
      unit: '',
      expiry_date: ''
    }),
    '请填写厚度'
  );
});

test('film submit validation reports expiry date after dimensions are present', () => {
  assert.equal(
    getCategorySpecificValidationMessage('film', {
      thickness_um: '25',
      width_mm: '1200',
      length_m: '1000',
      unit: 'm',
      expiry_date: ''
    }),
    '请选择过期日期'
  );
});

test('category submit validation accepts explicit long-term validity in place of an expiry date', () => {
  assert.equal(
    getCategorySpecificValidationMessage('chemical', {
      net_content: '20',
      unit: 'kg',
      expiry_date: '',
      is_long_term_valid: true
    }),
    ''
  );

  assert.equal(
    getCategorySpecificValidationMessage('film', {
      thickness_um: '25',
      width_mm: '1200',
      length_m: '1000',
      unit: 'm²',
      expiry_date: '',
      is_long_term_valid: true
    }),
    ''
  );
});

test('active business pages use the updated validation and management wording', () => {
  const materialAddJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );
  const materialAddWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.wxml'),
    'utf8'
  );
  const stockInOutJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/stock-in-out/index.js'),
    'utf8'
  );
  const zoneManageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/zone-manage/index.js'),
    'utf8'
  );
  const zoneManageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/zone-manage/index.wxml'),
    'utf8'
  );

  assert.doesNotMatch(materialAddJs, /请完善化材规格信息/);
  assert.doesNotMatch(materialAddJs, /请完善膜材规格及过期日期/);
  assert.doesNotMatch(materialAddJs, /请选择建议小类/);
  assert.match(materialAddWxml, /设为长期有效/);
  assert.match(materialAddWxml, /title="子类别"/);
  assert.match(stockInOutJs, /请输入标签编号/);
  assert.match(zoneManageJs, /请输入库区名称/);
  assert.match(zoneManageJs, /请输入新的库区名称/);
  assert.doesNotMatch(zoneManageWxml, /本轮不做回写/);
  assert.match(zoneManageWxml, /历史库存记录仍保留原库区信息/);
});
