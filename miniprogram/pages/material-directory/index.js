import Toast from '@vant/weapp/toast/toast';

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
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
    requestId: 0
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
      total: 0
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
          action: 'list',
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
        const newList = res.result.list || [];
        const list = refresh ? newList : [...this.data.list, ...newList];
        const isEnd = list.length >= res.result.total;

        this.setData({
          list,
          page: page + 1,
          total: res.result.total,
          isEnd
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
    this.setData({ searchVal, page: 1, isEnd: false });
    this.getList(true);
  },

  onSearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    this.setData({ searchVal, page: 1, isEnd: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.getList(true);
    }, 500);
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', page: 1, isEnd: false });
    this.getList(true);
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }
});
