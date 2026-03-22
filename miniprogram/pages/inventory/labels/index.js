const { loadBatchLabelPage } = require('../../../utils/inventory-label-query');

Page({
  data: {
    list: [],
    loading: false,
    hasLoadedOnce: false,
    queryCode: '',
    queryName: '',
    batchNumber: '',
    category: '',
    lastSeenInventoryChangeAt: 0,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0
  },

  onLoad(options) {
    const batchNumber = decodeURIComponent(options.batch || '');
    const queryCode = decodeURIComponent(options.code || '');
    const queryName = decodeURIComponent(options.name || '');
    const category = options.category || '';

    this.setData({
      batchNumber,
      queryCode,
      queryName,
      category
    });

    wx.setNavigationBarTitle({
      title: batchNumber || '标签列表'
    });
  },

  onShow() {
    const app = getApp();
    const inventoryChangedAt = (app.globalData && app.globalData.inventoryChangedAt) || 0;

    if (!this.data.hasLoadedOnce) {
      this.getList(true);
      return;
    }

    if (inventoryChangedAt && inventoryChangedAt !== this.data.lastSeenInventoryChangeAt) {
      this.getList(true);
    }
  },

  onPullDownRefresh() {
    this.getList(true);
  },

  onReachBottom() {
    if (this.data.loading || this.data.isEnd) {
      return;
    }
    this.getList(false);
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
      const { batchNumber, queryCode, queryName, category, pageSize, list } = this.data;
      const result = await loadBatchLabelPage({
        batchNumber,
        productCode: queryCode,
        materialName: queryName,
        category,
        page: nextPage,
        pageSize
      });

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const pageList = result.list || [];
      const mergedList = reset ? pageList : list.concat(pageList);
      const total = Number(result.total) || mergedList.length;
      this.setData({
        list: mergedList,
        total,
        page: nextPage + 1,
        isEnd: mergedList.length >= total,
        hasLoadedOnce: true,
        lastSeenInventoryChangeAt: (getApp().globalData && getApp().globalData.inventoryChangedAt) || 0
      });
    } catch (error) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/inventory-detail/index?id=${id}`
    });
  }
});
