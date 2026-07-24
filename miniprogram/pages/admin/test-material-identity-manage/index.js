import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  listTestMaterialIdentities,
  createTestMaterialIdentity,
  setTestMaterialIdentityStatus,
  normalizeTestMaterialSupplierModel
} = require('../../../utils/test-material-identity-service');

function getInputValue(e) {
  if (e && e.detail && e.detail.value !== undefined) {
    return e.detail.value;
  }
  if (e && e.detail !== undefined) {
    return e.detail;
  }
  return '';
}

function decodeOptionValue(value) {
  const raw = String(value || '');
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

Page({
  data: {
    identities: [],
    total: 0,
    loading: false,
    searchVal: '',
    searchMessage: '',
    includeDisabled: true,
    formVisible: false,
    formSubmitting: false,
    materialSearching: false,
    materialSuggestions: [],
    formSupplierModelError: '',
    form: {
      material_id: '',
      product_code: '',
      material_name: '',
      category: '',
      materialSearchVal: '',
      supplier_model: ''
    },
    searchRequestId: 0
  },

  onLoad(options = {}) {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    if (options.action === 'import') {
      wx.redirectTo({ url: '/pages/admin/test-material-identity-import/index' });
      return;
    }
    if (options.keyword) {
      this.setData({
        searchVal: decodeOptionValue(options.keyword)
      });
    }
    this.loadIdentities().then(() => {
      if (options.action === 'create') {
        setTimeout(() => this.onCreateIdentity(), 0);
      }
    });
  },

  async loadIdentities() {
    const requestId = (this.data.searchRequestId || 0) + 1;
    this.setData({ loading: true, searchRequestId: requestId });
    try {
      const result = await listTestMaterialIdentities({
        includeDisabled: this.data.includeDisabled,
        searchVal: this.data.searchVal,
        pageSize: 100
      });
      if (this.data.searchRequestId !== requestId) return;
      this.setData({
        identities: result.list,
        total: result.total,
        searchMessage: this.data.searchVal ? (result.searchMessage || '') : ''
      });
    } catch (err) {
      Toast.fail(err.message || '加载测试料型号失败');
    } finally {
      if (this.data.searchRequestId === requestId) {
        this.setData({ loading: false });
      }
    }
  },

  onSearchChange(e) {
    const searchVal = getInputValue(e);
    this.setData({ searchVal, searchMessage: '' });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadIdentities(), 400);
  },

  onSearchConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.loadIdentities();
  },

  onClearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', searchMessage: '' });
    this.loadIdentities();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.materialSearchTimer) clearTimeout(this.materialSearchTimer);
  },

  onCreateIdentity() {
    this.setData({
      formVisible: true,
      formSupplierModelError: '',
      materialSuggestions: [],
      form: {
        material_id: '',
        product_code: '',
        material_name: '',
        category: '',
        materialSearchVal: '',
        supplier_model: ''
      }
    });
  },

  onCloseForm() {
    if (this.data.formSubmitting) return;
    this.setData({ formVisible: false });
  },

  onMaterialSearchInput(e) {
    const value = getInputValue(e);
    this.setData({
      'form.materialSearchVal': value
    });
    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
    }
    this.materialSearchTimer = setTimeout(() => {
      this.searchTestMaterials(value);
    }, 300);
  },

  async searchTestMaterials(keyword) {
    const value = String(keyword || '').trim();
    if (!value) {
      this.setData({ materialSuggestions: [] });
      return;
    }
    this.setData({ materialSearching: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal: value,
            pageSize: 20
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '查询物料失败');
      }
      const suggestions = (res.result.list || [])
        .filter(item => item.is_test_material && item.status !== 'archived')
        .map(item => ({
          _id: item._id,
          product_code: item.product_code,
          material_name: item.material_name || item.name || '',
          category: item.category
        }));
      this.setData({ materialSuggestions: suggestions });
    } catch (err) {
      Toast.fail(err.message || '查询物料失败');
    } finally {
      this.setData({ materialSearching: false });
    }
  },

  onSelectMaterial(e) {
    const item = e.currentTarget.dataset.item || {};
    this.setData({
      'form.material_id': item._id || '',
      'form.product_code': item.product_code || '',
      'form.material_name': item.material_name || '',
      'form.category': item.category || '',
      'form.materialSearchVal': `${item.product_code || ''} ${item.material_name || ''}`.trim(),
      materialSuggestions: []
    });
  },

  onSupplierModelInput(e) {
    const value = normalizeTestMaterialSupplierModel(getInputValue(e));
    this.setData({
      'form.supplier_model': value,
      formSupplierModelError: value ? '' : '请输入原厂型号'
    });
  },

  async submitForm(confirmSimilar = false) {
    const form = this.data.form;
    const supplierModel = normalizeTestMaterialSupplierModel(form.supplier_model);
    if (!form.material_id && !form.product_code) {
      Toast.fail('请先选择测试料主数据');
      return;
    }
    if (!supplierModel) {
      this.setData({ formSupplierModelError: '请输入原厂型号' });
      Toast.fail('请输入原厂型号');
      return;
    }

    this.setData({ formSubmitting: true });
    try {
      await createTestMaterialIdentity({
        material_id: form.material_id,
        product_code: form.product_code,
        supplier_model: supplierModel,
        confirmSimilar
      });
      Toast.success('创建成功');
      this.setData({ formVisible: false });
      await this.loadIdentities();
    } catch (err) {
      if (err.code === 'SIMILAR_TEST_MATERIAL_IDENTITY') {
        const confirmed = await Dialog.confirm({
          title: '发现相似型号',
          message: err.message || '已存在相似型号，是否仍要新增？',
          messageAlign: 'left',
          confirmButtonText: '仍要新增',
          cancelButtonText: '取消'
        }).then(() => true).catch(() => false);
        if (confirmed) {
          await this.submitForm(true);
        }
        return;
      }
      Toast.fail(err.message || '创建失败');
    } finally {
      this.setData({ formSubmitting: false });
    }
  },

  onSubmitForm() {
    this.submitForm(false);
  },

  async onToggleStatus(e) {
    const record = this.data.identities[e.currentTarget.dataset.index];
    if (!record) return;
    const nextStatus = record.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';
    try {
      await setTestMaterialIdentityStatus(record, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadIdentities();
    } catch (err) {
      Toast.fail(err.message || `${actionLabel}失败`);
    }
  }
});
