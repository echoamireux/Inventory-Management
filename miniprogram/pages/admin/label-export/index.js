import Toast from '@vant/weapp/toast/toast';
const {
  normalizeLabelExportResult
} = require('../../../utils/label-export');
const {
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  searchTestMaterialIdentitySelectorPage,
  TEST_MATERIAL_IDENTITY_SELECTOR_PAGE_SIZE
} = require('../../../utils/test-material-identity-service');
const {
  DEFAULT_ALLOWED_PREFIXES,
  sanitizeProductCodeNumberInput,
  normalizeProductCodeInput,
  findExactProductCodeMatch
} = require('../../../utils/product-code');
const {
  listProductCodePrefixes,
  buildProductCodePrefixPickerColumns
} = require('../../../utils/product-code-prefix-service');

const TEMPLATE_CATEGORY_MAP = {
  film: 'film',
  chemical: 'chemical'
};

const DEFAULT_TEMPLATE_TYPE = 'chemical';

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

function decorateSelectedState(list = [], selectedIds = []) {
  const selectedIdSet = new Set(selectedIds || []);
  return (list || []).map(item => ({
    ...item,
    _selected: selectedIdSet.has(item._id)
  }));
}

function openDocument(options = {}) {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      ...options,
      success: resolve,
      fail: reject
    });
  });
}

