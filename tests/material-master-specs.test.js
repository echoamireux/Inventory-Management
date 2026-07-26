const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function loadModuleWithMocks(modulePath, mocks) {
  const resolvedModulePath = require.resolve(modulePath);
  delete require.cache[resolvedModulePath];

  const originalLoad = Module._load;
  Module._load = function patchedLoader(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(resolvedModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createOperationReceiptCollection(store = new Map()) {
  return {
    doc(id) {
      return {
        async get() {
          return { data: store.get(id) || null };
        },
        async set({ data }) {
          store.set(id, { ...data });
          return {};
        },
        async update({ data }) {
          store.set(id, { ...store.get(id), ...data });
          return {};
        }
      };
    }
  };
}

test('admin material edit page exposes governed master spec fields for chemical and film materials', () => {
  const wxml = read('miniprogram/pages/admin/material-edit.wxml');
  const js = read('miniprogram/pages/admin/material-edit.js');

  assert.match(wxml, /title="包装形式"/);
  assert.match(wxml, /label="厚度"/);
  assert.match(wxml, /label="厚度"[\s\S]*?placeholder="请输入厚度"/);
  assert.match(wxml, /label="厚度"[\s\S]*?<view slot="right-icon" class="field-unit">μm<\/view>/);
  assert.match(wxml, /label="默认幅宽"/);
  assert.match(wxml, /label="默认幅宽"[\s\S]*?placeholder="请输入默认幅宽"/);
  assert.match(wxml, /label="默认幅宽"[\s\S]*?<view slot="right-icon" class="field-unit">mm<\/view>/);
  assert.doesNotMatch(wxml, /label="厚度\(μm\)"/);
  assert.doesNotMatch(wxml, /label="默认幅宽\(mm\)"/);
  assert.doesNotMatch(wxml, /label-width="126px"/);
  assert.match(wxml, /title="默认单位"/);
  assert.match(read('miniprogram/pages/admin/material-edit.wxss'), /\.field-unit[\s\S]*color:\s*#9CA3AF/);
  assert.doesNotMatch(wxml, /保质期/);
  assert.doesNotMatch(js, /shelf_life_days/);
  assert.match(js, /DEFAULT_CHEMICAL_PACKAGE_TYPE/);
  assert.match(js, /package_type:\s*DEFAULT_CHEMICAL_PACKAGE_TYPE/);
  assert.match(js, /showPackageTypePicker/);
  assert.match(js, /packageTypeOptions/);
});

test('admin material edit page hides and clears supplier fields for test material master records', () => {
  const wxml = read('miniprogram/pages/admin/material-edit.wxml');
  const js = read('miniprogram/pages/admin/material-edit.js');
  const cloudFunction = read('cloudfunctions/manageMaterial/index.js');

  assert.doesNotMatch(wxml, /label="厂家型号"/);
  assert.ok(
    wxml.indexOf('title="测试料"') > -1
      && wxml.indexOf('title="测试料"') < wxml.indexOf('label="物料名称"'),
    '测试料开关应位于物料名称上方，先确定维护类型再填写名称'
  );
  assert.match(wxml, /wx:if="\{\{ !form\.is_test_material \}\}"[\s\S]*label="原厂型号"/);
  assert.doesNotMatch(wxml, /label="原厂型号"[\s\S]*?required="\{\{ form\.is_test_material \}\}"/);
  assert.match(wxml, /label="原厂型号"[\s\S]*?placeholder="请输入 \(选填\)"/);
  assert.match(wxml, /真实物料名称、子类别、原厂型号和可选供应商请到主数据管理的“测试料”页维护/);
  assert.match(wxml, /测试料代码壳默认使用“测试料”/);
  assert.doesNotMatch(js, /测试料请填写原厂型号/);
  assert.doesNotMatch(js, /form\.is_test_material[\s\S]*?!String\(form\.supplier_model \|\| ''\)\.trim\(\)/);
  assert.match(js, /TEST_MATERIAL_DEFAULT_NAME\s*=\s*'测试料'/);
  assert.match(js, /TEST_MATERIAL_SUBCATEGORY_NAME\s*=\s*'测试料'/);
  assert.match(js, /buildTestMaterialSubcategoryState/);
  assert.match(js, /applyTestMaterialDefaults\(\{\s*forceName:\s*true\s*\}\)/);
  assert.match(js, /'form\.supplier':\s*''/);
  assert.match(js, /supplier:\s*isTestMaterial \? '' : form\.supplier/);
  assert.match(cloudFunction, /supplier:\s*isTestMaterial \? '' : sanitizeText\(source\.supplier\)/);
  assert.match(cloudFunction, /supplier_model:\s*isTestMaterial \? '' : sanitizeText\(source\.supplier_model\)/);
});

test('admin material edit page supports prefilling category and product code for manager-led direct creation', () => {
  const js = read('miniprogram/pages/admin/material-edit.js');

  assert.match(js, /options\.category/);
  assert.match(js, /options\.product_code/);
  assert.match(js, /initializeCreatePrefill/);
  assert.match(js, /checkDuplicate\(normalizedCode\.product_code\)/);
});

test('manageMaterial cloud function persists package_type and film specs as governed master-data fields', () => {
  const file = read('cloudfunctions/manageMaterial/index.js');

  assert.match(file, /package_type/);
  assert.match(file, /thickness_um/);
  assert.match(file, /standard_width_mm/);
  assert.match(file, /fields\.specs/);
  assert.match(file, /buildGovernedMaterialMasterFields/);
  assert.match(file, /assertAdminMutationAccess/);
  assert.match(file, /assertActiveUserAccess/);
  assert.doesNotMatch(file, /completeFilmSpecsFromInbound/);
  assert.doesNotMatch(file, /shelf_life_days/);
});

test('inventory batch, label, and detail layers all keep film display units aligned with master data truth', () => {
  const detailList = read('miniprogram/pages/inventory/detail-list.js');
  const labelsList = read('miniprogram/pages/inventory/labels/index.js');
  const labelQueryUtil = read('miniprogram/utils/inventory-label-query.js');
  const detailPage = read('miniprogram/pages/inventory-detail/index.js');
  const homeIndex = read('miniprogram/pages/index/index.js');
  const withdrawDialog = read('miniprogram/components/withdraw-dialog/index.js');
  const batchCf = read('cloudfunctions/getInventoryBatches/index.js');

  assert.match(detailList, /getInventoryBatches/);
  assert.match(labelsList, /loadBatchLabelPage/);
  assert.match(labelQueryUtil, /getInventoryQuantityDisplayState/);
  assert.match(detailPage, /getInventoryQuantityDisplayState/);
  assert.match(homeIndex, /getInventoryQuantityDisplayState/);
  assert.match(withdrawDialog, /getInventoryQuantityDisplayState/);
  assert.match(batchCf, /summarizeFilmDisplayQuantities/);
  assert.match(batchCf, /default_unit/);
});

test('inventory detail exposes admin-only film width correction entry and keeps it out of the chemical path', () => {
  const detailWxml = read('miniprogram/pages/inventory-detail/index.wxml');
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');
  const editInventoryJs = read('cloudfunctions/editInventory/index.js');

  assert.match(detailWxml, /title="幅宽"/);
  assert.match(detailWxml, /修正幅宽/);
  assert.doesNotMatch(detailWxml, /修正批次幅宽/);
  assert.match(detailJs, /请输入有效的幅宽/);
  assert.match(detailJs, /幅宽已修正/);
  assert.match(editInventoryJs, /请输入有效的幅宽/);
  assert.match(editInventoryJs, /幅宽由 \[/);
  assert.match(detailJs, /canAdjustFilmWidth/);
  assert.match(detailJs, /onShowWidthAdjustPopup/);
  assert.match(detailJs, /onAdjustFilmWidthConfirm/);
});

test('single stock-in page handles film thickness as governed input and fixes square-meter parsing', () => {
  const pageJs = read('miniprogram/pages/material-add/index.js');
  const pageWxml = read('miniprogram/pages/material-add/index.wxml');

  assert.match(pageJs, /normalizeFilmUnit/);
  assert.match(pageJs, /thickness_locked/);
  assert.match(pageWxml, /readonly="\{\{ form\.thickness_locked \|\| form\.preprint_label_id \}\}"/);
  assert.match(pageWxml, /厚度以主数据为准/);
  assert.match(pageWxml, /label="幅宽\(mm\)"/);
  assert.match(pageWxml, /label="默认单位"/);
  assert.match(pageWxml, /默认单位自动跟随主数据/);
  assert.equal((pageWxml.match(/默认单位自动跟随主数据/g) || []).length >= 2, true);
  assert.doesNotMatch(pageWxml, /label="默认单位"[\s\S]*?slot="button"/);
  assert.doesNotMatch(pageWxml, /label="宽度\(mm\)"/);
  assert.doesNotMatch(pageWxml, /label="计价单位"/);
});

test('material add top action bar uses a centered single-button layout for managers and keeps dual buttons for normal users', () => {
  const pageWxml = read('miniprogram/pages/material-add/index.wxml');
  const pageWxss = read('miniprogram/pages/material-add/index.wxss');

  assert.match(pageWxml, /class="mb-15 top-action-bar \{\{ isManager \? 'top-action-bar--single' : 'top-action-bar--dual' \}\}"/);
  assert.match(pageWxml, /class="top-action-bar__item top-action-bar__item--primary"/);
  assert.match(pageWxml, /wx:if="\{\{ !isManager \}\}" class="top-action-bar__item"/);
  assert.doesNotMatch(pageWxml, /custom-style="flex: 1; \{\{ !isManager \? 'margin-right: 10px;' : '' \}\}"/);

  assert.match(pageWxss, /\.top-action-bar\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--single\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--single \.top-action-bar__item--primary\s*\{/);
  assert.match(pageWxss, /\.top-action-bar--dual \.top-action-bar__item \+ \.top-action-bar__item\s*\{/);
});

test('admin update user status keeps the managed-role whitelist and explicitly supports super-admin handover', () => {
  const file = read('cloudfunctions/adminUpdateUserStatus/index.js');

  assert.match(file, /assertSuperAdminMutationAccess/);
  assert.match(file, /isAllowedManagedRole\(role\)/);
  assert.match(file, /!isAllowedManagedRole\(role\)\s*&&\s*role !== 'super_admin'/);
  assert.match(file, /仅允许设置为 user、admin 或 super_admin/);
});

test('legacy stock-in-out and material-detail pages are no longer exposed as active app routes', () => {
  const appJson = read('miniprogram/app.json');

  assert.doesNotMatch(appJson, /"pages\/stock-in-out\/index"/);
  assert.doesNotMatch(appJson, /"pages\/material-detail\/index"/);
});

test('legacy stock-in-out and material-detail page files are retired from the active codebase', () => {
  const root = path.join(__dirname, '..');

  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/stock-in-out/index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/stock-in-out/index.wxml')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/material-detail/index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/material-detail/index.wxml')), false);
});

test('updateInventory rejects the retired quick stock-in-out payload explicitly while keeping withdrawal callers on the governed path', () => {
  const file = read('cloudfunctions/updateInventory/index.js');

  assert.match(file, /quantity/);
  assert.match(file, /type/);
  assert.match(file, /旧快捷出入库协议已停用|请使用正式入库流程或库存详情页领用/);
  assert.match(file, /withdraw_amount/);
  assert.match(file, /assertActiveUserAccess/);
  assert.match(file, /transaction\.collection\('inventory'\)\.where/);
  assert.match(file, /\['expiry_date', 'asc'\][\s\S]*\['create_time', 'asc'\][\s\S]*\['_id', 'asc'\]/);
  assert.match(file, /MAX_WITHDRAW_CANDIDATES\s*=\s*500/);
});

test('updateInventory retries transient transaction conflicts and then completes withdrawal', async () => {
  const inventoryRecord = {
    _id: 'inv-1',
    material_id: 'mat-1',
    material_name: '测试化材',
    category: 'chemical',
    product_code: 'J-001',
    unique_code: 'L000001',
    status: 'in_stock',
    quantity: { val: 5, unit: 'kg' }
  };
  let transactionAttempts = 0;
  let updateCount = 0;
  let logCount = 0;

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ _openid: 'openid-user', status: 'active', role: 'user', name: '领料人' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where(query) {
            assert.deepEqual(query, { unique_code: 'L000001', status: 'in_stock' });
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [inventoryRecord] };
              }
            };
          }
        };
      }

      if (name === 'project_codes') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ project_code: 'OR2026RD02001', project_name: '服务端项目名', status: 'active' }] };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    async runTransaction(handler) {
      transactionAttempts += 1;
      if (transactionAttempts === 1) {
        throw new Error('transaction conflict: document version changed');
      }

      const transaction = {
        collection(name) {
          if (name === 'inventory') {
            return {
              doc(id) {
                assert.equal(id, 'inv-1');
                return {
                  async get() {
                    return { data: { ...inventoryRecord } };
                  },
                  async update({ data }) {
                    updateCount += 1;
                    assert.equal(data['quantity.val'], 4);
                    assert.equal(data.status, 'in_stock');
                    return {};
                  }
                };
              }
            };
          }

          if (name === 'inventory_log') {
            return {
              async add({ data }) {
                logCount += 1;
                assert.equal(data.project_code, 'OR2026RD02001');
                assert.equal(data.quantity_change, -1);
                return { _id: 'log-1' };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      };

      return handler(transaction);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/updateInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return db;
      }
    }
  });

  const result = await mod.main({
    unique_code: 'L000001',
    withdraw_amount: 1,
    project_code: 'OR2026RD02001',
    project_name: '复合双面胶带',
    withdraw_note: '',
    operation_id: 'op_withdraw_retry_001'
  }, {});

  assert.equal(result.success, true);
  assert.equal(transactionAttempts, 2);
  assert.equal(updateCount, 1);
  assert.equal(logCount, 1);
});

