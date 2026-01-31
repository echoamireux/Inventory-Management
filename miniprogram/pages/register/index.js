const db = require('../../utils/db');

Page({
  data: {
    name: '',
    mobile: '',
    department: '',
    showDept: false,
    deptColumns: ['研发一部', '研发二部', '质量部', '生产部', '仓储部', '行政部', '其他'],
    loading: false
  },

  onLoad() {
    wx.hideHomeButton(); // 强制注册，不让返回
  },

  onNameInput(e) {
    this.setData({ name: e.detail });
  },

  onMobileInput(e) {
    this.setData({ mobile: e.detail });
  },

  showDeptPopup() {
    this.setData({ showDept: true });
  },

  onCloseDept() {
    this.setData({ showDept: false });
  },

  onConfirmDept(e) {
    const { value } = e.detail;
    this.setData({
      department: value,
      showDept: false
    });
  },

  async onSubmit() {
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '请输入您的姓名', icon: 'none' });
      return;
    }
    // 手机号虽是选填，但若填了如果想校验格式可以在这里加逻辑，暂时略过

    this.setData({ loading: true });
    wx.showLoading({ title: '提交中...' });

    try {
      // 1. 调用云函数注册 (安全分配角色)
      const res = await wx.cloud.callFunction({
        name: 'registerUser',
        data: {
          name,
          mobile: this.data.mobile,
          department: this.data.department
        }
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
