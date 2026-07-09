// pages/material-add/batch-entry.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
const {
  SEARCH_DEBOUNCE_MS
} = require('../../utils/constants');
const {
  buildLocationZoneActions,
  buildLocationDetailMapByZone,
  buildLocationDetailActions,
  hasManagedLocationDetails,
  composeLocation,
  buildZoneMap
} = require('../../utils/location-zone');
const {
  resolveBatchEntryTab,
  resolveBatchEntryTitle,
  assertBatchEntryItemLimit,
  assertBatchEntryMaterialCategory,
  buildSelectedMaterialSummary,
  buildBatchListItem,
  buildBatchSubmitItems,
  findDuplicateBatchUniqueCode,
  buildBatchEmptyState
} = require('../../utils/batch-entry');
const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('../../utils/label-code');
const { listZoneConfig } = require('../../utils/zone-service');
const { canManageZones } = require('../../utils/move-page-access');
const {
  sanitizeProductCodeNumberInput,
  normalizeProductCodeInput
} = require('../../utils/product-code');
const {
  listProductCodePrefixes,
  buildProductCodePrefixPickerColumns
} = require('../../utils/product-code-prefix-service');

const DEFAULT_PREFIX_OPTIONS = [
  { prefix: 'J', category: 'chemical', status: 'active' },
  { prefix: 'S', category: 'chemical', status: 'active' },
  { prefix: 'Y', category: 'chemical', status: 'active' },
  { prefix: 'M', category: 'film', status: 'active' }
];

function extractCodePrefix(value) {
  const match = String(value || '').trim().toUpperCase().match(/^([A-Z])-/);
  return match ? match[1] : '';
}

function extractCodeNumber(value) {
  const match = String(value || '').trim().toUpperCase().match(/^[A-Z]-(\d{1,3})$/);
  return match ? match[1] : '';
}

