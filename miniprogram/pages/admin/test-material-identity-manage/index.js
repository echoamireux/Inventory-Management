import Toast from '@vant/weapp/toast/toast';
const {
  listTestMaterialIdentities,
  setTestMaterialIdentityStatus
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
    hasLoadedOnce: false,
    searchVal: '',
    searchMessage: '',
    includeDisabled: true,
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
    if (options.keyword) {
      this.setData({
        searchVal: decodeOptionValue(options.keyword)
      });
    }
    this.loadIdentities();
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
        hasLoadedOnce: true,
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

  onShow() {
    if (this.data.hasLoadedOnce) {
      this.loadIdentities();
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
  },

  onCreateIdentity() {
    wx.navigateTo({ url: '/pages/admin/test-material-identity-edit/index' });
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
