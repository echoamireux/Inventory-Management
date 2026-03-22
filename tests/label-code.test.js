const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('../miniprogram/utils/label-code');

test('label code normalization auto-completes the L plus six-digit format for manual stock-in input', () => {
  assert.equal(normalizeLabelCodeInput('1'), 'L000001');
  assert.equal(normalizeLabelCodeInput('000123'), 'L000123');
  assert.equal(normalizeLabelCodeInput('l45'), 'L000045');
  assert.equal(normalizeLabelCodeInput('L000678'), 'L000678');
});

test('label code validation only accepts the governed L plus six-digit format', () => {
  assert.equal(isValidLabelCode('L000001'), true);
  assert.equal(isValidLabelCode(normalizeLabelCodeInput('l000001')), true);
  assert.equal(isValidLabelCode('A000001'), false);
  assert.equal(isValidLabelCode('L12345'), false);
});

test('single stock-in and addMaterial cloud function wire the governed label-code helper and hard validation', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/material-add/index.js'),
    'utf8'
  );
  const addMaterialJs = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/addMaterial/index.js'),
    'utf8'
  );

  assert.match(pageJs, /normalizeLabelCodeInput/);
  assert.match(pageJs, /isValidLabelCode/);
  assert.match(addMaterialJs, /isValidLabelCode/);
  assert.match(addMaterialJs, /标签编号格式不正确/);
});
