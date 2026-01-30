// pages/admin/user-list.js
const db = require('../../utils/db');

Page({
  data: {
    list: []
  },

  onLoad: function (options) {
    const app = getApp();
    if (!app.globalData.user || app.globalData.user.role !== 'admin') {
        wx.showModal({
            title: '无权限',
            content: '该页面仅限管理员访问',
            showCancel: false,
            success: () => { wx.navigateBack(); }
        });
        return;
    }
    this.getList();
  },

  async getList() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.database().collection('users')
        .where({ status: 'pending' })
        .orderBy('create_time', 'desc')
        .get();

      const list = res.data.map(item => ({
        ...item,
        _timeStr: item.create_time ? new Date(item.create_time).toLocaleString() : ''
      }));

      this.setData({ list });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认通过',
      content: '是否批准该用户加入？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await wx.cloud.callFunction({
              name: 'adminUpdateUserStatus',
              data: { userId: id, status: 'active' }
            });

            wx.showToast({ title: '已通过', icon: 'success' });
            this.getList(); // Refresh list
          } catch (err) {
            console.error(err);
            wx.showToast({ title: '操作失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  }
});
