// pages/material-add/index.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
const {
  PACKAGE_TYPES,
  DEFAULT_FORM
} = require('../../utils/constants');
const {
  buildLocationZoneActions,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildLocationDetailActions,
  hasManagedLocationDetails,
  buildLocationPayload
} = require('../../utils/location-zone');
const {
  normalizeLabelCodeInput,
  sanitizeLabelCodeDigitsInput,
  extractLabelCodeDigits,
  isValidLabelCode
} = require('../../utils/label-code');
const { registerZoneManagementAccess } = require('../../utils/material-add-access');
const { listZoneConfig } = require('../../utils/zone-service');
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
  ensureOperationId,
  clearOperationId
} = require('../../utils/operation-id');
const {
  listProductCodePrefixes,
  buildProductCodePrefixPickerColumns
} = require('../../utils/product-code-prefix-service');
const {
  getMaterialSubmitValidationMessage,
  getCategorySpecificValidationMessage
} = require('../../utils/stock-form');
const { normalizeFilmUnit } = require('../../utils/film');

const DEFAULT_PREFIX_OPTIONS = [
  { prefix: 'J', category: 'chemical', status: 'active' },
  { prefix: 'S', category: 'chemical', status: 'active' },
  { prefix: 'Y', category: 'chemical', status: 'active' },
  { prefix: 'M', category: 'film', status: 'active' }
];

function extractCodePrefix(value) {
  const match = String(value || '').trim().toUpperCase().match(/^([A-Z]{1,4})-/);
  return match ? match[1] : '';
}

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