test('updateInventory does not retry business validation errors from the transaction', async () => {
  const inventoryRecord = {
    _id: 'inv-1',
    material_id: 'mat-1',
    material_name: '测试化材',
    category: 'chemical',
    product_code: 'J-001',
    unique_code: 'L000001',
    status: 'in_stock',
    quantity: { val: 0.5, unit: 'kg' }
  };
  let transactionAttempts = 0;

  const db = {
    serverDate() {
      return { $date: true };
    },
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ _openid: 'openid-user', status: 'active', role: 'user', name: '领料人' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [inventoryRecord] };
              }
            };
          }
        };
      }

      if (name === 'project_codes') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ project_code: 'OR2026RD02001', project_name: '服务端项目名', status: 'active' }] };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    async runTransaction(handler) {
      transactionAttempts += 1;
      const transaction = {
        collection(name) {
          if (name === 'inventory') {
            return {
              doc(id) {
                assert.equal(id, 'inv-1');
                return {
                  async get() {
                    return { data: { ...inventoryRecord } };
                  },
                  async update() {
                    throw new Error('库存不足场景不应写入库存');
                  }
                };
              }
            };
          }

          if (name === 'operation_receipts') {
            return createOperationReceiptCollection();
          }

          if (name === 'audit_events') { return { async add() { return { _id: 'audit-test-id' }; } }; }
          throw new Error(`unexpected transaction collection: `);
        }
      };

      return handler(transaction);
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/updateInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return db;
      }
    }
  });

  const originalError = console.error;
  let result;
  try {
    console.error = () => {};
    result = await mod.main({
      unique_code: 'L000001',
      withdraw_amount: 2,
      project_code: 'OR2026RD02001',
      operation_id: 'op_withdraw_insufficient_001'
    }, {});
  } finally {
    console.error = originalError;
  }

  assert.equal(result.success, false);
  assert.match(result.msg, /库存不足/);
  assert.equal(transactionAttempts, 1);
});

