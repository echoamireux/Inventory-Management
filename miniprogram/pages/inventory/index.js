// pages/inventory/index.js
const db = wx.cloud.database();
const _ = db.command;
import Dialog from '@vant/weapp/dialog/dialog';

Page({
  data: {
    activeTab: 0, // 0: 全部, 1: 化材, 2: 膜材
    searchVal: '',
    list: [],
    loading: false,

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
    this.getList();
  },

  onTabChange(e) {
    this.setData({ activeTab: e.detail.index });
    this.getList();
  },

  onSearch(e) {
    this.setData({ searchVal: e.detail });
    this.getList();
  },

  onSearchChange(e) {
      const val = e.detail;
      this.setData({ searchVal: val });
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
          this.getList();
      }, 500);
  },

  // 核心逻辑升级：使用聚合查询
  async getList() {
    if (this.data.loading) return;
    this.setData({ loading: true, list: [] });

    try {
      const { searchVal, activeTab } = this.data;
      let category = '';
      if (activeTab === 1) category = 'chemical';
      if (activeTab === 2) category = 'film';

      // Call Cloud Function for Aggregation
      const res = await wx.cloud.callFunction({
          name: 'getInventoryGrouped',
          data: {
              searchVal,
              category
          }
      });

      if (res.result.success) {
          this.setData({ list: res.result.list });
      } else {
          throw new Error(res.result.msg);
      }

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  // 点击分组卡片 -> 查看详情
  async goToDetail(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
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

      const code = item.product_code !== '无代码' ? item.product_code : '';
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

            // Download and Open
            wx.cloud.downloadFile({
                fileID: fileID,
                success: (downRes) => {
                    if (downRes.statusCode === 200) {
                        wx.openDocument({
                            filePath: downRes.tempFilePath,
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
