import Toast from '@vant/weapp/toast/toast';

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

function buildDirectoryDisplayItem(item = {}) {
  const isTestIdentity = !!item.is_test_identity || item.directory_kind === 'test_identity';
  const productCode = String(item.product_code || '').trim();
  const supplierModel = String(item.supplier_model || '').trim();
  const subCategory = String(item.display_sub_category || item.sub_category || '').trim();
  const displayTitle = String(item.display_title || supplierModel || productCode || '').trim();
  const displayName = String(
    item.display_name
      || item.label_material_name
      || item.material_name
      || item.name
      || (isTestIdentity ? '未命名测试料' : '')
  ).trim();
  const displayMeta = String(item.display_meta || '').trim()
    || [
      subCategory ? `子类别：${subCategory}` : '子类别：-',
      isTestIdentity && productCode ? `测试料代码：${productCode}` : ''
    ].filter(Boolean).join(' ｜ ');

  return {
    ...item,
    directory_key: item.directory_key || `${isTestIdentity ? 'identity' : 'material'}:${item._id || item.identity_key || productCode || supplierModel || ''}`,
    is_test_identity: isTestIdentity,
    display_title: displayTitle || '-',
    display_name: displayName || '-',
    display_meta: displayMeta || '子类别：-'
  };
}

Page({
  data: {
    activeTab: 'all',
    list: [],
    searchVal: '',
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0,
    searchMessage: ''
  },

  onLoad() {
    this.getList(true);
  },

  onPullDownRefresh() {
    this.getList(true);
  },

  onReachBottom() {
    if (!this.data.isEnd && !this.data.loading) {
      this.loadMore();
    }
  },

  onTabChange(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      activeTab: e.detail.name,
      page: 1,
      isEnd: false,
      total: 0,
      searchMessage: ''
    }, () => {
      this.getList(true);
    });
  },

  async getList(refresh = false) {
    if (!refresh && this.data.loading) return;

    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });
    if (refresh) Toast.loading({ message: '加载中...', forbidClick: true });

    try {
      const page = refresh ? 1 : this.data.page;
      const { searchVal, pageSize, activeTab } = this.data;

      let category = '';
      if (activeTab !== 'all') {
          category = activeTab;
      }

      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'directoryList',
          data: {
            searchVal,
            page,
            pageSize,
            category
          }
        }
      });

      if (res.result.success) {
        if (this.data.requestId !== currentRequestId) {
          return;
        }
        const newList = (res.result.list || []).map(buildDirectoryDisplayItem);
        const list = refresh ? newList : [...this.data.list, ...newList];
        const isEnd = list.length >= res.result.total;

        this.setData({
          list,
          page: page + 1,
          total: res.result.total,
          isEnd,
          searchMessage: searchVal ? (res.result.searchMessage || '') : ''
        });
      } else {
        Toast.fail(res.result.msg || '加载失败');
      }
    } catch (err) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(err);
      Toast.fail('网络错误');
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
        Toast.clear();
      }
      wx.stopPullDownRefresh();
    }
  },

  loadMore() {
    this.getList(false);
  },

  onSearch(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal, page: 1, isEnd: false, searchMessage: '' });
    this.getList(true);
  },

  onSearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    this.setData({ searchVal, page: 1, isEnd: false, searchMessage: '' });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.getList(true);
    }, 400);
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', page: 1, isEnd: false, searchMessage: '' });
    this.getList(true);
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }
});