test('updateInventory stops retrying transient transaction conflicts after three attempts', async () => {
  const inventoryRecord = {
    _id: 'inv-1',
    material_id: 'mat-1',
    material_name: '测试化材',
    category: 'chemical',
    product_code: 'J-001',
    unique_code: 'L000001',
    status: 'in_stock',
    quantity: { val: 5, unit: 'kg' }
  };
  let transactionAttempts = 0;

  const db = {
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ _openid: 'openid-user', status: 'active', role: 'user', name: '领料人' }] };
              }
            };
          }
        };
      }

      if (name === 'inventory') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [inventoryRecord] };
              }
            };
          }
        };
      }

      if (name === 'project_codes') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              async get() {
                return { data: [{ project_code: 'OR2026RD02001', project_name: '服务端项目名', status: 'active' }] };
              }
            };
          }
        };
      }

      throw new Error(`unexpected collection outside transaction: ${name}`);
    },
    async runTransaction() {
      transactionAttempts += 1;
      throw new Error('事务冲突：版本已变化');
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/updateInventory/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-user' };
      },
      database() {
        return db;
      }
    }
  });

  const originalError = console.error;
  let result;
  try {
    console.error = () => {};
    result = await mod.main({
      unique_code: 'L000001',
      withdraw_amount: 1,
      project_code: 'OR2026RD02001',
      operation_id: 'op_withdraw_conflict_001'
    }, {});
  } finally {
    console.error = originalError;
  }

  assert.equal(result.success, false);
  assert.equal(result.code, 'INTERNAL_ERROR');
  assert.equal(result.msg, '领用失败，请稍后重试');
  assert.equal(result.request_id, 'op_withdraw_conflict_001');
  assert.equal(transactionAttempts, 3);
});

