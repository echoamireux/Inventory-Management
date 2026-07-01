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
      location_zone: '防爆柜02'
    }),
    '请填写生产批号'
  );
});

test('material add submit validation reports missing storage zone when batch number exists', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: '',
      location_zone: '防爆柜02'
    }),
    '请选择存储区域'
  );
});

test('material add submit validation requires supplier model for test materials', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      is_test_material: true,
      supplier_model: ''
    }),
    '测试料请填写原厂型号'
  );

  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      is_test_material: true,
      supplier_model: 'TEST-IPA-01'
    }),
    ''
  );
});

test('material add submit validation passes when batch number and structured storage zone are both ready', () => {
  assert.equal(
    getMaterialSubmitValidationMessage({
      batch_number: '20260523',
      zone_key: 'builtin:chemical:safe-cabinet-02',
      location_zone: '防爆柜02'
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

test('film submit validation uses unified 幅宽 and 默认单位 wording', () => {
  assert.equal(
    getCategorySpecificValidationMessage('film', {
      thickness_um: '25',
      width_mm: '',
      length_m: '',
      unit: '',
      expiry_date: ''
    }),
    '请填写幅宽'
  );

  assert.equal(
    getCategorySpecificValidationMessage('film', {
      thickness_um: '25',
      width_mm: '1200',
      length_m: '1000',
      unit: '',
      expiry_date: ''
    }),
    '请选择默认单位'
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
  assert.match(materialAddWxml, /label-code-prefix/);
  assert.match(materialAddWxml, /placeholder="请输入6位数字编码"/);
  assert.match(materialAddWxml, /maxlength="6"/);
  assert.match(materialAddWxml, /bindinput="onLabelCodeInput"/);
  assert.match(materialAddWxml, /bind:blur="onLabelCodeBlur"/);
  assert.doesNotMatch(materialAddWxml, /placeholder="扫码或输入，如 L000001"/);
  assert.match(materialAddWxml, /bind:input="onInput"/);
  assert.match(materialAddWxml, /bind:blur="onProductCodeBlur"/);
  assert.match(materialAddWxml, /bind:confirm="onProductCodeConfirm"/);
  assert.match(materialAddWxml, /confirm-type="done"/);
  assert.match(materialAddWxml, /label="原厂型号"[\s\S]*required="\{\{ form\.is_test_material \}\}"/);
  assert.match(materialAddWxml, /title="子类别"/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '../miniprogram/pages/stock-in-out/index.js')),
    false
  );
  assert.match(materialAddJs, /isManager:/);
  assert.match(materialAddWxml, /wx:if="\{\{ !isManager \}\}"/);
  assert.match(materialAddWxml, /bind:click="goToAdminCreateMaterial"/);
  assert.match(materialAddWxml, /该物料尚未建档/);
  assert.match(materialAddWxml, /直接建档/);
  assert.match(zoneManageJs, /请输入库区名称/);
  assert.match(zoneManageJs, /请输入新的库区名称/);
  assert.match(zoneManageJs, /createZone\(name,\s*this\.data\.createForm\.scope\)/);
  assert.match(zoneManageJs, /chemical[\s\S]*化材专用/);
  assert.match(zoneManageJs, /film[\s\S]*膜材专用/);
  assert.match(zoneManageJs, /global/);
  assert.match(zoneManageJs, /共享/);
  assert.match(zoneManageWxml, /van-radio-group/);
  assert.match(zoneManageWxml, /scopeOptions/);
  assert.match(zoneManageWxml, /\{\{ item\.name \}\}/);
  assert.doesNotMatch(zoneManageWxml, /本轮不做回写/);
  assert.match(zoneManageWxml, /历史库存记录仍保留原库区信息/);
});

test('fixed bottom form pages reserve scroll space above action bars', () => {
  const adminMaterialEditWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/material-edit.wxml'),
    'utf8'
  );
  const adminMaterialEditWxss = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/material-edit.wxss'),
    'utf8'
  );
  const adminMaterialImportWxss = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/admin/material-import/index.wxss'),
    'utf8'
  );

  assert.match(adminMaterialEditWxml, /class="container material-edit-page"/);
  assert.doesNotMatch(adminMaterialEditWxml, /class="container pb-40"/);
  assert.match(adminMaterialEditWxss, /\.material-edit-page\s*\{[\s\S]*padding-bottom:\s*calc\(128px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(adminMaterialEditWxss, /\.submit-btn-container\s*\{[\s\S]*z-index:\s*100/);
  assert.match(adminMaterialImportWxss, /\.container\s*\{[\s\S]*padding-bottom:\s*128px/);
});

test('numeric padding-bottom utility classes used by pages are defined', () => {
  const appWxss = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8');
  const pagesRoot = path.join(__dirname, '../miniprogram/pages');
  const wxmlFiles = [];

  function collectWxmlFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectWxmlFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.wxml')) {
        wxmlFiles.push(fullPath);
      }
    }
  }

  collectWxmlFiles(pagesRoot);

  const missing = [];
  for (const filePath of wxmlFiles) {
    const wxml = fs.readFileSync(filePath, 'utf8');
    const localWxssPath = filePath.replace(/\.wxml$/, '.wxss');
    const localWxss = fs.existsSync(localWxssPath) ? fs.readFileSync(localWxssPath, 'utf8') : '';
    const classMatches = wxml.match(/class="[^"]*"/g) || [];
    for (const classMatch of classMatches) {
      const classNames = classMatch
        .replace(/^class="/, '')
        .replace(/"$/, '')
        .split(/\s+/)
        .filter(Boolean);
      for (const className of classNames) {
        if (!/^pb-\d+$/.test(className)) {
          continue;
        }
        const classPattern = new RegExp(`\\.${className}\\s*\\{`);
        if (!classPattern.test(appWxss) && !classPattern.test(localWxss)) {
          missing.push(`${path.relative(path.join(__dirname, '..'), filePath)}:${className}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
});
