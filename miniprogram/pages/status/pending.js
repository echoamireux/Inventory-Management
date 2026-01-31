Page({
  data: {
    status: 'pending', // pending | rejected
    reason: ''
  },

  onLoad(options) {
    if (options.status) {
      this.setData({
        status: options.status,
        reason: decodeURIComponent(options.reason || '')
      });
    }
  },

  onRefresh() {
    wx.showLoading({ title: '检查中...' });
    const app = getApp();
    app.checkUserStatus().then(() => {
        wx.hideLoading();
        // checkUserStatus 会自动跳转
    });
  },

  onModify() {
    wx.reLaunch({
      url: '/pages/register/index'
    });
  }
});