test('audit hardening fixes admin page bindings, material add dialog mount, and approval routing', () => {
  const materialListJs = read('miniprogram/pages/admin/material-list.js');
  const materialListWxml = read('miniprogram/pages/admin/material-list.wxml');
  const materialAddWxml = read('miniprogram/pages/material-add/index.wxml');
  const approvalCenterJs = read('miniprogram/pages/admin/approval-center/index.js');

  assert.match(materialListJs, /selectedCount:\s*0/);
  assert.match(materialListJs, /noop\s*\(\)\s*\{\s*\}/);
  assert.match(materialListJs, /selectedCount:\s*ids\.length/);
  assert.match(materialListWxml, /删除\/归档 \(\{\{ selectedCount \}\}\)/);
  assert.match(materialAddWxml, /<van-dialog id="van-dialog" \/>/);
  assert.match(approvalCenterJs, /wx\.reLaunch\(\{\s*url:\s*['"]\/pages\/index\/index['"]/);
  assert.doesNotMatch(approvalCenterJs, /wx\.switchTab/);
});

test('global dialog button styles keep the equal-width flex split', () => {
  // 剥离注释后再断言，避免 app.wxss 中解释性注释里的类名造成误判
  const appRules = read('miniprogram/app.wxss').replace(/\/\*[\s\S]*?\*\//g, '');

  const buttonRule = appRules.match(/\.van-dialog__button\s*\{[^}]*\}/);
  assert.ok(buttonRule, 'app.wxss 应显式声明 .van-dialog__button 的等分布局');
  // 关键约束：曾有一版覆盖只写了 display/align/justify 却丢掉 flex，
  // 导致两个按钮不再等分、确认按钮视觉偏移
  assert.match(buttonRule[0], /flex:\s*1/);
  assert.match(appRules, /\.van-dialog__footer\s*\{[^}]*display:\s*flex/);

  // vant 模板中不存在该类名，写了也不会生效
  assert.doesNotMatch(appRules, /\.van-dialog__footer--buttons\s*\{/);
  // 跨组件边界的后代选择器，在小程序样式隔离下不生效
  assert.doesNotMatch(appRules, /\.van-dialog__button\s+\.van-button__text\s*\{/);
  // !important 颜色会压过 van-button 的内联 style，使业务传入的 confirmButtonColor 失效，
  // 「禁用账号」「删除物料」等危险操作的红色确认按钮会被强制成蓝色
  assert.doesNotMatch(appRules, /\.van-dialog__confirm\s*\{/);
  assert.doesNotMatch(appRules, /\.van-dialog__cancel\s*\{/);

  // 上述声明与 vant 原生等价；组件库升级若改动原生布局，需同步复核本段
  const dialogWxss = read('miniprogram/miniprogram_npm/@vant/weapp/dialog/index.wxss');
  assert.match(dialogWxss, /\.van-dialog__footer\{display:flex\}/);
  assert.match(dialogWxss, /\.van-dialog__button\{flex:1\}/);
});

test('user management action sheet handles cancel as well as close', () => {
  const wxml = read('miniprogram/pages/super-admin/user-manage/index.wxml');
  const actionSheet = wxml.match(/<van-action-sheet[\s\S]*?\/>/);

  assert.ok(actionSheet, 'user-manage 页应存在 van-action-sheet');
  // 设了 cancel-text 就会渲染取消按钮，而点击它触发的是 cancel 而非 close，
  // 缺少 bind:cancel 时受控的 show 不会复位，面板点不掉
  assert.match(actionSheet[0], /cancel-text/);
  assert.match(actionSheet[0], /bind:cancel=/);
  assert.match(actionSheet[0], /bind:close=/);
});

test('shared components rely on apply-shared styles instead of importing app.wxss', () => {
  [
    'miniprogram/components/popup-header/index',
    'miniprogram/components/withdraw-dialog/index',
    'miniprogram/components/item-card/index'
  ].forEach((basePath) => {
    const wxss = read(`${basePath}.wxss`);
    const json = read(`${basePath}.json`);

    assert.doesNotMatch(wxss, /@import\s+["']\.\.\/\.\.\/app\.wxss["']/);
    assert.match(json, /"styleIsolation"\s*:\s*"apply-shared"/);
  });
});

test('pages using Vant Toast mount a toast host', () => {
  const root = path.join(__dirname, '..');
  const missingHosts = walkFiles(path.join(root, 'miniprogram/pages'))
    .filter(filePath => filePath.endsWith('.js'))
    .filter((filePath) => {
      const js = fs.readFileSync(filePath, 'utf8');
      return js.includes('@vant/weapp/toast/toast');
    })
    .map(filePath => filePath.replace(/\.js$/, '.wxml'))
    .filter(filePath => !fs.existsSync(filePath) || !fs.readFileSync(filePath, 'utf8').includes('id="van-toast"'))
    .map(filePath => path.relative(root, filePath));

  assert.deepEqual(missingHosts, []);
});

test('read-only inventory cloud functions require active users on the backend', () => {
  [
    'cloudfunctions/getDashboardStats/index.js',
    'cloudfunctions/getInventoryGrouped/index.js',
    'cloudfunctions/getInventoryBatches/index.js'
  ].forEach((relPath) => {
    const file = read(relPath);
    assert.match(file, /assertActiveUserAccess/);
    assert.match(file, /collection\('users'\)/);
  });
});

test('home batch recommendation and batch-mode deduction share one FEFO allocation contract', () => {
  const homeIndex = read('miniprogram/pages/index/index.js');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const batchCf = read('cloudfunctions/getInventoryBatches/index.js');
  const updateInventory = read('cloudfunctions/updateInventory/index.js');
  const withdrawDialogJs = read('miniprogram/components/withdraw-dialog/index.js');
  const withdrawDialogWxml = read('miniprogram/components/withdraw-dialog/index.wxml');

  assert.match(groupedCf, /recommendedCode/);
  assert.match(groupedCf, /recommendedBatchNumber/);
  assert.match(groupedCf, /buildInventoryAllocationRecommendation|pickPreferredAllocationItem/);
  assert.match(batchCf, /recommendedCode/);
  assert.match(batchCf, /pickPreferredAllocationItem|sortInventoryAllocationCandidates/);
  assert.match(batchCf, /recommendedBatchNumber/);
  assert.match(updateInventory, /sortInventoryAllocationCandidates/);
  assert.match(updateInventory, /status:\s*'in_stock'/);
  assert.match(updateInventory, /product_code,\s*status:\s*'in_stock'/);
  assert.match(homeIndex, /batch\.recommendedCode/);
  assert.match(homeIndex, /recommendedBatchNumber/);
  assert.match(homeIndex, /withdrawMode:/);
  assert.match(homeIndex, /quickWithdrawMode:/);
  assert.doesNotMatch(homeIndex, /isSmartBatchMode/);
  assert.doesNotMatch(homeIndex, /orderBy\('expiry_date', 'asc'\)/);
  assert.match(withdrawDialogJs, /scan' \|\| this\.data\.mode === 'product'|mode === 'product'/);
  assert.match(withdrawDialogWxml, /首个推荐批次|推荐批次/);
  assert.match(withdrawDialogWxml, /效期优先|FEFO/);
});

test('withdrawal flow requires project codes and writes structured project log fields', () => {
  const withdrawDialogJs = read('miniprogram/components/withdraw-dialog/index.js');
  const withdrawDialogWxml = read('miniprogram/components/withdraw-dialog/index.wxml');
  const homeIndexJs = read('miniprogram/pages/index/index.js');
  const detailJs = read('miniprogram/pages/inventory-detail/index.js');
  const updateInventoryJs = read('cloudfunctions/updateInventory/index.js');

  assert.match(withdrawDialogJs, /manageProjectCode/);
  assert.match(withdrawDialogJs, /projectOptions/);
  assert.match(withdrawDialogJs, /selectedProject/);
  assert.match(withdrawDialogJs, /请选择项目编码/);
  assert.match(withdrawDialogWxml, /title="项目编码"/);
  assert.match(withdrawDialogWxml, /领料备注/);

  assert.match(homeIndexJs, /project_code/);
  assert.match(homeIndexJs, /project_name/);
  assert.match(homeIndexJs, /withdraw_note/);
  assert.match(detailJs, /project_code/);
  assert.match(detailJs, /project_name/);
  assert.match(detailJs, /withdraw_note/);

  assert.match(updateInventoryJs, /project_code/);
  assert.match(updateInventoryJs, /project_name/);
  assert.match(updateInventoryJs, /withdraw_note/);
  assert.doesNotMatch(updateInventoryJs, /project_code\s*\|\|\s*note/);
  assert.match(updateInventoryJs, /description:\s*buildWithdrawDescription/);
});

test('project code management page is registered and exposed to admins', () => {
  const appJson = read('miniprogram/app.json');
  const homeWxml = read('miniprogram/pages/index/index.wxml');
  const servicePath = path.join(__dirname, '..', 'miniprogram/utils/project-code-service.js');
  const pageJsPath = path.join(__dirname, '..', 'miniprogram/pages/admin/project-code-manage/index.js');
  const cloudFnPath = path.join(__dirname, '..', 'cloudfunctions/manageProjectCode/index.js');

  assert.match(appJson, /pages\/admin\/project-code-manage\/index/);
  assert.match(homeWxml, /项目编码管理/);
  assert.equal(fs.existsSync(servicePath), true);
  assert.equal(fs.existsSync(pageJsPath), true);
  assert.equal(fs.existsSync(cloudFnPath), true);
});

test('README documents production database indexes and manual cloud console steps', () => {
  const readme = read('README.md');

  assert.match(readme, /生产索引配置建议/);
  assert.match(readme, /users\._openid[\s\S]*唯一索引/);
  assert.match(readme, /inventory\.unique_code[\s\S]*唯一索引/);
  assert.match(readme, /materials\.product_code[\s\S]*唯一索引/);
  assert.match(readme, /preprinted_labels\.unique_code[\s\S]*唯一索引/);
  assert.match(readme, /preprinted_labels\.operator_id \+ create_time desc/);
  assert.match(readme, /inventory\.product_code \+ status/);
  assert.match(readme, /inventory\.product_code \+ status \+ batch_number/);
  assert.match(readme, /inventory\.product_code \+ status \+ supplier_model/);
  assert.match(readme, /inventory\.product_code \+ status \+ supplier_model \+ batch_number/);
  assert.match(readme, /inventory\.status \+ expiry_date/);
  assert.match(readme, /inventory_log\.type \+ project_code \+ timestamp desc/);
  assert.match(readme, /inventory_log\.inventory_id \+ timestamp desc/);
  assert.match(readme, /inventory_log\.unique_code \+ timestamp desc/);
  assert.match(readme, /微信开发者工具[\s\S]*云开发[\s\S]*数据库[\s\S]*索引[\s\S]*新建索引/);
  assert.match(readme, /唯一索引创建前[\s\S]*重复/);
  assert.match(readme, /users\._openid[\s\S]*防止重复注册/);
});

test('README and root package expose xlsx template import and shared sync workflow', () => {
  const readme = read('README.md');
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.scripts['sync:shared'], 'bash cloudfunctions/sync_shared.sh');
  assert.match(readme, /npm run sync:shared/);
  assert.match(readme, /系统动态生成最新 `\.xlsx` 模板/);
  assert.match(readme, /保持为 `\.xlsx`/);
  assert.doesNotMatch(readme, /另存为 `\.csv`/);
});

test('log pages no longer expose delete actions or call destructive log cloud functions', () => {
  const logsJs = read('miniprogram/pages/logs/index.js');
  const logsWxml = read('miniprogram/pages/logs/index.wxml');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');
  const adminLogsWxml = read('miniprogram/pages/admin-logs/index.wxml');
  const removeLogJs = read('cloudfunctions/removeLog/index.js');
  const batchRemoveLogJs = read('cloudfunctions/batchRemoveLog/index.js');

  assert.doesNotMatch(logsJs, /removeLog/);
  assert.doesNotMatch(logsJs, /batchRemoveLog/);
  assert.doesNotMatch(logsWxml, /bind:longpress/);
  assert.doesNotMatch(logsWxml, /删除/);

  assert.doesNotMatch(adminLogsJs, /removeLog/);
  assert.doesNotMatch(adminLogsJs, /batchRemoveLog/);
  assert.doesNotMatch(adminLogsWxml, /bind:longpress/);
  assert.doesNotMatch(adminLogsWxml, /删除/);

  assert.match(removeLogJs, /日志删除已停用|不可删除/);
  assert.match(batchRemoveLogJs, /日志删除已停用|不可删除/);
});

test('dashboard stats pages inventory records instead of using a fixed aggregate group cap', () => {
  const file = read('cloudfunctions/getDashboardStats/index.js');

  assert.match(file, /loadInventoryItems/);
  assert.match(file, /calculateDashboardStatsFromItems/);
  assert.doesNotMatch(file, /while\s*\(true\)/);
  assert.doesNotMatch(file, /\.group\([\s\S]*?\)\s*\.limit\(1000\)\s*\.end\(\)/);
});

test('inventory grouped and operators queries do not keep a silent aggregate 1000 cap', () => {
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const operatorsCf = read('cloudfunctions/getOperators/index.js');
  const labelExportCf = read('cloudfunctions/exportLabelData/index.js');

  assert.match(groupedCf, /loadInventoryGroupSourceItems/);
  assert.match(operatorsCf, /loadAllOperatorLogRows/);
  assert.doesNotMatch(groupedCf, /\.group\([\s\S]*?\)\s*\.limit\(1000\)\s*\.end\(\)/);
  assert.doesNotMatch(operatorsCf, /\.group\([\s\S]*?\)\s*\.limit\(1000\)\s*\.end\(\)/);
  assert.match(labelExportCf, /\.lookup\([\s\S]*?\)\s*\.limit\(selectedIds\.length\)\s*\.end\(\)/);
});

test('search-backed inventory, master-data, and log queries share escaped keyword matching with broadened field coverage', () => {
  const backendSearch = read('cloudfunctions/_shared/search.js');
  const frontendSearch = read('miniprogram/utils/search.js');
  const groupedCf = read('cloudfunctions/getInventoryGrouped/index.js');
  const manageMaterialCf = read('cloudfunctions/manageMaterial/index.js');
  const getLogsCf = read('cloudfunctions/getLogs/index.js');
  const sharedLogSearch = read('cloudfunctions/_shared/log-search.js');
  const getLogsSearch = read('cloudfunctions/getLogs/log-search.js');
  const frontendLogSearch = read('miniprogram/utils/log-search.js');
  const exportDataCf = read('cloudfunctions/exportData/index.js');
  const logsJs = read('miniprogram/pages/logs/index.js');
  const adminLogsJs = read('miniprogram/pages/admin-logs/index.js');

  assert.match(backendSearch, /escapeRegExp/);
  assert.match(frontendSearch, /escapeRegExp/);

  assert.match(groupedCf, /location_text|location/);
  assert.doesNotMatch(groupedCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.match(manageMaterialCf, /supplier_model/);
  assert.match(manageMaterialCf, /package_type/);
  assert.match(manageMaterialCf, /subcategory_key/);
  assert.match(manageMaterialCf, /sub_category/);
  assert.doesNotMatch(manageMaterialCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.match(getLogsCf, /unique_code/);
  assert.match(getLogsCf, /batch_number/);
  assert.match(getLogsCf, /supplier_model/);
  assert.match(getLogsCf, /supplier_model_key/);
  assert.match(sharedLogSearch, /supplier_model/);
  assert.match(sharedLogSearch, /supplier_model_key/);
  assert.match(getLogsSearch, /supplier_model/);
  assert.match(getLogsSearch, /supplier_model_key/);
  assert.match(frontendLogSearch, /supplier_model/);
  assert.match(frontendLogSearch, /supplier_model_key/);
  assert.match(getLogsCf, /description/);
  assert.match(getLogsCf, /note/);
  assert.match(getLogsCf, /project_code/);
  assert.match(getLogsCf, /project_name/);
  assert.doesNotMatch(getLogsCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);

  assert.doesNotMatch(exportDataCf, /'\.\*'\s*\+\s*searchVal\s*\+\s*'\.\*'/);
  assert.match(adminLogsJs, /unique_code/);
  assert.match(adminLogsJs, /batch_number/);
  assert.match(adminLogsJs, /supplier_model/);
  assert.match(adminLogsJs, /supplier_model_key/);
  assert.match(adminLogsJs, /description/);
  assert.match(adminLogsJs, /note/);
  assert.match(adminLogsJs, /project_code/);
  assert.match(adminLogsJs, /project_name/);
  assert.match(logsJs, /title:\s*err\.message\s*\|\|\s*'加载失败'/);
  assert.match(adminLogsJs, /title:\s*err\.message\s*\|\|\s*'加载失败'/);
});

test('material import preview only renders warning rows when text exists and forces keyed refresh when warning state changes', () => {
  const importWxml = read('miniprogram/pages/admin/material-import/index.wxml');

  assert.match(importWxml, /wx:key="previewKey"/);
  assert.match(importWxml, /wx:else-if="\{\{ item\.hasWarning && item\.warning \}\}"/);
});
