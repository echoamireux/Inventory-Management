// pages/admin-logs/index.js
const db = require('../../utils/db');

Page({
  data: {
    list: [],
    searchVal: '',
    page: 1,
    loading: false,
    isEnd: false
  },

  onLoad: function (options) {
    // 权限校验
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.role !== 'admin') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    this.getList(true);
  },

  onPullDownRefresh() {
    this.getList(true);
  },

  onReachBottom() {
    if (!this.isEnd && !this.data.loading) {
      this.getList(false);
    }
  },

  onSearch(e) {
    this.setData({ searchVal: e.detail });
    this.getList(true);
  },

  onSearchChange(e) {
      this.setData({ searchVal: e.detail });
  },

  onClear() {
    this.setData({ searchVal: '' });
    this.getList(true);
  },

  async getList(reset = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });
    if (reset) {
      this.setData({ page: 1, list: [], isEnd: false });
    }

    try {
      const dbInstance = wx.cloud.database();
      const _ = dbInstance.command;

      let where = {};

      if (this.data.searchVal) {
        const regex = dbInstance.RegExp({
          regexp: this.data.searchVal,
          options: 'i',
        });
        where = _.or([
          { material_name: regex },
          { operator: regex }
        ]);
      }

      // 使用 utils/db.js 里的 logs 实例 (已指向 inventory_log)
      // 注意：utils/db.js 里的 getList 还没支持高级 where 对象 (如果它是直接传参的话)
      // 我们检查一下 utils/db.js 的 getList 实现:
      // async getList(where = {}, page = 1, pageSize = 20, orderByField = 'create_time', orderByType = 'desc')
      // 它可以接收 where 对象。

      const res = await db.logs.getList(where, this.data.page, 20, 'timestamp', 'desc');

      const formatted = res.map(item => {
         let typeText = '未知';
         let typeColor = 'default';

         switch(item.type) {
             case 'inbound': typeText = '入库'; typeColor = 'success'; break;
             case 'outbound': typeText = '领用'; typeColor = 'warning'; break;
             case 'delete': typeText = '删除'; typeColor = 'danger'; break;
             default: typeText = item.type;
         }

         return {
             ...item,
             typeText,
             typeColor,
             timeStr: item.timestamp ? new Date(item.timestamp).toLocaleString() : ''
         };
      });

      this.setData({
        list: reset ? formatted : this.data.list.concat(formatted),
        page: this.data.page + 1,
        isEnd: res.length < 20
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  }
});
