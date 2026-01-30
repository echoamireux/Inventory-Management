const db = require('../../utils/db');

Page({
  data: {
    name: '',
    loading: false
  },

  onLoad() {
    wx.hideHomeButton(); // 强制注册，不让返回
  },

  onNameInput(e) {
    this.setData({ name: e.detail });
  },

  async onSubmit() {
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '请输入您的姓名', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '注册中...' });

    try {
      // 1. 调用云函数注册 (安全分配角色)
      const res = await wx.cloud.callFunction({
        name: 'registerUser',
        data: { name }
      });

      const { success, role, msg } = res.result;

      if (!success) {
        throw new Error(msg);
      }

      // 2. 注册成功，更新本地提示
      wx.hideLoading();
      wx.showToast({
        title: role === 'admin' ? '已注册为管理员' : '注册成功',
        icon: 'success'
      });

      // 3. 稍后跳转回首页，让首页逻辑进行自动登录处理
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' });
      }, 1500);

    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showToast({ title: '注册失败: ' + (err.message || 'Unknown error'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