function buildRequestId() {
  return `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePositiveSpec(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return '';
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? String(normalized) : '';
}

function resolveMaterialFilmSpecs(item = {}) {
  const specs = item.specs || {};
  return {
    thickness_um: normalizePositiveSpec(specs.thickness_um),
    width_mm: normalizePositiveSpec(
      specs.standard_width_mm !== undefined ? specs.standard_width_mm : specs.width_mm
    )
  };
}

function decorateMaterial(item = {}) {
  const filmSpecs = resolveMaterialFilmSpecs(item);
  return {
    ...item,
    display_name: item.material_name || item.name || '--',
    display_code: item.product_code || '--',
    display_model: item.supplier_model || '',
    is_test_material: !!item.is_test_material,
    film_thickness_um: filmSpecs.thickness_um,
    film_width_mm: filmSpecs.width_mm
  };
}

function buildPreprintFormSnapshot(preprintForm = {}, templateType = DEFAULT_TEMPLATE_TYPE) {
  const material = preprintForm.selectedMaterial || {};
  return JSON.stringify({
    templateType,
    materialId: material._id || '',
    count: String(preprintForm.count || '').trim(),
    supplier_model: String(preprintForm.supplier_model || '').trim(),
    supplier_model_key: String(preprintForm.supplier_model_key || '').trim(),
    thickness_um: String(preprintForm.thickness_um || '').trim(),
    width_mm: String(preprintForm.width_mm || '').trim(),
    supplier: String(preprintForm.supplier || '').trim(),
    sample_note: String(preprintForm.sample_note || '').trim()
  });
}

function normalizePreprintCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

Page({
  options: {
    styleIsolation: 'shared'
  },

  data: {
    mode: 'preprint',
    templateType: DEFAULT_TEMPLATE_TYPE,
    preprintForm: {
      materialSearchVal: '',
      productCodeNumber: '',
      selectedMaterial: null,
      count: 1,
      supplier_model: '',
      supplier_model_key: '',
      thickness_um: '',
      width_mm: '',
      filmThicknessLocked: false,
      filmWidthLocked: false,
      supplier: '',
      sample_note: '',
      requestId: buildRequestId(),
      lastSnapshot: '',
      lastJobId: '',
      lastRecords: []
    },
    recentPreprintJobs: [],
    loadingRecentPreprints: false,
    preprintCodePrefix: 'J',
    preprintCodePrefixRecords: [],
    preprintCodePrefixOptions: [],
    showPreprintCodePrefixSheet: false,
    showPreprintCodePrefixSelector: false,
    materialSuggestions: [],
    testMaterialIdentityActions: [],
    filteredTestMaterialIdentityActions: [],
    testMaterialIdentitySearchVal: '',
    testMaterialIdentityPage: 1,
    testMaterialIdentityPageSize: TEST_MATERIAL_IDENTITY_SELECTOR_PAGE_SIZE,
    testMaterialIdentityTotal: 0,
    testMaterialIdentityIsEnd: true,
    testMaterialIdentitySearchMessage: '',
    showTestMaterialIdentitySheet: false,
    testMaterialIdentityLoading: false,
    testMaterialIdentityNotice: '',
    materialSearching: false,
    materialSearchState: '',
    creatingPreprint: false,
    exportingPreprint: false,
    voidingPreprint: false,
    searchVal: '',
    list: [],
    loading: false,
    exporting: false,
    hasLoadedOnce: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0,
    selectedIds: []
  },

  async onLoad() {
    const app = getApp();
    const currentUser = app.globalData.user;
    if (!currentUser || currentUser.status !== 'active') {
      wx.showModal({
        title: '无权限',
        content: '仅已激活用户可访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    await this.loadPreprintPrefixOptions(this.data.templateType);
    await Promise.all([
      this.getList(true),
      this.loadRecentPreprintJobs()
    ]);
  },

  async loadPreprintPrefixOptions(templateType = this.data.templateType, preferredPrefix = '') {
    const category = TEMPLATE_CATEGORY_MAP[templateType] || 'chemical';
    let records = [];
    try {
      records = await listProductCodePrefixes(false, category);
    } catch (err) {
      console.warn('加载产品代码前缀失败，使用默认前缀', err);
      records = DEFAULT_ALLOWED_PREFIXES.filter(item => item.category === category);
    }
    if (!records.length) {
      records = DEFAULT_ALLOWED_PREFIXES.filter(item => item.category === category);
    }
    const options = buildProductCodePrefixPickerColumns(records, category);
    const selectedPrefix = options.some(item => item.prefix === preferredPrefix)
      ? preferredPrefix
      : (options[0] && options[0].prefix) || (category === 'film' ? 'M' : 'J');

    this.setData({
      preprintCodePrefixRecords: records,
      preprintCodePrefixOptions: options,
      preprintCodePrefix: selectedPrefix,
      showPreprintCodePrefixSelector: options.length > 1
    });
    return selectedPrefix;
  },

  getPreprintProductCodeOptions(prefix = this.data.preprintCodePrefix) {
    return {
      prefix,
      allowedPrefixes: this.data.preprintCodePrefixRecords
    };
  },

  resetPreprintMaterialSelection(extraUpdates = {}) {
    this.materialSearchRequestId = (this.materialSearchRequestId || 0) + 1;
    this.setData({
      'preprintForm.materialSearchVal': '',
      'preprintForm.selectedMaterial': null,
      'preprintForm.supplier_model': '',
      'preprintForm.supplier_model_key': '',
      'preprintForm.material_name': '',
      'preprintForm.subcategory_key': '',
      'preprintForm.sub_category': '',
      'preprintForm.thickness_um': '',
      'preprintForm.width_mm': '',
      'preprintForm.filmThicknessLocked': false,
      'preprintForm.filmWidthLocked': false,
      'preprintForm.supplier': '',
      materialSuggestions: [],
      testMaterialIdentityActions: [],
      filteredTestMaterialIdentityActions: [],
      testMaterialIdentitySearchVal: '',
      testMaterialIdentityPage: 1,
      testMaterialIdentityTotal: 0,
      testMaterialIdentityIsEnd: true,
      testMaterialIdentitySearchMessage: '',
      showTestMaterialIdentitySheet: false,
      testMaterialIdentityNotice: '',
      ...extraUpdates
    });
  },

  showPreprintCodePrefixSheet() {
    if (!this.data.showPreprintCodePrefixSelector) {
      return;
    }
    this.setData({ showPreprintCodePrefixSheet: true });
  },

  onPreprintCodePrefixClose() {
    this.setData({ showPreprintCodePrefixSheet: false });
  },

  async onPreprintCodePrefixSelect(e) {
    const item = e.detail || {};
    const prefix = item.prefix || item.value || this.data.preprintCodePrefix;
    this.resetPreprintMaterialSelection({
      preprintCodePrefix: prefix,
      showPreprintCodePrefixSheet: false,
      materialSearchState: ''
    });
    if (this.data.preprintForm.productCodeNumber) {
      await this.confirmPreprintProductCodeLookup();
    }
  },

  onPullDownRefresh() {
    if (this.data.mode === 'reprint') {
      this.getList(true);
    } else {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom() {
    if (this.data.mode !== 'reprint' || this.data.loading || this.data.isEnd) {
      return;
    }
    this.getList(false);
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
      this.materialSearchTimer = null;
    }
    if (this.testMaterialIdentitySearchTimer) {
      clearTimeout(this.testMaterialIdentitySearchTimer);
      this.testMaterialIdentitySearchTimer = null;
    }
  },

  onModeChange(e) {
    const mode = (e.detail && e.detail.name) || e.detail || 'preprint';
    this.setData({ mode });
    if (mode === 'reprint' && !this.data.hasLoadedOnce) {
      this.getList(true);
    }
  },

  async onTemplateChange(e) {
    const templateType = (e.detail && e.detail.name) || e.detail || DEFAULT_TEMPLATE_TYPE;
    if (templateType === this.data.templateType) {
      return;
    }

    this.resetSelection();
    this.materialSearchRequestId = (this.materialSearchRequestId || 0) + 1;
    this.setData({
      templateType,
      page: 1,
      isEnd: false,
      materialSuggestions: [],
      materialSearchState: '',
      'preprintForm.materialSearchVal': '',
      'preprintForm.productCodeNumber': '',
      'preprintForm.selectedMaterial': null,
      'preprintForm.supplier_model': '',
      'preprintForm.supplier_model_key': '',
      'preprintForm.material_name': '',
      'preprintForm.subcategory_key': '',
      'preprintForm.sub_category': '',
      'preprintForm.thickness_um': '',
      'preprintForm.width_mm': '',
      'preprintForm.filmThicknessLocked': false,
      'preprintForm.filmWidthLocked': false,
      'preprintForm.supplier': '',
      'preprintForm.sample_note': '',
      'preprintForm.requestId': buildRequestId(),
      'preprintForm.lastSnapshot': '',
      'preprintForm.lastJobId': '',
      'preprintForm.lastRecords': [],
      testMaterialIdentityActions: [],
      filteredTestMaterialIdentityActions: [],
      testMaterialIdentitySearchVal: '',
      testMaterialIdentityPage: 1,
      testMaterialIdentityTotal: 0,
      testMaterialIdentityIsEnd: true,
      testMaterialIdentitySearchMessage: '',
      showTestMaterialIdentitySheet: false,
      testMaterialIdentityNotice: ''
    });
    await this.loadPreprintPrefixOptions(templateType);
    this.getList(true);
    this.loadRecentPreprintJobs();
  },

  onPreprintFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = resolveSearchValue(e && e.detail);
    if (!field) {
      return;
    }
    this.setData({
      [`preprintForm.${field}`]: value
    });
  },

  onPreprintCountChange(e) {
    const value = resolveSearchValue(e && e.detail);
    this.setData({
      'preprintForm.count': value
    });
  },

  onPreprintProductCodeInput(e) {
    const value = sanitizeProductCodeNumberInput(resolveSearchValue(e && e.detail));
    this.resetPreprintMaterialSelection({
      'preprintForm.productCodeNumber': value,
      materialSearchState: ''
    });
    if (value.length === 3) {
      this.confirmPreprintProductCodeLookup(value);
    }
  },

  async onPreprintProductCodeBlur() {
    await this.confirmPreprintProductCodeLookup();
  },

  async onPreprintProductCodeConfirm() {
    await this.confirmPreprintProductCodeLookup();
  },

  async confirmPreprintProductCodeLookup(rawInput = this.data.preprintForm.productCodeNumber) {
    const rawValue = sanitizeProductCodeNumberInput(rawInput);
    if (!rawValue) {
      this.resetPreprintMaterialSelection({
        'preprintForm.productCodeNumber': '',
        materialSearchState: ''
      });
      return;
    }

    const normalizedCode = normalizeProductCodeInput(
      TEMPLATE_CATEGORY_MAP[this.data.templateType],
      rawValue,
      this.getPreprintProductCodeOptions()
    );
    if (!normalizedCode.ok) {
      this.resetPreprintMaterialSelection({
        'preprintForm.productCodeNumber': rawValue,
        materialSearchState: 'error'
      });
      Toast.fail(normalizedCode.msg || '产品代码格式不正确');
      return;
    }

    this.setData({ 'preprintForm.productCodeNumber': normalizedCode.number });
    if (
      this.data.preprintForm.selectedMaterial
      && this.data.preprintForm.selectedMaterial.product_code === normalizedCode.product_code
    ) {
      return;
    }
    if (this._activePreprintProductCodeLookup === normalizedCode.product_code) {
      return;
    }
    await this.lookupPreprintMaterialByCode(normalizedCode.product_code);
  },

  async lookupPreprintMaterialByCode(productCode) {
    const requestId = (this.materialSearchRequestId || 0) + 1;
    this.materialSearchRequestId = requestId;
    this._activePreprintProductCodeLookup = productCode;
    this.setData({ materialSearching: true, materialSearchState: 'loading' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal: productCode,
            category: TEMPLATE_CATEGORY_MAP[this.data.templateType],
            status: 'active',
            pageSize: 10
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '查询物料失败');
      }
      const suggestions = Array.isArray(res.result.list)
        ? res.result.list.map(decorateMaterial)
        : [];
      const exactMatch = findExactProductCodeMatch(suggestions, productCode);
      if (requestId !== this.materialSearchRequestId) {
        return;
      }
      if (exactMatch) {
        this.applyPreprintMaterial(exactMatch);
        return;
      }
      this.setData({
        materialSuggestions: [],
        materialSearchState: 'empty'
      });
    } catch (error) {
      console.error(error);
      if (requestId === this.materialSearchRequestId) {
        this.setData({
          materialSuggestions: [],
          materialSearchState: 'error'
        });
      }
      Toast.fail(error.message || '查询物料失败');
    } finally {
      if (this._activePreprintProductCodeLookup === productCode) {
        this._activePreprintProductCodeLookup = '';
      }
      if (requestId === this.materialSearchRequestId) {
        this.setData({ materialSearching: false });
      }
    }
  },

  applyPreprintMaterial(item) {
    const material = decorateMaterial(item || {});
    const isFilmTemplate = this.data.templateType === 'film';
    const isFormalFilm = isFilmTemplate && !material.is_test_material;
    this.setData({
      'preprintForm.selectedMaterial': material,
      'preprintForm.materialSearchVal': `${material.display_code} ${material.display_name}`,
      'preprintForm.productCodeNumber': String(material.product_code || '').split('-')[1] || this.data.preprintForm.productCodeNumber,
      'preprintForm.supplier_model': material.is_test_material ? '' : (material.supplier_model || ''),
      'preprintForm.supplier_model_key': '',
      'preprintForm.material_name': '',
      'preprintForm.subcategory_key': '',
      'preprintForm.sub_category': '',
      'preprintForm.thickness_um': isFilmTemplate ? (material.film_thickness_um || '') : '',
      'preprintForm.width_mm': isFilmTemplate ? (material.film_width_mm || '') : '',
      'preprintForm.filmThicknessLocked': !!(isFormalFilm && material.film_thickness_um),
      'preprintForm.filmWidthLocked': !!(isFormalFilm && material.film_width_mm),
      'preprintForm.supplier': material.is_test_material ? '' : (material.supplier || ''),
      materialSuggestions: [],
      materialSearchState: '',
      testMaterialIdentityActions: [],
      filteredTestMaterialIdentityActions: [],
      testMaterialIdentitySearchVal: '',
      testMaterialIdentityPage: 1,
      testMaterialIdentityTotal: 0,
      testMaterialIdentityIsEnd: true,
      testMaterialIdentitySearchMessage: '',
      showTestMaterialIdentitySheet: false,
      testMaterialIdentityNotice: ''
    });
    if (material.is_test_material) {
      this.loadTestMaterialIdentityOptions(material);
    }
  },

  onSelectMaterial(e) {
    const item = e.currentTarget.dataset.item;
    this.applyPreprintMaterial(item);
  },

  async loadTestMaterialIdentityOptions(material, options = {}) {
    if (!material || !material.is_test_material) {
      return;
    }
    const isCurrentMaterial = () => {
      const currentMaterial = (this.data.preprintForm && this.data.preprintForm.selectedMaterial) || {};
      return !!currentMaterial.is_test_material
        && (!material._id || currentMaterial._id === material._id)
        && (!material.product_code || currentMaterial.product_code === material.product_code);
    };
    const page = Math.max(1, Number(options.page) || 1);
    const append = !!options.append;
    const searchVal = options.searchVal !== undefined ? options.searchVal : this.data.testMaterialIdentitySearchVal;
    if (append && (this.data.testMaterialIdentityLoading || this.data.testMaterialIdentityIsEnd)) {
      return;
    }
    const requestId = (this.testMaterialIdentityRequestId || 0) + 1;
    this.testMaterialIdentityRequestId = requestId;
    this.setData({
      testMaterialIdentityLoading: true,
      testMaterialIdentityNotice: ''
    });
    try {
      const result = await searchTestMaterialIdentitySelectorPage({
        material_id: material._id,
        product_code: material.product_code,
        searchVal,
        page,
        pageSize: this.data.testMaterialIdentityPageSize
      });
      if (requestId !== this.testMaterialIdentityRequestId) {
        return;
      }
      if (!isCurrentMaterial()) {
        return;
      }
      const actions = append
        ? [...this.data.testMaterialIdentityActions, ...result.actions]
        : result.actions;
      this.setData({
        testMaterialIdentityActions: actions,
        filteredTestMaterialIdentityActions: actions,
        testMaterialIdentityPage: result.page + 1,
        testMaterialIdentityPageSize: result.pageSize,
        testMaterialIdentityTotal: result.total,
        testMaterialIdentityIsEnd: result.isEnd,
        testMaterialIdentitySearchMessage: result.searchMessage || '',
        testMaterialIdentityNotice: actions.length
          ? ''
          : (searchVal ? '没有匹配的测试料型号，请换个关键词' : '当前测试料还没有已启用型号，请联系管理员维护测试料型号库')
      });
    } catch (err) {
      if (requestId !== this.testMaterialIdentityRequestId) {
        return;
      }
      if (!isCurrentMaterial()) {
        return;
      }
      this.setData({
        ...(append ? {} : {
          testMaterialIdentityActions: [],
          filteredTestMaterialIdentityActions: [],
          testMaterialIdentityTotal: 0,
          testMaterialIdentityIsEnd: true
        }),
        testMaterialIdentityNotice: err.message || '加载测试料型号失败'
      });
    } finally {
      if (requestId === this.testMaterialIdentityRequestId) {
        this.setData({ testMaterialIdentityLoading: false });
      }
    }
  },

  async showTestMaterialIdentitySheet() {
    const material = this.data.preprintForm.selectedMaterial;
    if (!material || !material.is_test_material) {
      return;
    }
    this.setData({
      showTestMaterialIdentitySheet: true,
      testMaterialIdentitySearchVal: '',
      testMaterialIdentityPage: 1,
      testMaterialIdentityTotal: 0,
      testMaterialIdentityIsEnd: false,
      testMaterialIdentitySearchMessage: '',
      testMaterialIdentityActions: [],
      filteredTestMaterialIdentityActions: []
    });
    await this.loadTestMaterialIdentityOptions(material, { page: 1, searchVal: '' });
  },

  onTestMaterialIdentityClose() {
    this.setData({ showTestMaterialIdentitySheet: false });
  },

  onTestMaterialIdentitySearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    if (this.testMaterialIdentitySearchTimer) {
      clearTimeout(this.testMaterialIdentitySearchTimer);
    }
    this.setData({
      testMaterialIdentitySearchVal: searchVal,
      testMaterialIdentityPage: 1,
      testMaterialIdentityIsEnd: false,
      testMaterialIdentitySearchMessage: ''
    });
    this.testMaterialIdentitySearchTimer = setTimeout(() => {
      this.loadTestMaterialIdentityOptions(this.data.preprintForm.selectedMaterial, {
        page: 1,
        searchVal
      });
    }, 350);
  },

  onTestMaterialIdentitySearchClear() {
    if (this.testMaterialIdentitySearchTimer) {
      clearTimeout(this.testMaterialIdentitySearchTimer);
      this.testMaterialIdentitySearchTimer = null;
    }
    this.setData({
      testMaterialIdentitySearchVal: '',
      testMaterialIdentityPage: 1,
      testMaterialIdentityIsEnd: false,
      testMaterialIdentitySearchMessage: ''
    });
    this.loadTestMaterialIdentityOptions(this.data.preprintForm.selectedMaterial, {
      page: 1,
      searchVal: ''
    });
  },

  onTestMaterialIdentityReachBottom() {
    this.loadTestMaterialIdentityOptions(this.data.preprintForm.selectedMaterial, {
      page: this.data.testMaterialIdentityPage,
      searchVal: this.data.testMaterialIdentitySearchVal,
      append: true
    });
  },

  onTestMaterialIdentitySelect(e) {
    const item = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.item)
      || e.detail
      || {};
    this.setData({
      'preprintForm.supplier_model': item.supplier_model || item.value || item.name || '',
      'preprintForm.supplier_model_key': item.supplier_model_key || '',
      ...(item.label_material_name || item.material_name ? {
        'preprintForm.material_name': item.label_material_name || item.material_name
      } : {}),
      ...(item.subcategory_key || item.sub_category ? {
        'preprintForm.subcategory_key': item.subcategory_key || '',
        'preprintForm.sub_category': item.sub_category || ''
      } : {}),
      'preprintForm.supplier': item.supplier || '',
      showTestMaterialIdentitySheet: false,
      testMaterialIdentitySearchVal: '',
      filteredTestMaterialIdentityActions: this.data.testMaterialIdentityActions,
      testMaterialIdentityNotice: ''
    });
  },

  buildCurrentPreprintPayload(requestId, preprintMode, countOverride) {
    const { preprintForm, templateType } = this.data;
    const selectedMaterial = preprintForm.selectedMaterial;
    const isTestMaterial = !!(selectedMaterial && selectedMaterial.is_test_material);
    return {
      requestId,
      preprintMode,
      previousJobId: preprintForm.lastJobId,
      templateType,
      materialId: selectedMaterial._id,
      count: countOverride || preprintForm.count,
      form: {
        supplier_model: isTestMaterial ? preprintForm.supplier_model : (selectedMaterial.supplier_model || ''),
        supplier_model_key: isTestMaterial ? preprintForm.supplier_model_key : '',
        thickness_um: preprintForm.thickness_um,
        width_mm: preprintForm.width_mm,
        supplier: isTestMaterial ? preprintForm.supplier : (selectedMaterial.supplier || ''),
        sample_note: preprintForm.sample_note
      }
    };
  },

  async ensurePreprintChangeIntent() {
    const { preprintForm, templateType } = this.data;
    if (!preprintForm.lastJobId) {
      return {
        ok: true,
        requestId: preprintForm.requestId,
        preprintMode: 'normal'
      };
    }

    const currentSnapshot = buildPreprintFormSnapshot(preprintForm, templateType);
    if (currentSnapshot === preprintForm.lastSnapshot) {
      return {
        ok: true,
        requestId: preprintForm.requestId,
        preprintMode: 'normal'
      };
    }

    const previousCount = (preprintForm.lastRecords || []).length;
    const requestedCount = normalizePreprintCount(preprintForm.count);
    const totalDelta = requestedCount > previousCount ? requestedCount - previousCount : 0;
    const itemList = [
      `填错了：作废原批${previousCount}个，重新生成${requestedCount}个`,
      `追加：保留原批${previousCount}个，再新增${requestedCount}个`
    ];
    if (totalDelta > 0) {
      itemList.push(`总数改为${requestedCount}个：只新增${totalDelta}个`);
    }

    return new Promise(resolve => {
      wx.showActionSheet({
        itemList,
        success: (res) => {
          if (res.tapIndex === 0) {
            resolve({
              ok: true,
              requestId: buildRequestId(),
              preprintMode: 'voidAndRecreate',
              previousJobId: preprintForm.lastJobId
            });
            return;
          }
          if (res.tapIndex === 2 && totalDelta > 0) {
            resolve({
              ok: true,
              requestId: buildRequestId(),
              preprintMode: 'keepAndCreate',
              countOverride: totalDelta
            });
            return;
          }
          resolve({
            ok: true,
            requestId: buildRequestId(),
            preprintMode: 'keepAndCreate'
          });
        },
        fail: () => {
          resolve({ ok: false });
        }
      });
    });
  },

  async onCreatePreprintJob() {
    if (this.data.creatingPreprint) {
      return;
    }
    const { preprintForm, templateType } = this.data;
    const selectedMaterial = preprintForm.selectedMaterial;
    if (!selectedMaterial || !selectedMaterial._id) {
      Toast.fail('请先从搜索结果中选择物料');
      return;
    }
    if (
      selectedMaterial.is_test_material
      && (!String(preprintForm.supplier_model || '').trim() || !String(preprintForm.supplier_model_key || '').trim())
    ) {
      Toast.fail('测试料必须选择已维护原厂型号');
      return;
    }
    if (templateType === 'film') {
      if (!normalizePositiveSpec(preprintForm.thickness_um)) {
        Toast.fail(selectedMaterial.is_test_material ? '测试料膜材必须填写厚度' : '请先维护膜材主数据厚度');
        return;
      }
      if (!normalizePositiveSpec(preprintForm.width_mm)) {
        Toast.fail('请填写本批次实际幅宽');
        return;
      }
    }
    if (!normalizePreprintCount(preprintForm.count)) {
      Toast.fail('请输入需要生成的标签数量');
      return;
    }

    const intent = await this.ensurePreprintChangeIntent();
    if (!intent.ok) {
      return;
    }
    await this.createAndExportPreprintJob(intent);
  },

  async createAndExportPreprintJob(intent = {}) {
    const { preprintForm, templateType } = this.data;
    this.setData({ creatingPreprint: true });
    Toast.loading({ message: '生成标签', forbidClick: true, duration: 0 });
    try {
      const cloudRes = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'createAndExportPreprintJob',
          data: this.buildCurrentPreprintPayload(intent.requestId, intent.preprintMode, intent.countOverride)
        }
      });
      const createResult = (cloudRes && cloudRes.result) || {};
      const effectiveCount = intent.countOverride || preprintForm.count;
      const snapshotForm = {
        ...preprintForm,
        count: effectiveCount
      };
      if (!createResult.success) {
        if (createResult.records && createResult.records.length) {
          this.setData({
            'preprintForm.count': effectiveCount,
            'preprintForm.requestId': intent.requestId,
            'preprintForm.lastSnapshot': buildPreprintFormSnapshot(snapshotForm, templateType),
            'preprintForm.lastJobId': createResult.job_id || '',
            'preprintForm.lastRecords': createResult.records || []
          });
          await this.loadRecentPreprintJobs();
        }
        const error = new Error(createResult.msg || '生成并导出失败');
        error.code = createResult.code;
        error.result = createResult;
        throw error;
      }
      this.setData({
        'preprintForm.count': effectiveCount,
        'preprintForm.requestId': intent.requestId,
        'preprintForm.lastSnapshot': buildPreprintFormSnapshot(snapshotForm, templateType),
        'preprintForm.lastJobId': createResult.job_id || '',
        'preprintForm.lastRecords': createResult.records || []
      });
      await this.loadRecentPreprintJobs();

      Toast.loading({ message: '导出中', forbidClick: true, duration: 0 });
      const exportResult = normalizeLabelExportResult({ result: createResult });
      await this.downloadAndOpenWorkbook(exportResult);
      Toast.success(createResult.reused ? '已重新导出原批 Excel' : '已生成并打开 Excel');
    } catch (error) {
      console.error(error);
      if ((error.result && error.result.code === 'PREPRINT_ORIGINAL_ALREADY_CHANGED') || error.code === 'PREPRINT_ORIGINAL_ALREADY_CHANGED') {
        await this.loadRecentPreprintJobs();
        Toast.fail('原批状态已变化，请从最近批次恢复或重新导出');
        return;
      }
      Toast.fail(error.message || '生成并导出失败');
    } finally {
      this.setData({ creatingPreprint: false });
    }
  },

  async exportPreprintJobById(jobId, templateType) {
    const result = normalizeLabelExportResult(await wx.cloud.callFunction({
      name: 'exportLabelData',
      data: {
        action: 'exportPreprintJob',
        data: {
          templateType,
          jobId
        }
      }
    }));
    await this.downloadAndOpenWorkbook(result);
    return result;
  },

  async onExportPreprintJob() {
    if (this.data.exportingPreprint) {
      return;
    }
    const { preprintForm, templateType } = this.data;
    if (!preprintForm.lastJobId) {
      Toast.fail('请先生成并导出标签');
      return;
    }

    this.setData({ exportingPreprint: true });
    Toast.loading({ message: '生成文件', forbidClick: true, duration: 0 });
    try {
      await this.exportPreprintJobById(preprintForm.lastJobId, templateType);
      Toast.success('文件已打开');
    } catch (error) {
      console.error('导出预生成标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exportingPreprint: false });
    }
  },

  async onVoidPreprintLabels() {
    if (this.data.voidingPreprint) {
      return;
    }
    const jobId = this.data.preprintForm.lastJobId;
    if (!jobId) {
      Toast.fail('本批没有可作废的未入库标签');
      return;
    }

    const ok = await this.voidPreprintJob(jobId);
    if (ok) {
      const nextRecords = (this.data.preprintForm.lastRecords || []).map(item => (
        item.status === 'unused' ? { ...item, status: 'voided' } : item
      ));
      this.setData({
        'preprintForm.requestId': buildRequestId(),
        'preprintForm.lastSnapshot': '',
        'preprintForm.lastJobId': '',
        'preprintForm.lastRecords': nextRecords
      });
    }
  },

  async loadRecentPreprintJobs() {
    this.setData({ loadingRecentPreprints: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'listRecentPreprintJobs',
          data: {
            templateType: this.data.templateType,
            pageSize: 5
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '加载最近批次失败');
      }
      this.setData({
        recentPreprintJobs: res.result.list || []
      });
    } catch (error) {
      console.error('加载最近预生成批次失败', error);
    } finally {
      this.setData({ loadingRecentPreprints: false });
    }
  },

  onRestorePreprintJob(e) {
    const job = e.currentTarget.dataset.item || {};
    const records = job.records || [];
    const formSnapshot = job.form_snapshot || {};
    const productCodeParts = String(job.product_code || '').split('-');
    const material = decorateMaterial({
      _id: job.material_id,
      product_code: job.product_code,
      material_name: job.material_name,
      category: job.category,
      subcategory_key: job.subcategory_key || '',
      sub_category: job.sub_category || '',
      is_test_material: !!job.is_test_material,
      specs: job.material_specs || {},
      supplier_model: formSnapshot.supplier_model || ''
    });
    const restoredForm = {
      ...this.data.preprintForm,
      materialSearchVal: `${material.display_code} ${material.display_name}`,
      productCodeNumber: productCodeParts[1] || '',
      selectedMaterial: material,
      count: job.count || records.length || 1,
      supplier_model: formSnapshot.supplier_model || '',
      supplier_model_key: formSnapshot.supplier_model_key || '',
      thickness_um: normalizePositiveSpec(formSnapshot.thickness_um),
      width_mm: normalizePositiveSpec(formSnapshot.width_mm),
      filmThicknessLocked: !!(!material.is_test_material && material.film_thickness_um),
      filmWidthLocked: !!(!material.is_test_material && material.film_width_mm),
      supplier: formSnapshot.supplier || '',
      sample_note: formSnapshot.sample_note || '',
      requestId: job.request_id || buildRequestId(),
      lastJobId: job.job_id || '',
      lastRecords: records
    };
    restoredForm.lastSnapshot = buildPreprintFormSnapshot(restoredForm, job.template_type || this.data.templateType);
    this.setData({
      preprintCodePrefix: productCodeParts[0] || this.data.preprintCodePrefix,
      preprintForm: restoredForm
    });
    Toast.success('已恢复查看本批标签');
  },

  async onExportRecentPreprintJob(e) {
    const job = e.currentTarget.dataset.item || {};
    if (!job.job_id) {
      Toast.fail('缺少预生成批次');
      return;
    }
    this.setData({ exportingPreprint: true });
    Toast.loading({ message: '生成文件', forbidClick: true, duration: 0 });
    try {
      const result = normalizeLabelExportResult(await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'exportPreprintJob',
          data: {
            templateType: job.template_type || this.data.templateType,
            jobId: job.job_id
          }
        }
      }));
      await this.downloadAndOpenWorkbook(result);
      Toast.success('文件已打开');
    } catch (error) {
      console.error('重新导出预生成标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exportingPreprint: false });
    }
  },

  async onVoidRecentPreprintJob(e) {
    const job = e.currentTarget.dataset.item || {};
    if (!job.job_id) {
      Toast.fail('本批没有可作废的未入库标签');
      return;
    }
    const ok = await this.voidPreprintJob(job.job_id);
    if (ok && job.job_id === this.data.preprintForm.lastJobId) {
      const nextRecords = (this.data.preprintForm.lastRecords || []).map(item => (
        item.status === 'unused' ? { ...item, status: 'voided' } : item
      ));
      this.setData({
        'preprintForm.requestId': buildRequestId(),
        'preprintForm.lastSnapshot': '',
        'preprintForm.lastJobId': '',
        'preprintForm.lastRecords': nextRecords
      });
    }
  },

  async voidPreprintJob(jobId) {
    if (!jobId) {
      Toast.fail('本批没有可作废的未入库标签');
      return false;
    }

    this.setData({ voidingPreprint: true });
    Toast.loading({ message: '作废标签', forbidClick: true, duration: 0 });
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'voidPreprintLabels',
          data: {
            jobId
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '作废失败');
      }
      Toast.success('已作废');
      await this.loadRecentPreprintJobs();
      return true;
    } catch (error) {
      console.error('作废预生成标签失败', error);
      Toast.fail(error.message || '作废失败');
      return false;
    } finally {
      this.setData({ voidingPreprint: false });
    }
  },

  onSearch(e) {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const searchVal = resolveSearchValue(e && e.detail);
    this.resetSelection();
    this.setData({
      searchVal,
      page: 1,
      isEnd: false
    });
    this.getList(true);
  },

  onSearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    this.setData({
      searchVal
    });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      this.resetSelection();
      this.setData({
        page: 1,
        isEnd: false
      });
      this.getList(true);
    }, 400);
  },

  onSearchClear() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    this.resetSelection();
    this.setData({
      searchVal: '',
      page: 1,
      isEnd: false
    });
    this.getList(true);
  },

  resetSelection() {
    this.setData({
      selectedIds: [],
      list: decorateSelectedState(this.data.list, [])
    });
  },

  async getList(reset = true) {
    if (!reset && this.data.loading) {
      wx.stopPullDownRefresh();
      return;
    }

    const nextPage = reset ? 1 : this.data.page;
    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const { searchVal, templateType, pageSize, list, selectedIds } = this.data;
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'list',
          data: {
            searchVal,
            templateType,
            page: nextPage,
            pageSize
          }
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载失败');
      }

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const pageList = res.result.list || [];
      const mergedList = reset ? pageList : list.concat(pageList);
      this.setData({
        list: decorateSelectedState(mergedList, selectedIds),
        total: Number(res.result.total) || mergedList.length,
        page: nextPage + 1,
        isEnd: Boolean(res.result.isEnd),
        hasLoadedOnce: true
      });
    } catch (error) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(error);
      Toast.fail(error.message || '加载失败');
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  toggleSelectItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }

    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter(item => item !== id)
      : this.data.selectedIds.concat(id);

    this.setData({
      selectedIds,
      list: decorateSelectedState(this.data.list, selectedIds)
    });
  },

  async downloadAndOpenWorkbook(result) {
    Toast.loading({ message: '下载文件', forbidClick: true, duration: 0 });
    const downRes = await wx.cloud.downloadFile({
      fileID: result.fileID
    });

    if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
      throw new Error('文件下载失败');
    }

    const localFilePath = await resolveOpenDocumentPath({
      tempFilePath: downRes.tempFilePath,
      fileName: result.fileName || '信息标签.xlsx',
      fileSystemManager: wx.getFileSystemManager(),
      userDataPath: wx.env.USER_DATA_PATH,
      fallbackFileName: '信息标签.xlsx'
    });

    Toast.clear();
    await openDocument({
      filePath: localFilePath,
      showMenu: true,
      fileType: 'xlsx'
    });
  },

  async onExportSelected() {
    if (this.data.exporting || this.data.selectedIds.length === 0) {
      if (this.data.selectedIds.length === 0) {
        Toast.fail('请先勾选需要打印的标签');
      }
      return;
    }

    this.setData({ exporting: true });
    Toast.loading({ message: '生成文件', forbidClick: true, duration: 0 });

    try {
      const result = normalizeLabelExportResult(await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'export',
          data: {
            templateType: this.data.templateType,
            selectedIds: this.data.selectedIds
          }
        }
      }));

      await this.downloadAndOpenWorkbook(result);
      Toast.success('文件已打开');
    } catch (error) {
      console.error('导出信息标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exporting: false });
    }
  }
});
