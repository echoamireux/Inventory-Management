// pages/inventory/index.js
const db = wx.cloud.database();
const _ = db.command;
import Dialog from '@vant/weapp/dialog/dialog';
const { resolveOpenDocumentPath } = require('../../utils/download-file');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

Page({
  data: {
    activeTab: 0, // 0: 全部, 1: 化材, 2: 膜材
    searchVal: '',
    list: [],
    loading: false,
    hasLoadedOnce: false,
    lastSeenInventoryChangeAt: 0,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0,

    // Aggregation Mode
    isGrouped: true, // Default to grouped view
    // Detail View State
    showDetailPopup: false,
    detailList: [],
    detailTitle: '',
    detailTotal: 0
  },

  onLoad: function (options) {
    // 模块三：接收首页搜索参数
    if (options.search) {
        this.setData({ searchVal: decodeURIComponent(options.search) });
    }
  },

  onShow: function () {
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

  onTabChange(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ activeTab: e.detail.index, page: 1, isEnd: false });
    this.getList(true);
  },

  onSearch(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal, page: 1, isEnd: false });
    this.getList(true);
  },

  onSearchChange(e) {
      const val = resolveSearchValue(e && e.detail);
      this.setData({ searchVal: val, page: 1, isEnd: false });
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

  onReachBottom() {
    if (this.data.loading || this.data.isEnd) {
      return;
    }
    this.getList(false);
  },

  // 核心逻辑升级：使用聚合查询
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
      const { searchVal, activeTab, pageSize, list } = this.data;
      let category = '';
      if (activeTab === 1) category = 'chemical';
      if (activeTab === 2) category = 'film';

      // Call Cloud Function for Aggregation
      const res = await wx.cloud.callFunction({
          name: 'getInventoryGrouped',
          data: {
              searchVal,
              category,
              page: nextPage,
              pageSize
          }
      });

      if (res.result.success) {
          if (this.data.requestId !== currentRequestId) {
            return;
          }
          const result = res.result || {};
          const mergedList = reset ? (result.list || []) : list.concat(result.list || []);
          this.setData({
            list: mergedList,
            total: Number(result.total) || mergedList.length,
            page: nextPage + 1,
            isEnd: Boolean(result.isEnd),
            hasLoadedOnce: true,
            lastSeenInventoryChangeAt: (getApp().globalData && getApp().globalData.inventoryChangedAt) || 0
          });
      } else {
          throw new Error(res.result.msg);
      }

    } catch (err) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  },

  // 点击分组卡片 -> 查看详情
  async goToDetail(e) {
      // 支持两种模式：1. 直接 index  2. 组件返回的 item
      let item;
      if (e.detail && e.detail.item) {
        // 来自 material-list-item 组件
        item = e.detail.item;
      } else {
        // 传统方式
        const index = e.currentTarget.dataset.index;
        item = this.data.list[index];
      }
      if (!item) return;

      // Navigate to detail list page (new idea: reuse this page or popup?)
      // Let's use a simple navigation to a sub-page logic for now,
      // OR navigate to inventory-detail but that's for single item.
      // Better: Show a "Group Detail" popup or page.
      // Let's go with a specific "group detail" logic.
      // Since we didn't create a new page in the plan, let's implement a "Filter Mode" on this page?
      // No, that's confusing.
      // Let's use the standard "inventory list" (non-grouped) for details.

      // We can use a query param 'product_code' to this same page to show flattened list?
      // But we set `isGrouped: true` by default.

      // Let's navigate to a new page `pages/inventory/list?code=...`?
      // Actually, let's just use `navigateTo` with filtered parameters to the SAME page, but add a flag `mode=flat`.

      const code = item.product_code !== '无产品代码' ? item.product_code : '';
      const name = item.material_name;

      // URL Encoding
      let url = `/pages/inventory/detail-list?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
      if (item.category) url += `&category=${item.category}`;

      wx.navigateTo({ url });
  },

  async onExport() {
    this.setData({ loading: true });
    wx.showLoading({ title: '正在导出报表...', mask: true });

    try {
        const { searchVal, activeTab } = this.data;
        let category = '';
        if (activeTab === 1) category = 'chemical';
        if (activeTab === 2) category = 'film';

        const res = await wx.cloud.callFunction({
            name: 'exportData',
            data: {
                searchVal,
                category
            }
        });

        if (res.result.success) {
            const fileID = res.result.fileID;
            const fileName = String(res.result.fileName || '').trim() || '库存明细报表.xlsx';

            // Download and Open
            wx.cloud.downloadFile({
                fileID: fileID,
                success: async (downRes) => {
                    if (downRes.statusCode === 200) {
                        try {
                            const localFilePath = await resolveOpenDocumentPath({
                                tempFilePath: downRes.tempFilePath,
                                fileName,
                                fileSystemManager: wx.getFileSystemManager(),
                                userDataPath: wx.env.USER_DATA_PATH,
                                fallbackFileName: '库存明细报表.xlsx'
                            });

                            wx.openDocument({
                                filePath: localFilePath,
                                showMenu: true, // Allow user to share/save
                                fileType: 'xlsx',
                                success: () => {
                                    wx.hideLoading();
                                    wx.showToast({ title: '即将打开', icon: 'success' });
                                },
                                fail: (err) => {
                                    console.error('Open failed', err);
                                    wx.hideLoading();
                                    wx.showToast({ title: '打开文件失败', icon: 'none' });
                                }
                            });
                        } catch (err) {
                            console.error('Save export failed', err);
                            wx.hideLoading();
                            wx.showToast({ title: err.message || '打开文件失败', icon: 'none' });
                        }
                    }
                },
                fail: () => {
                    wx.hideLoading();
                    wx.showToast({ title: '文件下载失败', icon: 'none' });
                }
            });
        } else {
            wx.hideLoading();
            wx.showToast({ title: res.result.msg || '导出失败', icon: 'none' });
        }
    } catch (err) {
        wx.hideLoading();
        console.error('Export Error', err);
        wx.showToast({ title: '导出异常', icon: 'none' });
    } finally {
        this.setData({ loading: false });
    }
  }
});