function resolvePickerDateValue(detail) {
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

Page({
  data: {
    activeTab: 'chemical',
    list: [],
    materialCodeInput: '',
    codePrefix: 'J',
    codePrefixRecords: [],
    codePrefixOptions: [],
    showCodePrefixSheet: false,
    showCodePrefixSelector: false,
    materialSuggestions: [],
    suggestionTimer: null,
    selectedMaterial: null,
    selectedMaterialSummary: null,
    showInitialFilmSpecForm: false,
    initialFilmSpecForm: {
      thickness_um: '',
      batch_width_mm: ''
    },
    currentBatchWidthMm: '',
    filmBatchSpecsConfirmed: true,
    usesCustomBatchWidth: false,
    emptyStateDescription: buildBatchEmptyState(false),
    defaultBatchNo: '',
    defaultExpiry: '',
    defaultIsLongTermValid: false,
    defaultLocationZoneKey: '',
    defaultLocationZone: '',
    defaultLocationDetailKey: '',
    defaultLocationDetail: '',
    defaultRequiresLocationDetail: false,
    defaultLocationDisplay: '',
    dbZones: [],
    zoneRecords: [],
    detailRecords: [],
    locationZoneActions: [],
    locationDetailActions: [],
    showLocationSheet: false,
    showLocationDetailSheet: false,
    canManageZones: false,
    showDate: false,
    currentDate: new Date().getTime(),
    minDate: new Date().getTime(),
    maxDate: new Date(9999, 11, 31).getTime(),
    isScanning: false
  },

  onLoad(options) {
    const activeTab = resolveBatchEntryTab(options && options.tab);
    wx.setNavigationBarTitle({
      title: resolveBatchEntryTitle(activeTab)
    });
    const app = getApp();
    const initializePage = (user) => {
      this.setData({
        activeTab,
        canManageZones: canManageZones(user)
      }, () => {
        this.loadPrefixOptions(activeTab);
        this.loadZones();
      });
    };

    if (app.globalData.user) {
      initializePage(app.globalData.user);
    } else {
      initializePage(null);
      const previousCallback = app.userReadyCallback;
      app.userReadyCallback = (user) => {
        if (typeof previousCallback === 'function') {
          previousCallback(user);
        }
        initializePage(user);
      };
    }
    this._pageInitialized = true;
  },

  onShow() {
    if (this._pageInitialized) {
      this.loadZones();
    }
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

  showCodePrefixSheet() {
      if (!this.data.showCodePrefixSelector) {
          return;
      }
      this.setData({ showCodePrefixSheet: true });
  },

  onCodePrefixClose() {
      this.setData({ showCodePrefixSheet: false });
  },

  onCodePrefixSelect(e) {
      const item = e.detail || {};
      this.updateBatchViewState({
          codePrefix: item.prefix || item.value || this.data.codePrefix,
          showCodePrefixSheet: false,
          materialSuggestions: []
      });
  },

  buildEmptyStateDescription(selectedMaterial = this.data.selectedMaterial) {
      return buildBatchEmptyState(!!selectedMaterial);
  },

  showBusinessError(message, title = '提示') {
      Toast.clear();
      return Dialog.alert({
          title,
          message,
          messageAlign: 'left'
      });
  },

  decorateMaterialSuggestion(material) {
      const summary = buildSelectedMaterialSummary(material);
      return {
          ...material,
          _summary: summary,
          _requiresFilmSpecCompletion: !!(summary && summary.requiresFilmSpecCompletion),
          _specStatusText: summary && summary.specStatusText ? summary.specStatusText : ''
      };
  },

  updateBatchViewState(next = {}) {
      const selectedMaterial = Object.prototype.hasOwnProperty.call(next, 'selectedMaterial')
          ? next.selectedMaterial
          : this.data.selectedMaterial;
      const selectedMaterialSummary = Object.prototype.hasOwnProperty.call(next, 'selectedMaterialSummary')
          ? next.selectedMaterialSummary
          : buildSelectedMaterialSummary(selectedMaterial);
      const materialSuggestions = Object.prototype.hasOwnProperty.call(next, 'materialSuggestions')
          ? next.materialSuggestions
          : this.data.materialSuggestions;

      this.setData({
          ...next,
          selectedMaterial,
          selectedMaterialSummary,
          materialSuggestions,
          emptyStateDescription: this.buildEmptyStateDescription(selectedMaterial)
      });
  },

  validateSelectedMaterial(material) {
      const categoryCheck = assertBatchEntryMaterialCategory(this.data.activeTab, material);
      if (!categoryCheck.ok) {
          return categoryCheck;
      }

      return { ok: true };
  },

  async fetchMaterialByCode(productCode) {
      const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
              action: 'get',
              data: {
                  product_code: productCode
              }
          }
      });

      if (!(res.result && res.result.success && res.result.data)) {
          throw new Error((res.result && res.result.msg) || `未找到产品代码 ${productCode}`);
      }

      return this.decorateMaterialSuggestion(res.result.data);
  },

  async fetchMaterialForPreprint(record) {
      const productCode = String((record && record.product_code) || '').trim();
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
          throw new Error((res.result && res.result.msg) || `未找到产品代码 ${productCode}`);
      }

      const material = this.decorateMaterialSuggestion(res.result.data);
      if (record.material_id && material._id && record.material_id !== material._id) {
          throw new Error('预生成标签不属于当前物料');
      }
      if (record.product_code && material.product_code && record.product_code !== material.product_code) {
          throw new Error('预生成标签不属于当前物料');
      }
      if (record.category && material.category && record.category !== material.category) {
          throw new Error('预生成标签类型与当前物料不一致');
      }

      return material;
  },

  async searchMaterialSuggestions(productCode) {
      const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
              action: 'list',
              data: {
                  searchVal: productCode,
                  category: this.data.activeTab,
                  pageSize: 8
              }
          }
      });

      if (!(res.result && res.result.success)) {
          throw new Error((res.result && res.result.msg) || '查询物料失败');
      }

      return Array.isArray(res.result.list)
          ? res.result.list.map((item) => this.decorateMaterialSuggestion(item))
          : [];
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

  validatePreprintLabelForSelectedMaterial(record) {
      if (!record) {
          return { ok: true, overrides: {} };
      }

      const selectedMaterial = this.data.selectedMaterial;
      if (!selectedMaterial) {
          return { ok: false, msg: '非预生成标签请先选择产品代码' };
      }
      const selectedProductCode = String((selectedMaterial && selectedMaterial.product_code) || '').trim();
      if (
          (record.material_id && record.material_id !== selectedMaterial._id)
          || (record.product_code && record.product_code !== selectedProductCode)
          || (record.category && record.category !== selectedMaterial.category)
      ) {
          return {
              ok: false,
              msg: '预生成标签不属于当前物料'
          };
      }

      const overrides = {
          preprintLabelId: record._id,
          supplier: record.supplier || selectedMaterial.supplier || '',
          supplier_model: record.supplier_model || selectedMaterial.supplier_model || '',
          sample_note: record.sample_note || ''
      };

      if (selectedMaterial.category === 'film') {
          const preprintSpecs = resolvePreprintFilmSpecs(record);
          const currentWidth = normalizePositiveSpec(this.data.currentBatchWidthMm);
          const currentThickness = this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.thicknessLocked
              ? normalizePositiveSpec(this.data.selectedMaterialSummary.thicknessUm)
              : normalizePositiveSpec(this.data.initialFilmSpecForm.thickness_um);

          if (preprintSpecs.width_mm && currentWidth && currentWidth !== preprintSpecs.width_mm) {
              return { ok: false, msg: '与预生成标签规格不一致' };
          }
          if (preprintSpecs.thickness_um && currentThickness && currentThickness !== preprintSpecs.thickness_um) {
              return { ok: false, msg: '与预生成标签规格不一致' };
          }

          if (preprintSpecs.width_mm) {
              overrides.batch_width_mm = preprintSpecs.width_mm;
          }
          if (preprintSpecs.thickness_um) {
              overrides.thickness_um = preprintSpecs.thickness_um;
          }
      }

      return {
          ok: true,
          overrides
      };
  },

  validateBatchIdentityConsistency(record, overrides = {}) {
      if (!record || this.data.list.length === 0) {
          return { ok: true };
      }

      const firstItem = this.data.list[0] || {};
      const selectedMaterial = this.data.selectedMaterial || {};
      const isTestBatch = !!(selectedMaterial.is_test_material || firstItem.is_test_material || record.is_test_material);
      if (isTestBatch) {
          const firstSupplierModel = String(firstItem.supplier_model || '').trim();
          const nextSupplierModel = String(overrides.supplier_model || record.supplier_model || '').trim();
          if (firstSupplierModel && nextSupplierModel && firstSupplierModel !== nextSupplierModel) {
              return { ok: false, msg: '不同测试料原厂型号请另开一批' };
          }
      }

      if (selectedMaterial.category === 'film') {
          const firstThickness = normalizePositiveSpec(firstItem.thickness_um);
          const nextThickness = normalizePositiveSpec(overrides.thickness_um);
          const firstWidth = normalizePositiveSpec(firstItem.batch_width_mm);
          const nextWidth = normalizePositiveSpec(overrides.batch_width_mm);
          if ((firstThickness && nextThickness && firstThickness !== nextThickness)
              || (firstWidth && nextWidth && firstWidth !== nextWidth)) {
              return { ok: false, msg: '不同膜材规格请另开一批' };
          }
      }

      return { ok: true };
  },

  async applyPreprintMaterialSelection(record) {
      if (!record || !record.product_code) {
          throw new Error('非预生成标签请先选择产品代码');
      }

      const categoryCheck = assertBatchEntryMaterialCategory(this.data.activeTab, {
          category: record.category || this.data.activeTab
      });
      if (!categoryCheck.ok) {
          throw new Error('预生成标签类型与当前批量页不一致');
      }

      const material = await this.fetchMaterialForPreprint(record);
      const selectedMaterialSummary = buildSelectedMaterialSummary(material);
      const isFilm = material.category === 'film';
      const preprintSpecs = resolvePreprintFilmSpecs(record);
      const defaultBatchWidthMm = isFilm
          ? String(preprintSpecs.width_mm || selectedMaterialSummary.standardWidthMm || '')
          : '';
      const resolvedThicknessUm = isFilm
          ? String(selectedMaterialSummary.thicknessLocked
              ? (selectedMaterialSummary.thicknessUm || '')
              : (preprintSpecs.thickness_um || ''))
          : '';
      const hasFilmSnapshot = !isFilm || (!!defaultBatchWidthMm && !!resolvedThicknessUm);

      this.updateBatchViewState({
          selectedMaterial: material,
          selectedMaterialSummary,
          showInitialFilmSpecForm: isFilm && !hasFilmSnapshot,
          initialFilmSpecForm: {
              thickness_um: resolvedThicknessUm,
              batch_width_mm: defaultBatchWidthMm
          },
          currentBatchWidthMm: defaultBatchWidthMm,
          filmBatchSpecsConfirmed: !isFilm || hasFilmSnapshot,
          usesCustomBatchWidth: !!(
              isFilm
              && selectedMaterialSummary.standardWidthMm
              && defaultBatchWidthMm
              && String(selectedMaterialSummary.standardWidthMm) !== String(defaultBatchWidthMm)
          ),
          codePrefix: extractCodePrefix(material.product_code) || this.getPrefix(),
          materialCodeInput: extractCodeNumber(material.product_code),
          materialSuggestions: []
      });

      return material;
  },

  onMaterialCodeInput(e) {
      const rawValue = e && e.detail && Object.prototype.hasOwnProperty.call(e.detail, 'value')
          ? e.detail.value
          : e.detail;
      const value = sanitizeProductCodeNumberInput(rawValue);
      this.updateBatchViewState({
          materialCodeInput: value,
          materialSuggestions: value ? this.data.materialSuggestions : []
      });

      if (this.data.suggestionTimer) {
          clearTimeout(this.data.suggestionTimer);
      }

      if (!value) {
          this.updateBatchViewState({ materialSuggestions: [] });
          return;
      }

      const normalizedCode = normalizeProductCodeInput(this.data.activeTab, value, this.getProductCodeOptions());
      if (!normalizedCode.ok) {
          this.updateBatchViewState({ materialSuggestions: [] });
          return;
      }

      const timer = setTimeout(async () => {
          try {
              const suggestions = await this.searchMaterialSuggestions(normalizedCode.product_code);
              this.updateBatchViewState({ materialSuggestions: suggestions });
          } catch (err) {
              console.error(err);
              this.showBusinessError(err.message || '查询物料失败', '查询失败');
          }
      }, SEARCH_DEBOUNCE_MS);

      this.setData({ suggestionTimer: timer });
  },

  async onMaterialCodeBlur() {
      await this.tryApplyExactMaterialCode({ silent: true });
  },

  async onMaterialCodeConfirm() {
      await this.tryApplyExactMaterialCode({ silent: false });
  },

  async tryApplyExactMaterialCode(options = {}) {
      const { silent = true } = options;
      const normalizedCode = normalizeProductCodeInput(this.data.activeTab, this.data.materialCodeInput, this.getProductCodeOptions());
      if (!normalizedCode.ok) {
          return false;
      }

      if (this.data.suggestionTimer) {
          clearTimeout(this.data.suggestionTimer);
          this.setData({ suggestionTimer: null });
      }

      try {
          if (!silent) {
              Toast.loading({ message: '查询物料中...', forbidClick: true });
          }
          const material = await this.fetchMaterialByCode(normalizedCode.product_code);
          Toast.clear();
          this.applySelectedMaterial(material);
          return true;
      } catch (err) {
          Toast.clear();
          if (!silent) {
              console.error(err);
              this.showBusinessError(err.message || '查询物料失败', '查询失败');
          }
          return false;
      }
  },

  async onSearchMaterial() {
      const applied = await this.tryApplyExactMaterialCode({ silent: false });
      if (!applied) {
          const normalizedCode = normalizeProductCodeInput(this.data.activeTab, this.data.materialCodeInput, this.getProductCodeOptions());
          if (!normalizedCode.ok) {
              this.showBusinessError(normalizedCode.msg, '产品代码错误');
          }
      }
  },

  onSelectMaterialSuggestion(e) {
      const material = e.currentTarget.dataset.item;
      this.applySelectedMaterial(material);
  },

  applySelectedMaterial(material) {
      const validation = this.validateSelectedMaterial(material);
      if (!validation.ok) {
          this.showBusinessError(validation.msg, '物料选择失败');
          return;
      }

      const selectedMaterialSummary = buildSelectedMaterialSummary(material);
      const isFilm = material.category === 'film';
      const defaultBatchWidthMm = selectedMaterialSummary && selectedMaterialSummary.standardWidthMm
          ? selectedMaterialSummary.standardWidthMm
          : '';

      const commitSelection = () => {
          this.updateBatchViewState({
              selectedMaterial: material,
              selectedMaterialSummary,
              showInitialFilmSpecForm: isFilm,
              initialFilmSpecForm: {
                  thickness_um: selectedMaterialSummary && selectedMaterialSummary.thicknessLocked
                      ? selectedMaterialSummary.thicknessUm
                      : '',
                  batch_width_mm: defaultBatchWidthMm
              },
              currentBatchWidthMm: defaultBatchWidthMm,
              filmBatchSpecsConfirmed: !isFilm,
              usesCustomBatchWidth: false,
              codePrefix: extractCodePrefix(material.product_code) || this.getPrefix(),
              materialCodeInput: extractCodeNumber(material.product_code),
              materialSuggestions: []
          });
      };

      const currentProductCode = this.data.selectedMaterial && this.data.selectedMaterial.product_code;
      if (this.data.list.length > 0 && currentProductCode && currentProductCode !== material.product_code) {
          wx.showModal({
              title: '更换物料',
              content: '更换当前物料会清空待入库列表，是否继续？',
              success: (res) => {
                  if (res.confirm) {
                      commitSelection();
                      this.setData({ list: [] });
                  }
              }
          });
          return;
      }

      commitSelection();
  },

  onChangeSelectedMaterial() {
      const resetSelection = () => {
          this.updateBatchViewState({
              selectedMaterial: null,
              selectedMaterialSummary: null,
              showInitialFilmSpecForm: false,
              initialFilmSpecForm: {
                  thickness_um: '',
                  batch_width_mm: ''
              },
              currentBatchWidthMm: '',
              filmBatchSpecsConfirmed: true,
              usesCustomBatchWidth: false,
              materialCodeInput: '',
              materialSuggestions: []
          });
      };

      if (this.data.list.length > 0) {
          wx.showModal({
              title: '更换物料',
              content: '更换当前物料会清空待入库列表，是否继续？',
              success: (res) => {
                  if (res.confirm) {
                      this.setData({ list: [] });
                      resetSelection();
                  }
              }
          });
          return;
      }

      resetSelection();
  },

  onInitialFilmSpecInput(e) {
      const field = e.currentTarget.dataset.field;
      const value = e && e.detail && Object.prototype.hasOwnProperty.call(e.detail, 'value')
          ? e.detail.value
          : e.detail;
      this.setData({
          [`initialFilmSpecForm.${field}`]: value
      });
  },

  async onSaveInitialFilmSpecs() {
      const { selectedMaterial, initialFilmSpecForm } = this.data;
      if (!selectedMaterial || selectedMaterial.category !== 'film') {
          return;
      }

      const summary = this.data.selectedMaterialSummary || buildSelectedMaterialSummary(selectedMaterial);
      const batchWidthMm = Number(initialFilmSpecForm.batch_width_mm);
      const thicknessUm = summary && summary.thicknessLocked
          ? Number(summary.thicknessUm)
          : Number(initialFilmSpecForm.thickness_um);

      if (!(batchWidthMm > 0)) {
          this.showBusinessError('请填写有效的本批次实际幅宽', '规格确认');
          return;
      }
      if (!(thicknessUm > 0)) {
          this.showBusinessError('请填写有效的补录厚度', '规格确认');
          return;
      }

      if (!(summary && summary.requiresFilmSpecCompletion)) {
          const currentBatchWidthMm = String(batchWidthMm);
          Toast.success('已确认本批次幅宽');
          this.updateBatchViewState({
              showInitialFilmSpecForm: false,
              currentBatchWidthMm,
              filmBatchSpecsConfirmed: true,
              usesCustomBatchWidth: !!(summary && summary.standardWidthMm && summary.standardWidthMm !== currentBatchWidthMm),
              initialFilmSpecForm: {
                  thickness_um: summary && summary.thicknessLocked ? (summary.thicknessUm || '') : '',
                  batch_width_mm: currentBatchWidthMm
              }
          });
          return;
      }

      Toast.loading({ message: '保存规格中...', forbidClick: true });
      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'completeFilmSpecsFromInbound',
                  data: {
                      id: selectedMaterial._id,
                      thickness_um: thicknessUm,
                      batch_width_mm: batchWidthMm
                  }
              }
          });

          if (!(res.result && res.result.success)) {
              throw new Error((res.result && res.result.msg) || '规格保存失败');
          }

          const nextSpecs = Object.assign({}, selectedMaterial.specs || {}, {
              thickness_um: res.result.data.material_thickness_um,
              standard_width_mm: res.result.data.material_standard_width_mm
          });
          const nextMaterial = Object.assign({}, selectedMaterial, {
              specs: nextSpecs
          });
          const selectedMaterialSummary = buildSelectedMaterialSummary(nextMaterial);
          const currentBatchWidthMm = String(res.result.data.batch_width_mm || batchWidthMm);

          Toast.clear();
          Toast.success('已保存并开始本批次');
          this.updateBatchViewState({
              selectedMaterial: nextMaterial,
              selectedMaterialSummary,
              showInitialFilmSpecForm: false,
              currentBatchWidthMm,
              filmBatchSpecsConfirmed: true,
              usesCustomBatchWidth: !!(selectedMaterialSummary.standardWidthMm && selectedMaterialSummary.standardWidthMm !== currentBatchWidthMm),
              initialFilmSpecForm: {
                  thickness_um: selectedMaterialSummary.thicknessUm || '',
                  batch_width_mm: currentBatchWidthMm
              }
          });
      } catch (err) {
          console.error(err);
          this.showBusinessError(err.message || '规格保存失败', '规格确认');
      }
  },

  // === Scanning Logic ===
  async onScan() {
      wx.scanCode({
          onlyFromCamera: true,
          scanType: ['qrCode', 'barCode'],
          success: (res) => {
              this.handleScanResult(res.result);
          },
          fail: (err) => {
              if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
                  this.showBusinessError('未能识别标签编号，请重试', '扫码失败');
              }
          }
      });
  },

  async handleScanResult(code) {
      const uniqueCode = normalizeLabelCodeInput(code);
      if (!uniqueCode) {
          return;
      }

      if (!isValidLabelCode(uniqueCode)) {
          this.showBusinessError('标签编号格式不正确，应为 L + 6位数字', '标签编号错误');
          return;
      }

      if (findDuplicateBatchUniqueCode(this.data.list, uniqueCode)) {
          this.showBusinessError(`标签编号 ${uniqueCode} 已在待入库列表中`, '重复标签');
          return;
      }

      Toast.loading({ message: '校验标签中...', forbidClick: true });
      try {
          const existsRes = await wx.cloud.callFunction({
              name: 'getInventoryRecord',
              data: {
                  action: 'checkLabel',
                  unique_code: uniqueCode
              }
          });
          if (!existsRes.result || !existsRes.result.success) {
              throw new Error((existsRes.result && existsRes.result.msg) || '标签校验失败');
          }

          const existingItems = existsRes.result.list || [];
          if (existingItems.length > 0) {
              const existingItem = existingItems[0];
              const selectedProductCode = String((this.data.selectedMaterial && this.data.selectedMaterial.product_code) || '').trim();
              const selectedBatchNumber = String(this.data.defaultBatchNo || '').trim();
              const canRefill = (
                  !!this.data.selectedMaterial
                  &&
                  this.data.activeTab === 'chemical'
                  && existingItem.category === 'chemical'
                  && (existingItem.status || 'in_stock') === 'in_stock'
                  && String(existingItem.product_code || '').trim() === selectedProductCode
                  && String(existingItem.batch_number || '').trim() === selectedBatchNumber
              );

              if (canRefill) {
                  Toast.clear();
                  this.addItemToList(this.data.selectedMaterial, uniqueCode, {
                      submitAction: 'refill',
                      refillInventoryId: existingItem._id,
                      pendingNotice: '待补料：同标签在库化材，提交时将按补料入库'
                  });
                  wx.showToast({ title: '已加入待补料列表', icon: 'none', duration: 2000 });
                  return;
              }

              Toast.clear();
              const conflictMessage = (
                  this.data.activeTab === 'chemical'
                  && existingItem.category === 'chemical'
                  && (existingItem.status || 'in_stock') === 'in_stock'
              )
                  ? `标签编号 ${uniqueCode} 已存在，仅同产品代码同批号的在库化材才可补料`
                  : `标签编号 ${uniqueCode} 已入库，不能重复登记`;
              this.showBusinessError(conflictMessage, '标签已入库');
              return;
          }

          const preprintLabel = await this.loadPreprintLabel(uniqueCode);
          if (!this.data.selectedMaterial) {
              if (!preprintLabel) {
                  Toast.clear();
                  this.showBusinessError('非预生成标签请先选择产品代码', '扫码前检查');
                  return;
              }

              await this.applyPreprintMaterialSelection(preprintLabel);
          }

          const preprintValidation = this.validatePreprintLabelForSelectedMaterial(preprintLabel);
          if (!preprintValidation.ok) {
              Toast.clear();
              this.showBusinessError(preprintValidation.msg, '预生成标签不匹配');
              return;
          }

          const identityValidation = this.validateBatchIdentityConsistency(preprintLabel, preprintValidation.overrides);
          if (!identityValidation.ok) {
              Toast.clear();
              this.showBusinessError(identityValidation.msg, '预生成标签不匹配');
              return;
          }

          if (this.data.selectedMaterial.category === 'film') {
              const hasFilmWidth = Number(preprintValidation.overrides.batch_width_mm || this.data.currentBatchWidthMm) > 0;
              const selectedThickness = this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.thicknessLocked
                  ? this.data.selectedMaterialSummary.thicknessUm
                  : this.data.initialFilmSpecForm.thickness_um;
              const hasFilmThickness = Number(preprintValidation.overrides.thickness_um || selectedThickness) > 0;
              if (!hasFilmWidth || !hasFilmThickness) {
                  Toast.clear();
                  this.showBusinessError('请先确认本批次规格后再连续扫码', '规格确认');
                  return;
              }

              const nextState = {
                  showInitialFilmSpecForm: false,
                  filmBatchSpecsConfirmed: true
              };
              if (preprintValidation.overrides.batch_width_mm) {
                  nextState.currentBatchWidthMm = String(preprintValidation.overrides.batch_width_mm);
                  nextState['initialFilmSpecForm.batch_width_mm'] = String(preprintValidation.overrides.batch_width_mm);
              }
              if (preprintValidation.overrides.thickness_um) {
                  nextState['initialFilmSpecForm.thickness_um'] = String(preprintValidation.overrides.thickness_um);
              }
              this.updateBatchViewState(nextState);
          }

          this.addItemToList(this.data.selectedMaterial, uniqueCode, preprintValidation.overrides);
          Toast.clear();
          Toast.success('已添加标签');
      } catch (err) {
          console.error(err);
          this.showBusinessError(err.message || '标签校验失败，请稍后重试', '校验失败');
      }
  },

  addItemToList(material, uniqueCode, overrides = {}) {
      const newItem = buildBatchListItem(material, uniqueCode, {
          defaultBatchNo: this.data.defaultBatchNo,
          defaultExpiry: this.data.defaultExpiry,
          defaultIsLongTermValid: this.data.defaultIsLongTermValid,
          defaultLocationZoneKey: this.data.defaultLocationZoneKey,
          defaultLocationZoneName: this.data.defaultLocationZone,
          defaultLocationZone: this.data.defaultLocationZone,
          defaultLocationDetail: this.data.defaultLocationDetail,
          currentBatchWidthMm: overrides.batch_width_mm || this.data.currentBatchWidthMm,
          thickness_um: overrides.thickness_um,
          batch_width_mm: overrides.batch_width_mm,
          preprintLabelId: overrides.preprintLabelId,
          supplier: overrides.supplier,
          supplier_model: overrides.supplier_model,
          sample_note: overrides.sample_note,
          submitAction: overrides.submitAction,
          refillInventoryId: overrides.refillInventoryId,
          pendingNotice: overrides.pendingNotice
      });

      this.setData({
          list: [newItem, ...this.data.list]
      });
  },

  // === List Management ===
  onRemoveItem(e) {
      const index = e.currentTarget.dataset.index;
      const list = this.data.list.slice();
      list.splice(index, 1);
      const nextState = { list };
      if (list.length === 0 && this.data.selectedMaterial && this.data.selectedMaterial.category === 'film') {
          nextState.showInitialFilmSpecForm = true;
          nextState.filmBatchSpecsConfirmed = false;
          nextState.initialFilmSpecForm = {
              thickness_um: this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.thicknessLocked
                  ? (this.data.selectedMaterialSummary.thicknessUm || '')
                  : '',
              batch_width_mm: this.data.currentBatchWidthMm || (this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.standardWidthMm) || ''
          };
      }
      this.setData(nextState);
  },

  clearList() {
      wx.showModal({
          title: '确认清空',
          content: '确定要清空所有待入库项吗？',
          success: (res) => {
              if (res.confirm) {
                  const nextState = { list: [] };
                  if (this.data.selectedMaterial && this.data.selectedMaterial.category === 'film') {
                      nextState.showInitialFilmSpecForm = true;
                      nextState.filmBatchSpecsConfirmed = false;
                      nextState.initialFilmSpecForm = {
                          thickness_um: this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.thicknessLocked
                              ? (this.data.selectedMaterialSummary.thicknessUm || '')
                              : '',
                          batch_width_mm: this.data.currentBatchWidthMm || (this.data.selectedMaterialSummary && this.data.selectedMaterialSummary.standardWidthMm) || ''
                      };
                  }
                  this.setData(nextState);
              }
          }
      });
  },

  onQtyChange(e) {
      const index = e.currentTarget.dataset.index;
      const val = e.detail;
      const list = this.data.list;
      list[index].quantity.val = val;
      this.setData({ list });
  },

  // === Bulk Settings ===
  onDefaultBatchChange(e) {
      this.setData({ defaultBatchNo: e.detail });
  },

  syncDefaultLocationDisplay(next = {}) {
      const zoneKey = Object.prototype.hasOwnProperty.call(next, 'defaultLocationZoneKey')
          ? next.defaultLocationZoneKey
          : this.data.defaultLocationZoneKey;
      const zone = Object.prototype.hasOwnProperty.call(next, 'defaultLocationZone')
          ? next.defaultLocationZone
          : this.data.defaultLocationZone;
      const detailKey = Object.prototype.hasOwnProperty.call(next, 'defaultLocationDetailKey')
          ? next.defaultLocationDetailKey
          : this.data.defaultLocationDetailKey;
      const detail = Object.prototype.hasOwnProperty.call(next, 'defaultLocationDetail')
          ? next.defaultLocationDetail
          : this.data.defaultLocationDetail;
      const detailState = this.buildDefaultLocationDetailState(zoneKey, {
          defaultLocationDetailKey: detailKey,
          defaultLocationDetail: detail
      });

      this.setData({
          ...next,
          defaultLocationZoneKey: zoneKey,
          defaultLocationDetailKey: detailState.defaultLocationDetailKey,
          defaultLocationDetail: detailState.defaultLocationDetail,
          defaultRequiresLocationDetail: detailState.defaultRequiresLocationDetail,
          locationDetailActions: detailState.locationDetailActions,
          defaultLocationDisplay: composeLocation(zone, detailState.defaultLocationDetail)
      });
  },

  buildDefaultLocationDetailState(zoneKey, next = {}) {
      const detailMapByZone = buildLocationDetailMapByZone(this.data.detailRecords);
      const locationDetailActions = buildLocationDetailActions(zoneKey, detailMapByZone);
      const defaultRequiresLocationDetail = hasManagedLocationDetails(zoneKey, detailMapByZone);
      const currentDetailKey = String(
          Object.prototype.hasOwnProperty.call(next, 'defaultLocationDetailKey')
              ? next.defaultLocationDetailKey
              : this.data.defaultLocationDetailKey
      ).trim();
      const currentDetail = String(
          Object.prototype.hasOwnProperty.call(next, 'defaultLocationDetail')
              ? next.defaultLocationDetail
              : this.data.defaultLocationDetail
      ).trim();
      const detailGroup = detailMapByZone.get(String(zoneKey || '').trim());
      const detailRecord = currentDetailKey && detailGroup && detailGroup.byKey.get(currentDetailKey);

      return {
          locationDetailActions,
          defaultRequiresLocationDetail,
          defaultLocationDetailKey: detailRecord ? detailRecord.detail_key : (defaultRequiresLocationDetail ? '' : currentDetailKey),
          defaultLocationDetail: detailRecord ? detailRecord.name : (defaultRequiresLocationDetail ? '' : currentDetail)
      };
  },

  showLocationSheet() {
      this.setData({ showLocationSheet: true });
  },

  onLocationClose() {
      this.setData({ showLocationSheet: false });
  },

  onLocationSelect(e) {
      const zone = e.detail.name;
      const zoneRecord = this.data.zoneRecords.find(item => item.name === zone);
      this.syncDefaultLocationDisplay({
          defaultLocationZoneKey: zoneRecord ? zoneRecord.zone_key : '',
          defaultLocationZone: zone,
          defaultLocationDetailKey: '',
          defaultLocationDetail: '',
          showLocationSheet: false
      });
  },

  showLocationDetailSheet() {
      if (!this.data.defaultRequiresLocationDetail) {
          return;
      }
      this.setData({ showLocationDetailSheet: true });
  },

  onLocationDetailClose() {
      this.setData({ showLocationDetailSheet: false });
  },

  onLocationDetailSelect(e) {
      const item = e.detail || {};
      this.syncDefaultLocationDisplay({
          defaultLocationDetailKey: item.detail_key || '',
          defaultLocationDetail: item.name || '',
          showLocationDetailSheet: false
      });
  },

  onDefaultLocationDetailChange(e) {
      this.syncDefaultLocationDisplay({ defaultLocationDetail: e.detail });
  },

  async loadZones() {
      try {
          const zoneConfig = await listZoneConfig(this.data.activeTab, false);
          const zoneRecords = zoneConfig.zones || [];
          const detailRecords = zoneConfig.details || [];

          this.setData({
              dbZones: zoneRecords.map((z) => z.name),
              zoneRecords,
              detailRecords,
              locationZoneActions: buildLocationZoneActions(zoneRecords, this.data.canManageZones)
          }, () => {
              const zoneMap = buildZoneMap(zoneRecords);
              if (this.data.defaultLocationZoneKey && zoneMap.has(this.data.defaultLocationZoneKey)) {
                  this.syncDefaultLocationDisplay({
                      defaultLocationZone: zoneMap.get(this.data.defaultLocationZoneKey).name
                  });
              } else if (this.data.defaultLocationZoneKey) {
                  this.syncDefaultLocationDisplay({
                      defaultLocationZoneKey: '',
                      defaultLocationZone: '',
                      defaultLocationDetailKey: '',
                      defaultLocationDetail: ''
                  });
              } else {
                  this.syncDefaultLocationDisplay({});
              }
          });
      } catch (err) {
          console.error('Load zones failed', err);
          this.setData({
              dbZones: [],
              zoneRecords: [],
              detailRecords: [],
              locationDetailActions: [],
              defaultRequiresLocationDetail: false,
              locationZoneActions: buildLocationZoneActions([], this.data.canManageZones)
          });
          Toast.fail(err.message || '加载库区失败');
      }
  },

  onManageZones() {
      if (!this.data.canManageZones) {
          return;
      }

      wx.navigateTo({
          url: `/pages/admin/zone-manage/index?category=${this.data.activeTab}`
      });
  },

  showDatePicker() {
      if (this.data.defaultIsLongTermValid) {
          return;
      }
      this.setData({ showDate: true });
  },

  onDateClose() {
      this.setData({ showDate: false });
  },

  onDateConfirm(e) {
      const date = new Date(resolvePickerDateValue(e.detail));
      const str = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      this.setData({
          defaultExpiry: str,
          defaultIsLongTermValid: false,
          showDate: false
      });
  },

  onDefaultLongTermChange(e) {
      const checked = typeof e.detail === 'boolean'
          ? e.detail
          : !!(e.detail && e.detail.value);
      this.setData({
          defaultIsLongTermValid: checked,
          defaultExpiry: checked ? '' : this.data.defaultExpiry,
          showDate: false
      });
  },

  // === Submit ===
  async onSubmit() {
      if (this.data.list.length === 0) return;
      try {
          assertBatchEntryItemLimit(this.data.list.length);
      } catch (err) {
          Toast.fail(err.message || '单次批量入库数量过多');
          return;
      }
      if (!this.data.defaultLocationZone || !this.data.defaultLocationZoneKey) {
          Toast.fail('请先选择默认存储区域');
          return;
      }
      if (this.data.defaultRequiresLocationDetail && !this.data.defaultLocationDetailKey) {
          Toast.fail('请选择详细坐标');
          return;
      }

      try {
          const app = getApp();
          const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

          const items = buildBatchSubmitItems(this.data.list, {
              defaultBatchNo: this.data.defaultBatchNo,
              defaultExpiry: this.data.defaultExpiry,
              defaultIsLongTermValid: this.data.defaultIsLongTermValid,
              defaultLocationZoneKey: this.data.defaultLocationZoneKey,
              defaultLocationZoneName: this.data.defaultLocationZone,
              defaultLocationZone: this.data.defaultLocationZone,
              defaultLocationDetailKey: this.data.defaultLocationDetailKey,
              defaultLocationDetail: this.data.defaultLocationDetail
          });
          const refillCount = items.filter(item => item.submit_action === 'refill').length;
          const createCount = items.length - refillCount;
          const confirmLines = [];

          if (createCount > 0) {
              confirmLines.push(`本次将新增 ${createCount} 条`);
          }
          if (refillCount > 0) {
              confirmLines.push(`本次将补料 ${refillCount} 条`);
          }
          confirmLines.push('是否继续？');

          const confirmed = await Dialog.confirm({
              title: '确认入库',
              message: confirmLines.join('\n'),
              messageAlign: 'left'
          }).then(() => true).catch(() => false);

          if (!confirmed) {
              return;
          }

          wx.showLoading({ title: '提交中...', mask: true });

          const res = await wx.cloud.callFunction({
              name: 'batchAddInventory',
              data: {
                  items,
                  operator_name: operator
              }
          });

          if (res.result.success) {
              wx.hideLoading();
              const successParts = [];
              if (createCount > 0) {
                  successParts.push(`新增 ${createCount} 条`);
              }
              if (refillCount > 0) {
                  successParts.push(`补料 ${refillCount} 条`);
              }
              Toast.success(successParts.length ? successParts.join('，') : `成功入库 ${res.result.total} 项`);
              this.setData({ list: [] });

              // Navigate back or stay?
              setTimeout(() => {
                  wx.navigateBack();
              }, 1500);
          } else {
              throw new Error(res.result.msg);
          }
      } catch (err) {
          console.error(err);
          wx.hideLoading();
          this.showBusinessError(err.message || '批量入库失败', '入库失败');
      }
  }
});
