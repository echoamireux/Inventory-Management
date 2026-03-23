// pages/material-add/index.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
import {
  CATEGORY_PREFIX,
  PACKAGE_TYPES,
  DEFAULT_FORM
} from '../../utils/constants';
const {
  buildLocationZoneActions,
  buildZoneMap,
  buildLocationPayload
} = require('../../utils/location-zone');
const {
  normalizeLabelCodeInput,
  sanitizeLabelCodeDigitsInput,
  extractLabelCodeDigits,
  isValidLabelCode
} = require('../../utils/label-code');
const { registerZoneManagementAccess } = require('../../utils/material-add-access');
const { listZoneRecords } = require('../../utils/zone-service');
const { listSubcategoryRecords } = require('../../utils/subcategory-service');
const {
  getDefaultUnit,
  getUnitActions,
  normalizeUnitInput
} = require('../../utils/material-units');
const {
  syncFormWithMaterialMaster,
  buildContinueEntryForm,
  buildProductCodeResetForm,
  buildEmptyRequestForm
} = require('../../utils/material-add-form');
const {
  buildSubcategoryActions,
  isSelectableSubcategoryRecord
} = require('../../utils/material-subcategory');
const {
  sanitizeProductCodeNumberInput,
  normalizeProductCodeInput,
  validateStandardProductCode,
  findExactProductCodeMatch
} = require('../../utils/product-code');
const {
  getMaterialSubmitValidationMessage,
  getCategorySpecificValidationMessage
} = require('../../utils/stock-form');
const { normalizeFilmUnit } = require('../../utils/film');
const db = wx.cloud.database();

function resolvePickerDateValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return detail;
}

function resolveInputValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return detail;
}

