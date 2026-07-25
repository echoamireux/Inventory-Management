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
    searchRequestId: 0,
    page: 1,
    pageSize: 20,
    isEnd: true
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
    this.loadIdentities({ refresh: true });
  },

  async loadIdentities(options = {}) {
    const refresh = !!options.refresh;
    if (this.data.loading && !refresh) {
      return;
    }
    const requestId = (this.data.searchRequestId || 0) + 1;
    const page = refresh ? 1 : this.data.page;
    this.setData({ loading: true, searchRequestId: requestId });
    try {
      const result = await listTestMaterialIdentities({
        includeDisabled: this.data.includeDisabled,
        searchVal: this.data.searchVal,
        page,
        pageSize: this.data.pageSize
      });
      if (this.data.searchRequestId !== requestId) return;
      const nextList = refresh
        ? result.list
        : [...this.data.identities, ...(result.list || [])];
      const total = Number(result.total) || 0;
      this.setData({
        identities: nextList,
        total,
        page: page + 1,
        pageSize: Number(result.pageSize) || this.data.pageSize,
        isEnd: nextList.length >= total || (result.list || []).length === 0,
        hasLoadedOnce: true,
        searchMessage: this.data.searchVal ? (result.searchMessage || '') : ''
      });
    } catch (err) {
      if (this.data.searchRequestId === requestId) {
        Toast.fail(err.message || '加载测试料型号失败');
      }
    } finally {
      if (this.data.searchRequestId === requestId) {
        this.setData({ loading: false });
      }
    }
  },

  onShow() {
    if (this.data.hasLoadedOnce) {
      this.loadIdentities({ refresh: true });
    }
  },

  onSearchChange(e) {
    const searchVal = getInputValue(e);
    this.setData({ searchVal, searchMessage: '', page: 1, isEnd: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadIdentities({ refresh: true }), 400);
  },

  onSearchConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.loadIdentities({ refresh: true });
  },

  onClearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', searchMessage: '', page: 1, isEnd: false });
    this.loadIdentities({ refresh: true });
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.isEnd) {
      this.loadIdentities();
    }
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
      await this.loadIdentities({ refresh: true });
    } catch (err) {
      Toast.fail(err.message || `${actionLabel}失败`);
    }
  }
});
