import Toast from '@vant/weapp/toast/toast';

Page({
  data: {
    activeTab: 'all',
    list: [],
    searchVal: '',
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false
  },

  onLoad() {
    this.getList();
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
    this.setData({
      activeTab: e.detail.name,
      page: 1,
      list: [],
      isEnd: false,
      total: 0
    }, () => {
      this.getList(true);
    });
  },

  async getList(refresh = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });
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
        const newList = res.result.list || [];
        const list = refresh ? newList : [...this.data.list, ...newList];
        const isEnd = list.length >= res.result.total;

        this.setData({
          list,
          page,
          total: res.result.total,
          isEnd
        });
      } else {
        Toast.fail(res.result.msg || '加载失败');
      }
    } catch (err) {
      console.error(err);
      Toast.fail('网络错误');
    } finally {
      this.setData({ loading: false });
      Toast.clear();
      wx.stopPullDownRefresh();
    }
  },

  loadMore() {
    this.setData({ page: this.data.page + 1 });
    this.getList();
  },

  onSearch(e) {
    this.setData({ searchVal: e.detail || '' });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
        this.getList(true);
    }, 500);
  },

  onSearchClear() {
    this.setData({ searchVal: '' });
    this.getList(true);
  },

  onItemClick(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
        url: `/pages/material-detail/index?id=${id}`,
      });
  }
});
