// pages/inventory/detail-list.js
const { loadBatchLabelPage } = require('../../utils/inventory-label-query');

function buildBatchKey(item = {}) {
  return `${String(item.product_code || '').trim()}::${String(item.batch_number || '').trim()}`;
}

Page({
  data: {
    list: [],
    loading: false,
    hasLoadedOnce: false,
    queryCode: '',
    queryName: '',
    category: '',
    lastSeenInventoryChangeAt: 0,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0,
    expandedBatchKey: '',
    expandedBatchLabels: [],
    expandedBatchLoading: false,
    expandedLabelRequestId: 0
  },

  onLoad(options) {
    const decodedName = decodeURIComponent(options.name || '');
    const decodedCode = decodeURIComponent(options.code || '');
    const category = options.category || '';

    this.setData({
      queryCode: decodedCode,
      queryName: decodedName,
      category
    });

    wx.setNavigationBarTitle({
      title: decodedCode || decodedName || '批次查询'
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

    const reopenBatchKey = reset ? this.data.expandedBatchKey : '';
    const nextPage = reset ? 1 : this.data.page;
    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const { queryCode, queryName, category, pageSize, list } = this.data;
      const res = await wx.cloud.callFunction({
        name: 'getInventoryBatches',
        data: {
          productCode: queryCode,
          materialName: queryName,
          category,
          page: nextPage,
          pageSize
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载失败');
      }

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const result = res.result || {};
      const normalizedList = (result.list || []).map(item => ({
        ...item,
        labelCount: Number(item.labelCount !== undefined ? item.labelCount : item.itemCount) || 0,
        _batchKey: buildBatchKey(item)
      }));
      const mergedList = reset ? normalizedList : list.concat(normalizedList);
      const nextExpandedItem = reopenBatchKey
        ? mergedList.find(item => item._batchKey === reopenBatchKey)
        : null;
      this.setData({
        list: mergedList,
        total: Number(result.total) || mergedList.length,
        page: nextPage + 1,
        isEnd: Boolean(result.isEnd),
        hasLoadedOnce: true,
        lastSeenInventoryChangeAt: (getApp().globalData && getApp().globalData.inventoryChangedAt) || 0,
        expandedBatchKey: nextExpandedItem ? reopenBatchKey : '',
        expandedBatchLabels: nextExpandedItem ? this.data.expandedBatchLabels : [],
        expandedBatchLoading: nextExpandedItem ? this.data.expandedBatchLoading : false
      });

      if (reset && nextExpandedItem) {
        await this.loadExpandedBatchLabels(nextExpandedItem);
      }
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

  async onBatchTap(e) {
    const item = (e.detail && e.detail.item) || e.currentTarget.dataset.item;
    if (!item) {
      return;
    }

    const normalizedItem = {
      ...item,
      _batchKey: item._batchKey || buildBatchKey(item)
    };
    const labelCount = Number(normalizedItem.labelCount) || 0;

    if (labelCount <= 1) {
      await this.openSingleLabelDetail(normalizedItem);
      return;
    }

    if (this.data.expandedBatchKey === normalizedItem._batchKey) {
      this.collapseExpandedBatch();
      return;
    }

    await this.loadExpandedBatchLabels(normalizedItem);
  },

  collapseExpandedBatch() {
    this.setData({
      expandedBatchKey: '',
      expandedBatchLabels: [],
      expandedBatchLoading: false,
      expandedLabelRequestId: this.data.expandedLabelRequestId + 1
    });
  },

  async loadExpandedBatchLabels(item) {
    const currentRequestId = this.data.expandedLabelRequestId + 1;
    const batchKey = item._batchKey || buildBatchKey(item);

    this.setData({
      expandedBatchKey: batchKey,
      expandedBatchLabels: [],
      expandedBatchLoading: true,
      expandedLabelRequestId: currentRequestId
    });

    try {
      const result = await this.queryBatchLabels(item, Math.min(Math.max(Number(item.labelCount) || 20, 20), 200));

      if (this.data.expandedLabelRequestId !== currentRequestId) {
        return result;
      }

      this.setData({
        expandedBatchKey: batchKey,
        expandedBatchLabels: result.list || [],
        expandedBatchLoading: false
      });

      return result;
    } catch (error) {
      if (this.data.expandedLabelRequestId !== currentRequestId) {
        return null;
      }
      console.error(error);
      this.setData({
        expandedBatchLoading: false
      });
      wx.showToast({ title: '标签加载失败', icon: 'none' });
      return null;
    }
  },

  async openSingleLabelDetail(item) {
    wx.showLoading({ title: '打开详情...' });

    try {
      const result = await this.queryBatchLabels(item, 2);
      const labels = result.list || [];

      if (labels.length === 1 && labels[0]._id) {
        this.openLabelDetailById(labels[0]._id);
        return;
      }

      if (labels.length > 1) {
        this.setData({
          expandedBatchKey: item._batchKey || buildBatchKey(item),
          expandedBatchLabels: labels,
          expandedBatchLoading: false
        });
        return;
      }

      wx.showToast({ title: '暂无在库标签', icon: 'none' });
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '打开失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async queryBatchLabels(item, pageSize = 20) {
    return loadBatchLabelPage({
      batchNumber: item.batch_number,
      productCode: this.data.queryCode,
      materialName: this.data.queryName,
      category: this.data.category,
      page: 1,
      pageSize
    });
  },

  openLabelDetail(e) {
    const id = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    this.openLabelDetailById(id);
  },

  openLabelDetailById(id) {
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/inventory-detail/index?id=${id}`
    });
  }
});
