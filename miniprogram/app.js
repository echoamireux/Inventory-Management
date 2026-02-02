// app.js
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      // 尝试加载私有配置，若不存在则提示
      let envConfig = {};
      try {
        envConfig = require('./env');
      } catch (e) {
        console.error('未找到 miniprogram/env.js 配置文件，请复制 env.example.js 并重命名为 env.js');
      }

      wx.cloud.init({
        // 优先使用配置文件中的 env ID
        env: envConfig.env || 'YOUR-ENV-ID-HERE',
        traceUser: true,
      });
    }

    this.globalData = {
      userInfo: null,
      user: null // 存储 { name, openid, role }
    };

    this.checkUserStatus();
  },

  async checkUserStatus() {
    // 显示全局加载
    wx.showLoading({ title: '身份校验中...', mask: true });

    try {
      // 1. 调用 userLogin 云函数 (获取完整状态)
      const { result } = await wx.cloud.callFunction({ name: 'userLogin' });

      // 注意：result 可能包含 error，或者直接就是用户信息对象
      if (result.error) throw new Error(result.error);

      // 2. 路由分发
      if (!result.registered) {
        // A: 新用户 -> 注册页
        console.log('新用户，跳转注册');
        if (this.getActivePageName() !== 'pages/register/index') {
           wx.reLaunch({ url: '/pages/register/index' });
        }
      } else {
        const user = result.user;
        this.globalData.user = user;

        // Callback for pages waiting for user info (e.g. index.js for admin role)
        if (this.userReadyCallback) {
            this.userReadyCallback(user);
        }

        console.log('用户状态:', user.status);

        if (user.status === 'pending') {
           // B: 审核中 -> 等待页
           if (this.getActivePageName() !== 'pages/status/pending') {
              wx.reLaunch({ url: '/pages/status/pending' });
           }
        } else if (user.status === 'disabled') {
           // C: 已禁用
           wx.showModal({
             title: '账号已禁用',
             content: '请联系管理员',
           });
        } else if (user.status === 'rejected') {
           // D: 已拒绝
           if (this.getActivePageName() !== 'pages/status/pending') {
              wx.reLaunch({
                url: `/pages/status/pending?status=rejected&reason=${encodeURIComponent(user.reject_reason || '')}`
              });
           }
        } else {
           // D: 已激活 -> 首页 (如果还在其他页面比如注册页，则跳转)
           // 如果已经在首页或其他业务页面，则不动
           const cur = this.getActivePageName();
           if (cur === 'pages/register/index' || cur === 'pages/status/pending') {
               wx.reLaunch({ url: '/pages/index/index' });
           }
        }
      }

    } catch (err) {
      console.error('身份校验对失败:', err);
      // 网络错误等可以提供重试按钮，这里简单处理
    } finally {
      wx.hideLoading();
    }
  },

  getActivePageName() {
    const pages = getCurrentPages();
    return pages.length > 0 ? pages[pages.length - 1].route : '';
  }
});
