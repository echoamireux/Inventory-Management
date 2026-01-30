// pages/status/pending.js
Page({
  onRefresh() {
    wx.showLoading({ title: '检查中...' });
    const app = getApp();
    app.checkUserStatus().then(() => {
        wx.hideLoading();
        // checkUserStatus 会自动跳转，如果还是 pending 就会留在这里 (注意避免无限循环跳转)
        // 建议 checkUserStatus 加上参数，控制不重复跳 pending 页
    });
  }
});