function normalizePositiveSpec(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function resolvePreprintFilmSpecs(record = {}) {
  const specs = record.specs || {};
  return {
    thickness_um: normalizePositiveSpec(specs.thickness_um),
    width_mm: normalizePositiveSpec(specs.width_mm !== undefined ? specs.width_mm : specs.standard_width_mm)
  };
}

function validatePreprintFilmSpecConsistency(form = {}) {
  const preprintSpecs = resolvePreprintFilmSpecs(form.preprint_label || {});
  if (!preprintSpecs.thickness_um && !preprintSpecs.width_mm) {
    return '';
  }

  const thicknessUm = normalizePositiveSpec(form.thickness_um);
  const widthMm = normalizePositiveSpec(form.width_mm);
  if (preprintSpecs.thickness_um && thicknessUm && thicknessUm !== preprintSpecs.thickness_um) {
    return '与预生成标签规格不一致';
  }
  if (preprintSpecs.width_mm && widthMm && widthMm !== preprintSpecs.width_mm) {
    return '与预生成标签规格不一致';
  }
  return '';
}

Page({
  data: {
    activeTab: 'chemical',
    form: { ...DEFAULT_FORM, unit: getDefaultUnit('chemical') },
    loading: false,

    // UI状态
    showRequestUnitSheet: false,
    showPackageTypeSheet: false,
    showLocationSheet: false,
    showLocationDetailSheet: false,
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
    requestForm: buildEmptyRequestForm('chemical'),

    // 联想建议
    suggestions: [],
    codePrefix: 'J',
    codePrefixRecords: [],
    codePrefixOptions: [],
    showCodePrefixSheet: false,
    showCodePrefixSelector: false,

    // 数据
    subCategoryRecords: [],
    dbZones: [],
    zoneRecords: [],
    detailRecords: [],

    locationZones: [],
    locationZoneActions: [],
    locationDetailActions: [],

    // 使用常量
    unitActions: getUnitActions('chemical'),
    packageTypeActions: PACKAGE_TYPES,
    // UI binding
    subCategoryActions: [],
    showSubCategorySheet: false,

    currentDate: new Date().getTime(),
    minDate: new Date().getTime(),
    maxDate: new Date(9999, 11, 31).getTime(),
    canManageZones: false,
    isManager: false,
    labelCodeError: '',
    labelCodeChecking: false,
    labelCodeNotice: ''
  },

  async onLoad(options) {
      const app = getApp();
      let routeLabelCode = '';
      let routeLabelFromPreprint = false;
      let initialTab = this.data.activeTab;
      let initialProductCode = '';

      if (options) {
          if (options.id) {
              const normalizedLabelCode = normalizeLabelCodeInput(options.id);
              this.setData({
                  'form.unique_code': normalizedLabelCode,
                  'form.label_code_digits': extractLabelCodeDigits(options.id),
                  labelCodeError: '',
                  labelCodeNotice: ''
              });
              routeLabelCode = normalizedLabelCode;
              routeLabelFromPreprint = options.from === 'preprint';
          }
          if (options.product_code) {
              initialProductCode = decodeURIComponent(options.product_code);
          }
          if (options.tab) {
              initialTab = options.tab;
              this.setData({
                  activeTab: options.tab,
                  'form.unit': getDefaultUnit(options.tab)
              });
          }
      }

      await this.loadPrefixOptions(initialTab, extractCodePrefix(initialProductCode));
      if (initialProductCode) {
          const normalizedCode = normalizeProductCodeInput(initialTab, initialProductCode, this.getProductCodeOptions());
          this.setData({
              'form.product_code': normalizedCode.ok
                ? normalizedCode.number
                : sanitizeProductCodeNumberInput(initialProductCode)
          });
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

      if (routeLabelCode) {
          this.initializeScannedLabelCode(routeLabelCode, {
              fromPreprint: routeLabelFromPreprint
          });
      }
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

  goToTemplateImport() {
      wx.navigateTo({
          url: '/pages/material-add/template-import/index'
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

      const normalizedCode = normalizeProductCodeInput(
        this.data.activeTab,
        this.data.form.product_code,
        this.getProductCodeOptions()
      );
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
          const zoneConfig = await listZoneConfig(this.data.activeTab, false);
          const zoneRecords = zoneConfig.zones || [];
          const detailRecords = zoneConfig.details || [];
          this.setData({
            zoneRecords,
            detailRecords,
            dbZones: zoneRecords.map(z => z.name)
          }, () => {
            this.syncSelectedZoneName(zoneRecords, detailRecords);
            this.updateZoneActions(zoneRecords);
            this.updateLocationDetailActions(this.data.form.zone_key, detailRecords);
          });

      } catch (err) {
          console.error('Load zones failed', err);
          this.setData({
            zoneRecords: [],
            detailRecords: [],
            dbZones: []
          }, () => {
            this.updateZoneActions([]);
            this.updateLocationDetailActions('', []);
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

  updateLocationDetailActions(zoneKey = this.data.form.zone_key, detailRecords = this.data.detailRecords) {
      const detailMapByZone = buildLocationDetailMapByZone(detailRecords);
      const locationDetailActions = buildLocationDetailActions(zoneKey, detailMapByZone);
      const requiresLocationDetail = locationDetailActions.length > 0;
      this.setData({
        locationDetailActions,
        'form.requires_location_detail': requiresLocationDetail
      });
      return {
        detailMapByZone,
        locationDetailActions,
        requiresLocationDetail
      };
  },

  syncSelectedZoneName(zoneRecords = this.data.zoneRecords, detailRecords = this.data.detailRecords) {
      const zoneMap = buildZoneMap(zoneRecords);
      const detailMapByZone = buildLocationDetailMapByZone(detailRecords);
      const zoneKey = this.data.form.zone_key;
      if (!zoneKey) {
        this.setData({
          locationDetailActions: [],
          'form.requires_location_detail': false
        });
        return;
      }

      const zone = zoneMap.get(zoneKey);
      if (zone) {
        const detailGroup = detailMapByZone.get(zoneKey);
        const currentDetailKey = this.data.form.location_detail_key;
        const detailRecord = currentDetailKey && detailGroup && detailGroup.byKey.get(currentDetailKey);
        this.setData({
          'form.location_zone': zone.name,
          'form.location_detail': detailRecord ? detailRecord.name : this.data.form.location_detail,
          'form.requires_location_detail': hasManagedLocationDetails(zoneKey, detailMapByZone)
        });
        return;
      }

      this.setData({
        'form.zone_key': '',
        'form.location_zone': '',
        'form.location_detail_key': '',
        'form.requires_location_detail': false,
        'form.location_detail': ''
      });
  },

  async onTabChange(e) {
    const tab = e.detail.name;
    this.invalidateProductCodeLookup();
    await this.loadPrefixOptions(tab);

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
        'form.location_detail_key': '',
        'form.requires_location_detail': false,
        'form.location_detail': '',
        labelCodeError: '',
        labelCodeChecking: false,
        labelCodeNotice: '',
        // We can keep unique_code
        suggestions: [],
        isUnknownCode: false,
        isArchived: false,
        archiveReason: '',
        showRequestPopup: false,
        showRequestUnitSheet: false,
        requestLoading: false,
        showRequestSubCategorySheet: false,
        requestForm: buildEmptyRequestForm(tab)
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

  async loadPrefixOptions(category = this.data.activeTab, preferredPrefix = '') {
      const normalizedCategory = category === 'film' ? 'film' : 'chemical';
      let records = [];
      try {
          records = await listProductCodePrefixes(false, normalizedCategory);
      } catch (err) {
          console.warn('加载产品代码前缀失败，使用默认前缀', err);
          records = DEFAULT_PREFIX_OPTIONS.filter(item => item.category === normalizedCategory);
      }
      if (!records.length) {
          records = DEFAULT_PREFIX_OPTIONS.filter(item => item.category === normalizedCategory);
      }
      const options = buildProductCodePrefixPickerColumns(records, normalizedCategory);
      const selectedPrefix = options.some(item => item.prefix === preferredPrefix)
          ? preferredPrefix
          : (options[0] && options[0].prefix) || (normalizedCategory === 'film' ? 'M' : 'J');

      this.setData({
          codePrefixRecords: records,
          codePrefixOptions: options,
          codePrefix: selectedPrefix,
          showCodePrefixSelector: options.length > 1
      });
      return selectedPrefix;
  },

  getPrefix() {
      return this.data.codePrefix || (this.data.activeTab === 'film' ? 'M' : 'J');
  },

  getProductCodeOptions(prefix = this.data.codePrefix) {
      return {
          prefix,
          allowedPrefixes: this.data.codePrefixRecords
      };
  },

  getFullProductCode(rawValue = this.data.form.product_code) {
      const normalizedCode = normalizeProductCodeInput(
          this.data.activeTab,
          rawValue,
          this.getProductCodeOptions()
      );
      return normalizedCode.ok ? normalizedCode.product_code : String(rawValue || '');
  },

  showCodePrefixSheet() {
      if (this.data.form.preprint_label_id || !this.data.showCodePrefixSelector) {
          return;
      }
      this.setData({ showCodePrefixSheet: true });
  },

  onCodePrefixClose() {
      this.setData({ showCodePrefixSheet: false });
  },

  async onCodePrefixSelect(e) {
      const item = e.detail || {};
      const prefix = item.prefix || item.value || this.data.codePrefix;
      this.invalidateProductCodeLookup();
      this.setData({
          codePrefix: prefix,
          showCodePrefixSheet: false,
          suggestions: [],
          isUnknownCode: false,
          isArchived: false,
          archiveReason: ''
      });
      if (this.data.form.product_code) {
          await this.confirmProductCodeLookup({ detail: this.data.form.product_code });
      }
  },

  buildProductCodeResetUpdates(nextProductCode = '') {
    return {
      form: buildProductCodeResetForm(this.data.activeTab, nextProductCode),
      suggestions: [],
      isUnknownCode: false,
      isArchived: false,
      archiveReason: '',
      showRequestPopup: false,
      showRequestUnitSheet: false,
      requestLoading: false,
      showRequestSubCategorySheet: false,
      requestForm: buildEmptyRequestForm(this.data.activeTab),
      labelCodeError: '',
      labelCodeChecking: false,
      labelCodeNotice: ''
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
      form.sample_note ||
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
      updates.showRequestUnitSheet = false;
      updates.requestLoading = false;
      updates.showRequestSubCategorySheet = false;
      updates.requestForm = buildEmptyRequestForm(this.data.activeTab);
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
        showRequestUnitSheet: false,
        requestLoading: false,
        showRequestSubCategorySheet: false,
        requestForm: buildEmptyRequestForm(this.data.activeTab)
      });
      return;
    }

    const normalizedCode = normalizeProductCodeInput(
      this.data.activeTab,
      rawValue,
      this.getProductCodeOptions()
    );
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
        requestForm: buildEmptyRequestForm(this.data.activeTab)
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
      showRequestUnitSheet: false,
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
      labelCodeError: '',
      labelCodeNotice: ''
    });
  },

  async onLabelCodeBlur() {
    const digits = sanitizeLabelCodeDigitsInput(this.data.form.label_code_digits);
    if (!digits) {
      this.setData({
        'form.label_code_digits': '',
        'form.unique_code': '',
        labelCodeError: '',
        labelCodeNotice: ''
      });
      return;
    }

    const normalizedLabelCode = normalizeLabelCodeInput(digits);
    this.setData({
      'form.label_code_digits': extractLabelCodeDigits(normalizedLabelCode),
      'form.unique_code': normalizedLabelCode,
      labelCodeError: '',
      labelCodeNotice: ''
    });

    if (!isValidLabelCode(normalizedLabelCode)) {
      this.setData({
        labelCodeError: '请输入6位数字编码',
        labelCodeNotice: ''
      });
      return;
    }

    const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode);
    if (duplicateResult.duplicated || duplicateResult.existingItem) {
      return;
    }

    try {
      const preprintLabel = await this.loadPreprintLabel(normalizedLabelCode);
      if (preprintLabel) {
        await this.applyPreprintLabel(preprintLabel);
        return;
      }
      this.setData({
        labelCodeNotice: '未识别预生成标签，请手动填写物料信息'
      });
    } catch (error) {
      await Dialog.alert({
        title: '预生成标签不可用',
        message: error.message || '该标签不能用于入库',
        messageAlign: 'left'
      });
    }
  },

  async checkDuplicateLabelCode(uniqueCode, options = {}) {
    const { showDialog = false } = options;
    const normalizedLabelCode = normalizeLabelCodeInput(uniqueCode);
    const currentCategory = this.data.activeTab;
    const normalizedCode = normalizeProductCodeInput(
      currentCategory,
      this.data.form.product_code,
      this.getProductCodeOptions()
    );
    const currentBatchNumber = String(this.data.form.batch_number || '').trim();

    if (!normalizedLabelCode || !isValidLabelCode(normalizedLabelCode)) {
      return {
        duplicated: false,
        uniqueCode: normalizedLabelCode
      };
    }

    this.setData({ labelCodeChecking: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getInventoryRecord',
        data: {
          action: 'checkLabel',
          unique_code: normalizedLabelCode
        }
      });
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '标签校验失败');
      }

      const existingItems = res.result.list || [];
      if (existingItems.length > 0) {
        const existingItem = existingItems[0];
        const isChemicalCandidate = (
          currentCategory === 'chemical'
          && existingItem.category === 'chemical'
          && (existingItem.status || 'in_stock') === 'in_stock'
        );
        const matchesRefillContext = (
          isChemicalCandidate
          && normalizedCode.ok
          && !!currentBatchNumber
          && String(existingItem.product_code || '').trim() === normalizedCode.product_code
          && String(existingItem.batch_number || '').trim() === currentBatchNumber
        );

        if (matchesRefillContext) {
          const noticeMessage = `当前在库已有同标签化材（${normalizedLabelCode}），提交时将确认是否按补料入库`;
          this.setData({
            labelCodeError: '',
            labelCodeNotice: showDialog ? '' : noticeMessage
          });

          if (showDialog) {
            const confirmed = await Dialog.confirm({
              title: '补料入库确认',
              message: `标签编号 ${normalizedLabelCode} 已存在。\n当前产品代码和批号与原标签一致，是否按补料入库处理？`,
              messageAlign: 'left',
              confirmButtonText: '按补料入库',
              cancelButtonText: '取消'
            }).then(() => true).catch(() => false);

            if (!confirmed) {
              return {
                duplicated: false,
                refill: false,
                cancelled: true,
                uniqueCode: normalizedLabelCode
              };
            }
          }

          return {
            duplicated: false,
            refill: true,
            uniqueCode: normalizedLabelCode,
            existingItem,
            message: noticeMessage
          };
        }

        if (isChemicalCandidate && !showDialog) {
          this.setData({
            labelCodeError: '',
            labelCodeNotice: `系统中已存在同标签在库化材（${normalizedLabelCode}），提交时会按产品代码和批号判断是否允许补料`
          });
          return {
            duplicated: false,
            refillCandidate: true,
            uniqueCode: normalizedLabelCode,
            existingItem
          };
        }

        // 膜材或非化材：保持严格冲突
        const message = isChemicalCandidate
          ? `标签编号 ${normalizedLabelCode} 已存在，仅同产品代码同批号的在库化材才可补料`
          : `标签编号 ${normalizedLabelCode} 已入库，不能重复登记`;
        this.setData({
          labelCodeError: message,
          labelCodeNotice: ''
        });

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

      this.setData({
        labelCodeError: '',
        labelCodeNotice: ''
      });
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
                 is_test_material: !!m.is_test_material,
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
      const prefix = this.getPrefix();
      const newForm = syncFormWithMaterialMaster(this.data.form, this.data.activeTab, item, prefix);

      this.setData({
          form: newForm,
          suggestions: [],
          isUnknownCode: false,
          isArchived: false,
          archiveReason: '',
          showRequestPopup: false,
          showRequestUnitSheet: false
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

  async fetchMaterialForPreprint(record, productCode) {
      const queryData = record && record.material_id
          ? { id: record.material_id }
          : { product_code: productCode };
      const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
              action: 'get',
              data: queryData
          }
      });

      if (!(res.result && res.result.success && res.result.data)) {
          throw new Error((res.result && res.result.msg) || `预生成标签对应物料 ${productCode} 不存在`);
      }

      const material = res.result.data;
      if (record.material_id && material._id && record.material_id !== material._id) {
          throw new Error('预生成标签不属于当前物料');
      }
      if (material.product_code && material.product_code !== productCode) {
          throw new Error('预生成标签不属于当前物料');
      }
      if (record.category && material.category && record.category !== material.category) {
          throw new Error('预生成标签类型与当前物料不一致');
      }

      return material;
  },

  async loadPreprintLabel(uniqueCode) {
      const res = await wx.cloud.callFunction({
          name: 'exportLabelData',
          data: {
              action: 'getPreprintLabel',
              data: {
                  unique_code: uniqueCode
              }
          }
      });

      if (!(res.result && res.result.success)) {
          throw new Error((res.result && res.result.msg) || '预生成标签校验失败');
      }

      return res.result.data || null;
  },

  async initializeScannedLabelCode(normalizedLabelCode, options = {}) {
      if (!isValidLabelCode(normalizedLabelCode)) {
          this.setData({
              labelCodeError: '标签编号格式不正确，应为 L + 6位数字',
              labelCodeNotice: ''
          });
          return;
      }

      const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode, { showDialog: false });
      if (duplicateResult.duplicated) {
          return;
      }

      try {
          const preprintLabel = await this.loadPreprintLabel(normalizedLabelCode);
          if (preprintLabel) {
              await this.applyPreprintLabel(preprintLabel);
              return;
          }
      } catch (error) {
          await Dialog.alert({
              title: '预生成标签不可用',
              message: error.message || '该标签不能用于入库',
              messageAlign: 'left'
          });
          return;
      }

      this.setData({
          labelCodeNotice: options.fromPreprint
              ? '未识别预生成标签，请手动填写物料信息'
              : '未识别预生成标签，请手动填写物料信息'
      });
  },

  async applyPreprintLabel(record) {
      if (!record || !record.product_code) {
          return false;
      }

      const nextTab = record.category === 'film' ? 'film' : 'chemical';
      const recordPrefix = extractCodePrefix(record.product_code);
      await this.loadPrefixOptions(nextTab, recordPrefix);
      const normalizedCode = validateStandardProductCode(
        nextTab,
        record.product_code,
        this.getProductCodeOptions(recordPrefix || this.data.codePrefix)
      );
      if (!normalizedCode.ok) {
          throw new Error(normalizedCode.msg || '预生成标签产品代码无效');
      }

      if (nextTab !== this.data.activeTab) {
          this.setData({
              activeTab: nextTab,
              'form.unit': getDefaultUnit(nextTab)
          });
          this.updateUnitActions(nextTab);
          await this.loadSubcategories(nextTab);
          await this.loadZones();
      }

      const material = await this.fetchMaterialForPreprint(record, normalizedCode.product_code);

      this.applyMaterialSuggestion(material, { showToast: false });
      this.setData({
          'form.unique_code': record.unique_code,
          'form.preprint_label_id': record._id || '',
          'form.label_code_digits': extractLabelCodeDigits(record.unique_code),
          codePrefix: normalizedCode.prefix,
          'form.product_code': normalizedCode.number,
          'form.supplier': record.supplier || material.supplier || '',
          'form.supplier_model': record.supplier_model || material.supplier_model || '',
          'form.sample_note': record.sample_note || '',
          'form.preprint_label': record,
          ...((nextTab === 'film') ? {
            'form.thickness_um': resolvePreprintFilmSpecs(record).thickness_um || '',
            'form.width_mm': resolvePreprintFilmSpecs(record).width_mm || ''
          } : {}),
          labelCodeError: '',
          labelCodeNotice: '已识别预生成标签，物料信息已自动带出'
      });

      Toast.success('已带出预生成标签信息');
      return true;
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
                labelCodeError: '',
                labelCodeNotice: ''
              });
              const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode);
              if (duplicateResult.duplicated) {
                return;
              }
              try {
                const preprintLabel = await this.loadPreprintLabel(normalizedLabelCode);
                if (preprintLabel) {
                    await this.applyPreprintLabel(preprintLabel);
                    return;
                }
              } catch (error) {
                await Dialog.alert({
                    title: '预生成标签不可用',
                    message: error.message || '该标签不能用于入库',
                    messageAlign: 'left'
                });
                return;
              }
              wx.showToast({ title: '扫码成功', icon: 'success' });
          },
          fail: (err) => {
              console.error(err);
          }
      });
  },

  // 申请建档默认单位选择
  showRequestUnitSheet() { this.setData({ showRequestUnitSheet: true }); },
  onRequestUnitClose() { this.setData({ showRequestUnitSheet: false }); },
  onRequestUnitSelect(e) {
    this.setData({
      'requestForm.default_unit': e.detail.name,
      showRequestUnitSheet: false
    });
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
      const zoneKey = zoneRecord ? zoneRecord.zone_key : '';
      const detailState = this.updateLocationDetailActions(zoneKey);
      this.setData({
          'form.zone_key': zoneKey,
          'form.location_zone': zone,
          'form.location_detail_key': '',
          'form.location_detail': '',
          'form.requires_location_detail': detailState.requiresLocationDetail,
          showLocationSheet: false
      });
  },

  showLocationDetailSheet() {
      if (!this.data.form.requires_location_detail) {
        return;
      }
      this.setData({ showLocationDetailSheet: true });
  },

  onLocationDetailClose() {
      this.setData({ showLocationDetailSheet: false });
  },

  onLocationDetailSelect(e) {
      const item = e.detail || {};
      this.setData({
          'form.location_detail_key': item.detail_key || '',
          'form.location_detail': item.name || '',
          showLocationDetailSheet: false
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
      return validateStandardProductCode(type, code, this.getProductCodeOptions()).ok;
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
      labelCodeError: '',
      labelCodeNotice: ''
    });
    const duplicateResult = await this.checkDuplicateLabelCode(normalizedLabelCode, { showDialog: true });
    if (duplicateResult.duplicated || duplicateResult.cancelled) {
      return;
    }
    if (!form.product_code) return Toast.fail('请填写产品代码');
    if (!form.name) return Toast.fail('请填写物料名称');

    const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code, this.getProductCodeOptions());
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
      buildZoneMap(this.data.zoneRecords),
      buildLocationDetailMapByZone(this.data.detailRecords),
      form.location_detail_key
    );

    // 2. 构造参数
    let base = {
      name: form.name,
      category: activeTab,
      sub_category: form.sub_category,
      product_code: fullProductCode,
      supplier: form.supplier,
      supplier_model: form.supplier_model || '',
      sample_note: form.sample_note || '',
      package_type: form.package_type || '' // New
    };

    let specs = {};
    let inventory = {
      batch_number: form.batch_number,
      sample_note: form.sample_note || '',
      ...locationPayload
    };

    const categoryValidationMessage = getCategorySpecificValidationMessage(activeTab, form);
    if (categoryValidationMessage) {
      return Toast.fail(categoryValidationMessage);
    }

    const preprintSpecMessage = activeTab === 'film'
      ? validatePreprintFilmSpecConsistency(form)
      : '';
    if (preprintSpecMessage) {
      return Toast.fail(preprintSpecMessage);
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

      const payload = {
          base,
          specs,
          inventory,
          unique_code: normalizedLabelCode, // Pass code
          preprint_label_id: form.preprint_label_id || '',
          submit_action: duplicateResult.refill ? 'refill' : 'create',
          refill_inventory_id: duplicateResult.refill && duplicateResult.existingItem
            ? (duplicateResult.existingItem._id || '')
            : '',
          operator_name: operator
      };
      const operationScope = 'addMaterial:single-stock-in';
      const res = await wx.cloud.callFunction({
        name: 'addMaterial',
        data: {
          ...payload,
          operation_id: ensureOperationId(operationScope, payload, 'stockin')
        }
      });

      if (res.result && res.result.success) {
        clearOperationId(operationScope);
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
      const prefix = this.getPrefix();

      if (form.product_code) {
          const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code, this.getProductCodeOptions());
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
          labelCodeChecking: false,
          labelCodeNotice: ''
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
        requestForm: buildEmptyRequestForm(this.data.activeTab)
    });
  },

  onEditCode() {
      this.invalidateProductCodeLookup();
      this.setData(this.buildProductCodeResetUpdates());
  },

  onContactAdmin() {
      wx.showToast({
          title: '请联系管理员恢复该物料后再入库',
          icon: 'none',
          duration: 2500
      });
  },

  onCloseRequestPopup() {
    this.setData({ showRequestPopup: false, showRequestUnitSheet: false });
  },

  onRequestInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({ [`requestForm.${field}`]: resolveInputValue(e.detail) });
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
      const normalizedRequestUnit = normalizeUnitInput(activeTab, requestForm.default_unit);
      if (!normalizedRequestUnit.ok || !requestForm.default_unit) {
          return Toast.fail(normalizedRequestUnit.msg || '请选择默认单位');
      }
      const selectedSubcategory = this.data.subCategoryRecords.find((item) => (
          item.subcategory_key === requestForm.subcategory_key && isSelectableSubcategoryRecord(item)
      ));
      if (!requestForm.subcategory_key || !selectedSubcategory) {
          return Toast.fail('请选择有效子类别');
      }

      this.setData({ requestLoading: true });

      try {
          const normalizedCode = normalizeProductCodeInput(activeTab, form.product_code, this.getProductCodeOptions());
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
                  supplier: requestForm.supplier || '',
                  default_unit: normalizedRequestUnit.unit
              }
          });
          const result = (res && res.result) || {};

          if (result.success) {
              wx.showToast({ title: '申请已提交', icon: 'success' });
              this.setData({ showRequestPopup: false, showRequestUnitSheet: false });
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