Page({
  data: {
    activeTab: 'chemical',
    form: { ...DEFAULT_FORM, unit: getDefaultUnit('chemical') },
    loading: false,

    // UI状态
    showUnitSheet: false,
    showPackageTypeSheet: false,
    showLocationSheet: false,
    showDatePicker: false,
    showSuccessDialog: false,

    // MDM 强管控状态
    isUnknownCode: false,
    isArchived: false,
    archiveReason: '',
    showRequestPopup: false,
    requestLoading: false,
    requestSubCategoryActions: [],
    showRequestSubCategorySheet: false,
    requestForm: buildEmptyRequestForm(),

    // 联想建议
    suggestions: [],

    // 数据
    subCategoryRecords: [],
    dbZones: [],
    zoneRecords: [],

    locationZones: [],
    locationZoneActions: [],

    // 使用常量
    unitActions: getUnitActions('chemical'),
    packageTypeActions: PACKAGE_TYPES,
    // UI binding
    subCategoryActions: [],
    showSubCategorySheet: false,

    currentDate: new Date().getTime(),
    minDate: new Date().getTime(),
    canManageZones: false,
    isManager: false,
    labelCodeError: '',
    labelCodeChecking: false
  },

  onLoad(options) {
      const app = getApp();

      if (options) {
          if (options.id) {
              const normalizedLabelCode = normalizeLabelCodeInput(options.id);
              this.setData({
                  'form.unique_code': normalizedLabelCode,
                  'form.label_code_digits': extractLabelCodeDigits(options.id),
                  labelCodeError: ''
              });
          }
          if (options.product_code) {
              this.setData({ 'form.product_code': options.product_code });
          }
          if (options.tab) {
              this.setData({
                  activeTab: options.tab,
                  'form.unit': getDefaultUnit(options.tab)
              });
          }
      }

      registerZoneManagementAccess(app, (canManageZones) => {
          this.setData({ canManageZones, isManager: canManageZones }, () => {
              this.updateZoneActions();
          });
      });

      this.loadSubcategories(this.data.activeTab);
      this.updateUnitActions(this.data.activeTab);

      // Load Zones from DB
      this.loadZones();
      this._pageInitialized = true;
  },

  onShow() {
    if (this._pageInitialized) {
      this.loadZones();
      this.loadSubcategories(this.data.activeTab);
    }
  },

  goToBatchEntry() {
      wx.navigateTo({
          url: `/pages/material-add/batch-entry?tab=${this.data.activeTab}`
      });
  },

  goToMyRequests() {
      wx.navigateTo({
          url: '/pages/my-requests/index'
      });
  },

  goToAdminCreateMaterial() {
      if (!this.data.isManager) {
        return;
      }

      const normalizedCode = normalizeProductCodeInput(this.data.activeTab, this.data.form.product_code);
      if (!normalizedCode.ok) {
        Toast.fail(normalizedCode.msg || '产品代码无效');
        return;
      }

      wx.navigateTo({
        url: `/pages/admin/material-edit?category=${this.data.activeTab}&product_code=${encodeURIComponent(normalizedCode.product_code)}`
      });
  },

  async loadZones() {
      try {
          const zoneRecords = await listZoneRecords(this.data.activeTab, false);
          this.setData({
            zoneRecords,
            dbZones: zoneRecords.map(z => z.name)
          }, () => {
            this.syncSelectedZoneName(zoneRecords);
            this.updateZoneActions(zoneRecords);
          });

      } catch (err) {
          console.error('Load zones failed', err);
          this.setData({
            zoneRecords: [],
            dbZones: []
          }, () => {
            this.updateZoneActions([]);
          });
          Toast.fail(err.message || '加载库区失败');
      }
  },

  updateZoneActions(zoneRecords = this.data.zoneRecords) {
      const { canManageZones } = this.data;
      this.setData({
        locationZones: zoneRecords.map(item => item.name),
        locationZoneActions: buildLocationZoneActions(zoneRecords, canManageZones)
      });
  },

  syncSelectedZoneName(zoneRecords = this.data.zoneRecords) {
      const zoneMap = buildZoneMap(zoneRecords);
      const zoneKey = this.data.form.zone_key;
      if (!zoneKey) {
        return;
      }

      const zone = zoneMap.get(zoneKey);
      if (zone) {
        this.setData({
          'form.location_zone': zone.name
        });
        return;
      }

      this.setData({
        'form.zone_key': '',
        'form.location_zone': '',
        'form.location_detail': ''
      });
  },

  onTabChange(e) {
    const tab = e.detail.name;
    this.invalidateProductCodeLookup();

    this.setData({
        activeTab: tab,
        // Reset dynamic fields
        'form.product_code': '',
        'form.name': '',
        'form.sub_category': '',
        'form.supplier_model': '',
        'form.batch_number': '',
        'form.unit': getDefaultUnit(tab),
        'form.expiry_date': '',
        'form.is_long_term_valid': false,
        'form.thickness_um': '',
        'form.thickness_locked': false,
        'form.width_mm': '',
        'form.length_m': '',
        'form.zone_key': '',
        'form.location_zone': '',
        'form.location_detail': '',
        labelCodeError: '',
        labelCodeChecking: false,
        // We can keep unique_code
        suggestions: [],
        isUnknownCode: false,
        isArchived: false,
        archiveReason: '',
        showRequestPopup: false,
        requestLoading: false,
        showRequestSubCategorySheet: false,
        requestForm: buildEmptyRequestForm()
    }, () => {
        this.loadSubcategories(tab);
        this.updateUnitActions(tab);
        this.loadZones();
    });
  },

  async loadSubcategories(category = this.data.activeTab) {
      try {
        const subCategoryRecords = await listSubcategoryRecords(category, false);
        this.setData({
          subCategoryRecords,
          subCategoryActions: buildSubcategoryActions(subCategoryRecords),
          requestSubCategoryActions: buildSubcategoryActions(subCategoryRecords)
        });
      } catch (err) {
        console.error('Load subcategories failed', err);
        this.setData({
          subCategoryRecords: [],
          subCategoryActions: [],
          requestSubCategoryActions: []
        });
        Toast.fail(err.message || '加载子类别失败');
      }
  },

  // 更新单位列表（按类别严格收口）
  updateUnitActions(tab) {
      this.setData({ unitActions: getUnitActions(tab) });
  },

  // Helper to get prefix - 使用常量
  getPrefix(tab) {
      return CATEGORY_PREFIX[tab] || 'J-';
  },

  buildProductCodeResetUpdates(nextProductCode = '') {
    return {
      form: buildProductCodeResetForm(this.data.activeTab, nextProductCode),
      suggestions: [],
      isUnknownCode: false,
      isArchived: false,
      archiveReason: '',
      showRequestPopup: false,
      requestLoading: false,
      showRequestSubCategorySheet: false,
      requestForm: buildEmptyRequestForm(),
      labelCodeError: '',
      labelCodeChecking: false
    };
  },

  hasProductCodeResetContext() {
    const { form, suggestions, isUnknownCode, isArchived, showRequestPopup } = this.data;

    return Boolean(
      this._lastConfirmedProductCode ||
      isUnknownCode ||
      isArchived ||
      showRequestPopup ||
      (Array.isArray(suggestions) && suggestions.length > 0) ||
      form.name ||
      form.sub_category ||
      form.subcategory_key ||
      form.supplier ||
      form.supplier_model ||
      form.net_content ||
      form.package_type ||
      form.thickness_um ||
      form.thickness_locked ||
      form.width_mm
    );
  },

  invalidateProductCodeLookup() {
    this._productCodeLookupRequestId = (this._productCodeLookupRequestId || 0) + 1;
    this._activeProductCodeLookupCode = '';
    this._lastConfirmedProductCode = '';
    return this._productCodeLookupRequestId;
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    let value = resolveInputValue(e.detail);
    if (field === 'product_code') {
      value = sanitizeProductCodeNumberInput(value);
    }
    const updates = { [`form.${field}`]: value };

    if (field === 'product_code') {
      const shouldResetProductContext = this.hasProductCodeResetContext();
      this.invalidateProductCodeLookup();
      if (shouldResetProductContext) {
        this.setData(this.buildProductCodeResetUpdates(value));
        return;
      }
      updates.suggestions = [];
      updates.isUnknownCode = false;
      updates.isArchived = false;
      updates.archiveReason = '';
      updates.showRequestPopup = false;
      updates.requestLoading = false;
      updates.showRequestSubCategorySheet = false;
      updates.requestForm = buildEmptyRequestForm();
    }

    this.setData(updates);
  },

  async onProductCodeBlur(e) {
    await this.confirmProductCodeLookup(e);
  },

  async onProductCodeConfirm(e) {
    await this.confirmProductCodeLookup(e);
  },

  async confirmProductCodeLookup(e) {
    const rawValue = sanitizeProductCodeNumberInput(resolveInputValue(e && e.detail !== undefined ? e.detail : this.data.form.product_code));

    if (!rawValue) {
      this.invalidateProductCodeLookup();
      this.setData({
        'form.product_code': '',
        suggestions: [],
        isUnknownCode: false,
        isArchived: false,
        archiveReason: '',
        showRequestPopup: false,
        requestLoading: false,
        showRequestSubCategorySheet: false,
        requestForm: buildEmptyRequestForm()
      });
      return;
    }

    const normalizedCode = normalizeProductCodeInput(this.data.activeTab, rawValue);
    if (!normalizedCode.ok) {
      this.invalidateProductCodeLookup();
      this.setData({
        'form.product_code': rawValue,
        suggestions: [],
        isUnknownCode: false,
        isArchived: false,
        archiveReason: '',
        showRequestPopup: false,
        requestLoading: false,
        showRequestSubCategorySheet: false,
        requestForm: buildEmptyRequestForm()
      });
      return;
    }

    const lookupCode = normalizedCode.product_code;
    if (this._lastConfirmedProductCode === lookupCode) {
      this.setData({
        'form.product_code': normalizedCode.number
      });
      return;
    }

    if (this._activeProductCodeLookupCode === lookupCode) {
      this.setData({
        'form.product_code': normalizedCode.number
      });
      return;
    }

    const requestId = this.invalidateProductCodeLookup();
    this._activeProductCodeLookupCode = lookupCode;
    this.setData({
      'form.product_code': normalizedCode.number,
      suggestions: [],
      isUnknownCode: false,
      isArchived: false,
      archiveReason: '',
      showRequestPopup: false,
      requestLoading: false,
      showRequestSubCategorySheet: false
    });

    try {
      const lookupResult = await this.searchSuggestions(lookupCode);
      if (requestId !== this._productCodeLookupRequestId) {
        return;
      }

      if (lookupResult.status === 'matched') {
        this.setData({
          suggestions: lookupResult.suggestions,
          isUnknownCode: false,
          isArchived: false,
          archiveReason: ''
        });

        const exactMatch = findExactProductCodeMatch(lookupResult.suggestions, lookupCode);
        if (exactMatch) {
          this.applyMaterialSuggestion(exactMatch, { showToast: false });
        }
      } else if (lookupResult.status === 'archived') {
        this.setData({
          suggestions: [],
          isUnknownCode: true,
          isArchived: true,
          archiveReason: lookupResult.archiveReason || ''
        });
      } else if (lookupResult.status === 'unknown') {
        this.setData({
          suggestions: [],
          isUnknownCode: true,
          isArchived: false,
          archiveReason: ''
        });
      } else {
        this.setData({
          suggestions: [],
          isUnknownCode: false,
          isArchived: false,
          archiveReason: ''
        });
        if (lookupResult.message) {
          Toast.fail(lookupResult.message);
        }
        return;
      }

      this._lastConfirmedProductCode = lookupCode;
    } finally {
      if (requestId === this._productCodeLookupRequestId) {
        this._activeProductCodeLookupCode = '';
      }
    }
  },

  onLabelCodeInput(e) {
    const digits = sanitizeLabelCodeDigitsInput(e.detail && e.detail.value);
    const normalizedLabelCode = digits ? normalizeLabelCodeInput(digits) : '';
    this.setData({
      'form.label_code_digits': digits,
      'form.unique_code': normalizedLabelCode,
      labelCodeError: ''
    });
  },

  async onLabelCodeBlur() {
    const digits = sanitizeLabelCodeDigitsInput(this.data.form.label_code_digits);
    if (!digits) {
      this.setData({
        'form.label_code_digits': '',
        'form.unique_code': '',
        labelCodeError: ''
      });
      return;
    }

    const normalizedLabelCode = normalizeLabelCodeInput(digits);
    this.setData({
      'form.label_code_digits': extractLabelCodeDigits(normalizedLabelCode),
      'form.unique_code': normalizedLabelCode,
      labelCodeError: ''
    });

    if (!isValidLabelCode(normalizedLabelCode)) {
      this.setData({
        labelCodeError: '请输入6位数字编码'
      });
      return;
    }

    await this.checkDuplicateLabelCode(normalizedLabelCode);
  },

  async checkDuplicateLabelCode(uniqueCode, options = {}) {
    const { showDialog = false } = options;
    const normalizedLabelCode = normalizeLabelCodeInput(uniqueCode);

    if (!normalizedLabelCode || !isValidLabelCode(normalizedLabelCode)) {
      return {
        duplicated: false,
        uniqueCode: normalizedLabelCode
      };
    }

    this.setData({ labelCodeChecking: true });

    try {
      const res = await db.collection('inventory').where({
        unique_code: normalizedLabelCode
      }).count();

      if (res.total > 0) {
        const message = `标签编号 ${normalizedLabelCode} 已入库，不能重复登记`;
        this.setData({ labelCodeError: message });

        if (showDialog) {
          await Dialog.alert({
            title: '标签编号重复',
            message,
            messageAlign: 'left'
          });
        }

        return {
          duplicated: true,
          uniqueCode: normalizedLabelCode,
          message
        };
      }

      this.setData({ labelCodeError: '' });
      return {
        duplicated: false,
        uniqueCode: normalizedLabelCode
      };
    } catch (err) {
      console.error('[Label Code] duplicate check failed', err);
      return {
        duplicated: false,
        uniqueCode: normalizedLabelCode,
        error: err
      };
    } finally {
      this.setData({ labelCodeChecking: false });
    }
  },

  // 分类选择
  showSubCategorySheet() { this.setData({ showSubCategorySheet: true }); },
  onSubCategoryClose() { this.setData({ showSubCategorySheet: false }); },
  onSubCategorySelect(e) {
      const item = e.detail;
      this.setData({
          'form.sub_category': item.name,
          showSubCategorySheet: false
      });
  },

  // 查询联想词 (从主数据表查询)
  async searchSuggestions(keyword) {
      if (!keyword) {
          return {
              status: 'idle',
              suggestions: []
          };
      }
      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'list',
                  data: {
                      searchVal: keyword,
                      category: this.data.activeTab,
                      pageSize: 10
                  }
              }
          });

          if (res.result && res.result.success) {
             const list = Array.isArray(res.result.list) ? res.result.list : [];

             // MDM 强管控：如果没有匹配到任何结果 -> 检查是否为归档物料 or 阻断
             if (!list || list.length === 0) {
                  // Check Archive Status with Debug Logs
                  try {
                      console.log('[Debug] Checking status for:', keyword);
                      const checkRes = await wx.cloud.callFunction({
                          name: 'manageMaterial',
                          data: { action: 'checkStatus', data: { product_code: keyword } }
                      });
                      console.log('[Debug] checkStatus res:', checkRes);

                      if (checkRes.result.success && checkRes.result.isArchived) {
                          return {
                              status: 'archived',
                              suggestions: [],
                              archiveReason: checkRes.result.reason || ''
                          };
                      }
                  } catch(e) {
                      console.error('[Debug] checkStatus failed:', e);
                  }

                 return {
                     status: 'unknown',
                     suggestions: [],
                     archiveReason: ''
                 };
             }

             // 将主数据结果映射为建议格式
             const suggestions = list.map(m => ({
                 _id: m._id,
                 product_code: m.product_code,
                 name: m.material_name,
                 supplier: m.supplier,
                 supplier_model: m.supplier_model,
                 sub_category: m.sub_category,
                 subcategory_key: m.subcategory_key || '',
                 unit: m.default_unit,
                 category: m.category,
                 package_type: m.package_type || '',
                 specs: m.specs || {}
             }));
             return {
                 status: 'matched',
                 suggestions,
                 archiveReason: ''
             };
          }
      } catch(err) {
          console.error('[Suggestion Error]', err);
          return {
              status: 'error',
              suggestions: [],
              archiveReason: '',
              message: '产品代码查询失败，请稍后重试'
          };
      }
      return {
          status: 'error',
          suggestions: [],
          archiveReason: '',
          message: '产品代码查询失败，请稍后重试'
      };
  },

  applyMaterialSuggestion(item, options = {}) {
      if (!item) {
        return;
      }

      const { showToast = true } = options;
      const prefix = this.getPrefix(this.data.activeTab);
      const newForm = syncFormWithMaterialMaster(this.data.form, this.data.activeTab, item, prefix);

      this.setData({
          form: newForm,
          suggestions: [],
          isUnknownCode: false,
          isArchived: false,
          archiveReason: '',
          showRequestPopup: false
      });

      if (showToast) {
        wx.showToast({
            title: '已填入物料信息',
            icon: 'success',
            duration: 1500
        });
      }
  },

  // 选中建议 (Auto-fill) - 自动填入所有可用字段
  onSelectSuggestion(e) {
      const item = e.currentTarget.dataset.item;
      this.applyMaterialSuggestion(item);
  },

  async fetchMaterialSuggestionByCode(productCode) {
      const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
              action: 'list',
              data: {
                  searchVal: productCode,
                  category: this.data.activeTab,
                  pageSize: 10
              }
          }
      });

      if (!(res.result && res.result.success)) {
          throw new Error((res.result && res.result.msg) || '加载物料主数据失败');
      }

      const list = Array.isArray(res.result.list) ? res.result.list : [];
      return list.find((item) => item.product_code === productCode) || null;
  },

  closeSuggestions() {
      this.setData({ suggestions: [] });
  },

  // 扫码
  onScanCode() {
      wx.scanCode({
          success: async (res) => {
              const normalizedLabelCode = normalizeLabelCodeInput(res.result);
              if (!isValidLabelCode(normalizedLabelCode)) {
                  Dialog.alert({
                      title: '标签编号错误',
                      message: '标签编号格式不正确，应为 L + 6位数字',
                      messageAlign: 'left'
                  });
                  return;
              }
              this.setData({
                'form.unique_code': normalizedLabelCode,
                'form.label_code_digits': extractLabelCodeDigits(normalizedLabelCode),
                labelCodeError: ''
              });
              const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode);
              if (duplicateResult.duplicated) {
                return;
              }
              wx.showToast({ title: '扫码成功', icon: 'success' });
          },
          fail: (err) => {
              console.error(err);
          }
      });
  },

  // 单位选择
  showUnitSheet() { this.setData({ showUnitSheet: true }); },
  onUnitClose() { this.setData({ showUnitSheet: false }); },
  onUnitSelect(e) {
    // e.detail.name is now just 'kg', 'g', etc.
    this.setData({ 'form.unit': e.detail.name, showUnitSheet: false });
  },

  // 包装形式选择 (New)
  showPackageTypeSheet() { this.setData({ showPackageTypeSheet: true }); },
  onPackageTypeClose() { this.setData({ showPackageTypeSheet: false }); },
  onPackageTypeSelect(e) {
      this.setData({ 'form.package_type': e.detail.name, showPackageTypeSheet: false });
  },

  // 日期选择
  showDatePicker() {
    if (this.data.form.is_long_term_valid) {
      return;
    }
    this.setData({ showDatePicker: true });
  },
  onDateCancel() { this.setData({ showDatePicker: false }); },
  onDateConfirm(e) {
    const date = new Date(resolvePickerDateValue(e.detail));
    const formated = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    this.setData({
      'form.expiry_date': formated,
      'form.is_long_term_valid': false,
      showDatePicker: false
    });
  },

  onLongTermValidityChange(e) {
    const checked = typeof e.detail === 'boolean'
      ? e.detail
      : !!(e.detail && e.detail.value);
    this.setData({
      'form.is_long_term_valid': checked,
      'form.expiry_date': checked ? '' : this.data.form.expiry_date,
      showDatePicker: false
    });
  },

  // 库位区域选择 (New)
  showLocationSheet() { this.setData({ showLocationSheet: true }); },
  onLocationClose() { this.setData({ showLocationSheet: false }); },
  onLocationSelect(e) {
      const zone = e.detail.name;
      const zoneRecord = this.data.zoneRecords.find(item => item.name === zone);
      this.setData({
          'form.zone_key': zoneRecord ? zoneRecord.zone_key : '',
          'form.location_zone': zone,
          showLocationSheet: false
      });
  },

  onManageZones() {
      if (!this.data.canManageZones) {
        return;
      }

      wx.navigateTo({
        url: `/pages/admin/zone-manage/index?category=${this.data.activeTab}`
      });
  },

  // SKU 校验
  validateSKU(code, type) {
      return validateStandardProductCode(type, code).ok;
  },

  async onSubmit() {
    const { activeTab, form } = this.data;
    const normalizedLabelCode = normalizeLabelCodeInput(form.label_code_digits || form.unique_code);

    // 1. 必填校验
    if (!normalizedLabelCode) return Toast.fail('请填写标签编号');
    if (!isValidLabelCode(normalizedLabelCode)) {
      await Dialog.alert({
        title: '标签编号错误',
        message: '标签编号格式不正确，应为 L + 6位数字',
        messageAlign: 'left'
      });
      return;
    }
    this.setData({
      'form.unique_code': normalizedLabelCode,
      'form.label_code_digits': extractLabelCodeDigits(normalizedLabelCode),
      labelCodeError: ''
    });
    const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode, { showDialog: true });
    if (duplicateResult.duplicated) {
      return;
    }
    if (!form.product_code) return Toast.fail('请填写产品代码');
    if (!form.name) return Toast.fail('请填写物料名称');

    const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code);
    if (!normalizedCode.ok) {
        return Toast.fail(normalizedCode.msg);
    }
    const fullProductCode = normalizedCode.product_code;

    const validationMessage = getMaterialSubmitValidationMessage(form);
    if (validationMessage) {
      return Toast.fail(validationMessage);
    }

    const locationPayload = buildLocationPayload(
      form.zone_key,
      form.location_detail,
      buildZoneMap(this.data.zoneRecords)
    );

    // 2. 构造参数
    let base = {
      name: form.name,
      category: activeTab,
      sub_category: form.sub_category,
      product_code: fullProductCode,
      supplier: form.supplier,
      supplier_model: form.supplier_model || '',
      package_type: form.package_type || '' // New
    };

    let specs = {};
    let inventory = {
      batch_number: form.batch_number,
      ...locationPayload
    };

    const categoryValidationMessage = getCategorySpecificValidationMessage(activeTab, form);
    if (categoryValidationMessage) {
      return Toast.fail(categoryValidationMessage);
    }

    if (activeTab === 'chemical') {
      const normalizedUnit = normalizeUnitInput(activeTab, form.unit);
      if (!normalizedUnit.ok) {
        return Toast.fail(normalizedUnit.msg);
      }
      base.unit = normalizedUnit.unit;

      // Map net_content to quantity_val
      const qty = Number(form.net_content);
      inventory.quantity_val = qty;
      inventory.quantity_unit = base.unit;
      inventory.weight_kg = qty; // Legacy support, or just generic weight
    } else {
      const normalizedUnit = normalizeUnitInput(activeTab, form.unit);
      if (!normalizedUnit.ok) {
        return Toast.fail(normalizedUnit.msg);
      }
      base.unit = normalizedUnit.unit;
      specs.thickness_um = Number(form.thickness_um);
      specs.standard_width_mm = Number(form.width_mm);

      const length_m = Number(form.length_m);
      inventory.length_m = length_m;
      inventory.quantity_unit = base.unit;

      const normalizedFilmUnit = normalizeFilmUnit(base.unit);
      if (normalizedFilmUnit === 'm') {
          inventory.quantity_val = length_m;
      } else if (normalizedFilmUnit === 'm²') {
          inventory.quantity_val = length_m * (specs.standard_width_mm / 1000);
      } else if (normalizedFilmUnit === '卷') {
          inventory.quantity_val = 1;
      } else {
          inventory.quantity_val = 1;
      }
    }

    if (form.is_long_term_valid) {
      inventory.is_long_term_valid = true;
    } else {
      inventory.expiry_date = form.expiry_date;
    }

    this.setData({ loading: true });

    try {
      const app = getApp();
      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

      const res = await wx.cloud.callFunction({
        name: 'addMaterial',
        data: {
          base,
          specs,
          inventory,
          unique_code: normalizedLabelCode, // Pass code
          operator_name: operator
        }
      });

      if (res.result && res.result.success) {
        this.setData({ showSuccessDialog: true });
      } else {
        throw new Error(res.result.msg || 'Unknown Error');
      }

    } catch (err) {
      console.error(err);
      await Dialog.alert({
        title: '入库失败',
        message: err.message || '入库失败，请稍后重试',
        messageAlign: 'left'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 连录下一桶：只重置动态信息
  async onNextOne() {
      const { form, activeTab } = this.data;
      let syncedItem = null;
      const prefix = this.getPrefix(activeTab);

      if (form.product_code) {
          const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code);
          if (normalizedCode.ok) {
              try {
                  syncedItem = await this.fetchMaterialSuggestionByCode(normalizedCode.product_code);
              } catch (err) {
                  console.warn('[Continue Entry] Reload material master failed, fallback to local form.', err);
              }
          }
      }

      // 保留: name, supplier, location, unit, thickness, width, activeTab
      // 保留: sub_category, product_code (通常同一种物料连录，这些都不变)
      // 清空: unique_code (必须重新扫), batch_number (可能变), expiry (可能变), quantity (可能变)

      // 实际上 batch number 和 expiry 很有可能是一样的，如果是一批进货的话。
      // 用户需求："重置动态数据：标签编号、生产批号、过期日期、重量"
      // 好的，遵照需求。

      const nextForm = buildContinueEntryForm(form, activeTab, syncedItem, prefix);

      this.setData({
          form: nextForm,
          showSuccessDialog: false,
          labelCodeError: '',
          labelCodeChecking: false
      });

      wx.pageScrollTo({ scrollTop: 0 }); // 回顶方便扫码
  },

  // 返回首页
  onSuccessBack() {
    this.setData({ showSuccessDialog: false });
    wx.navigateBack();
  },

  // ============================================
  // MDM 申请建档逻辑 (Phase 1)
  // ============================================

  showRequestPopup() {
    this.setData({
        showRequestPopup: true,
        // Reset form but keep code
        'requestForm.name': '',
        'requestForm.subcategory_key': '',
        'requestForm.sub_category': '',
        'requestForm.supplier': ''
    });
  },

  onEditCode() {
      this.invalidateProductCodeLookup();
      this.setData(this.buildProductCodeResetUpdates());
  },

  onCloseRequestPopup() {
    this.setData({ showRequestPopup: false });
  },

  onRequestInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({ [`requestForm.${field}`]: e.detail });
  },

  showRequestSubCategorySheet() {
      this.setData({
          showRequestSubCategorySheet: true
      });
  },

  onRequestSubCategoryClose() {
      this.setData({ showRequestSubCategorySheet: false });
  },

  onRequestSubCategorySelect(e) {
      const item = e.detail;
      this.setData({
          'requestForm.subcategory_key': item.subcategory_key || '',
          'requestForm.sub_category': item.name,
          showRequestSubCategorySheet: false
      });
  },

  onManageSubcategories() {
      if (!this.data.canManageZones) {
        return;
      }

      wx.navigateTo({
        url: `/pages/admin/subcategory-manage/index?category=${this.data.activeTab}`
      });
  },

  async onSubmitRequest() {
      const { requestForm, form, activeTab } = this.data;

      // 1. 校验必填项
      if (!requestForm.name) return Toast.fail('请填写物料名称');
      if (!requestForm.sub_category) return Toast.fail('请选择子类别');
      const selectedSubcategory = this.data.subCategoryRecords.find((item) => (
          item.subcategory_key === requestForm.subcategory_key && isSelectableSubcategoryRecord(item)
      ));
      if (!requestForm.subcategory_key || !selectedSubcategory) {
          return Toast.fail('请选择有效子类别');
      }

      this.setData({ requestLoading: true });

      try {
          const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code);
          if (!normalizedCode.ok) {
              throw new Error(normalizedCode.msg);
          }
          const finalCode = normalizedCode.product_code;

          const res = await wx.cloud.callFunction({
              name: 'addMaterialRequest',
              data: {
                  action: 'submit',
                  product_code: finalCode,
                  category: activeTab,
                  material_name: requestForm.name,
                  subcategory_key: requestForm.subcategory_key || '',
                  sub_category: requestForm.sub_category,
                  supplier: requestForm.supplier || ''
              }
          });
          const result = (res && res.result) || {};

          if (result.success) {
              wx.showToast({ title: '申请已提交', icon: 'success' });
              this.setData({ showRequestPopup: false });
          } else {
              wx.showToast({ title: result.msg || '提交失败', icon: 'none' });
          }

      } catch(err) {
          console.error(err);
          wx.showToast({ title: '提交失败: ' + (err.message || '网络异常'), icon: 'none' });
      } finally {
          this.setData({ requestLoading: false });
      }
  }
});
