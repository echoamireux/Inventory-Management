// pages/material-add/batch-entry.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
const {
  SEARCH_DEBOUNCE_MS,
  CATEGORY_PREFIX
} = require('../../utils/constants');
const {
  buildLocationZoneActions,
  composeLocation,
  buildZoneMap
} = require('../../utils/location-zone');
const {
  resolveBatchEntryTab,
  resolveBatchEntryTitle,
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
const { listZoneRecords } = require('../../utils/zone-service');
const { canManageZones } = require('../../utils/move-page-access');
const {
  sanitizeProductCodeNumberInput,
  normalizeProductCodeInput
} = require('../../utils/product-code');
const db = wx.cloud.database();

function resolvePickerDateValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return detail;
}

Page({
  data: {
    activeTab: 'chemical',
    list: [],
    materialCodeInput: '',
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
    defaultLocationDetail: '',
    defaultLocationDisplay: '',
    dbZones: [],
    zoneRecords: [],
    locationZoneActions: [],
    showLocationSheet: false,
    canManageZones: false,
    showDate: false,
    currentDate: new Date().getTime(),
    minDate: new Date().getTime(),
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

  getPrefix() {
      return CATEGORY_PREFIX[this.data.activeTab] || 'J-';
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

      const normalizedCode = normalizeProductCodeInput(this.data.activeTab, value);
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
      const normalizedCode = normalizeProductCodeInput(this.data.activeTab, this.data.materialCodeInput);
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
          const normalizedCode = normalizeProductCodeInput(this.data.activeTab, this.data.materialCodeInput);
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
              materialCodeInput: String(material.product_code || '').replace(this.getPrefix(), ''),
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
      if (!this.data.selectedMaterial) {
          this.showBusinessError('请先选择产品代码', '扫码前检查');
          return;
      }

      if (this.data.selectedMaterial.category === 'film' && (!this.data.filmBatchSpecsConfirmed || !(Number(this.data.currentBatchWidthMm) > 0))) {
          this.showBusinessError('请先确认本批次规格后再连续扫码', '规格确认');
          return;
      }

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

      if (!this.data.selectedMaterial) {
          this.showBusinessError('请先选择产品代码', '扫码前检查');
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
          const existsRes = await db.collection('inventory').where({
              unique_code: uniqueCode
          }).count();

          if (existsRes.total > 0) {
              Toast.clear();
              this.showBusinessError(`标签编号 ${uniqueCode} 已入库，不能重复登记`, '标签已入库');
              return;
          }

          this.addItemToList(this.data.selectedMaterial, uniqueCode);
          Toast.clear();
          Toast.success('已添加标签');
      } catch (err) {
          console.error(err);
          this.showBusinessError('标签校验失败，请稍后重试', '校验失败');
      }
  },

  addItemToList(material, uniqueCode) {
      const newItem = buildBatchListItem(material, uniqueCode, {
          defaultBatchNo: this.data.defaultBatchNo,
          defaultExpiry: this.data.defaultExpiry,
          defaultIsLongTermValid: this.data.defaultIsLongTermValid,
          defaultLocationZoneKey: this.data.defaultLocationZoneKey,
          defaultLocationZoneName: this.data.defaultLocationZone,
          defaultLocationZone: this.data.defaultLocationZone,
          defaultLocationDetail: this.data.defaultLocationDetail,
          currentBatchWidthMm: this.data.currentBatchWidthMm
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
      const detail = Object.prototype.hasOwnProperty.call(next, 'defaultLocationDetail')
          ? next.defaultLocationDetail
          : this.data.defaultLocationDetail;

      this.setData({
          ...next,
          defaultLocationZoneKey: zoneKey,
          defaultLocationDisplay: composeLocation(zone, detail)
      });
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
          showLocationSheet: false
      });
  },

  onDefaultLocationDetailChange(e) {
      this.syncDefaultLocationDisplay({ defaultLocationDetail: e.detail });
  },

  async loadZones() {
      try {
          const zoneRecords = await listZoneRecords(this.data.activeTab, false);

          this.setData({
              dbZones: zoneRecords.map((z) => z.name),
              zoneRecords,
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
                      defaultLocationDetail: ''
                  });
              }
          });
      } catch (err) {
          console.error('Load zones failed', err);
          this.setData({
              dbZones: [],
              zoneRecords: [],
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
      if (!this.data.defaultLocationZone || !this.data.defaultLocationZoneKey) {
          Toast.fail('请先选择默认存储区域');
          return;
      }

      wx.showLoading({ title: '提交中...', mask: true });

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
              defaultLocationDetail: this.data.defaultLocationDetail
          });

          const res = await wx.cloud.callFunction({
              name: 'batchAddInventory',
              data: {
                  items,
                  operator_name: operator
              }
          });

          if (res.result.success) {
              wx.hideLoading();
              Toast.success(`成功入库 ${res.result.total} 项`);
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
