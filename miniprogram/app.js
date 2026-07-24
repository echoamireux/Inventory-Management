// app.js
const { USER_STATUS } = require('./utils/constants');

App({
  onLaunch: function () {
    this.globalData = {
      userInfo: null,
      user: null,
      inventoryChangedAt: 0,
      configurationError: false
    };

    if (!wx.cloud) {
      this.globalData.configurationError = true;
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    let envConfig;
    try {
      envConfig = require('./env');
    } catch (error) {
      envConfig = null;
    }

    const envId = envConfig && String(envConfig.env || '').trim();
    if (
      !envId
      || /^YOUR[-_]/i.test(envId)
      || envId === 'YOUR-REAL-ENV-ID'
      || envId === 'REPLACE_WITH_WECHAT_CLOUD_ENV_ID'
    ) {
      this.globalData.configurationError = true;
      console.error('未找到有效的 miniprogram/env.js 配置，禁止启动云能力');
      wx.showModal({
        title: '环境配置错误',
        content: '缺少有效云环境 ID，请配置 miniprogram/env.js 后重试。',
        showCancel: false
      });
      return;
    }

    wx.cloud.init({
      env: envId,
      traceUser: envConfig.traceUser !== false
    });

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

        if (user.status === USER_STATUS.PENDING) {
           // B: 审核中 -> 等待页
           if (this.getActivePageName() !== 'pages/status/pending') {
              wx.reLaunch({ url: '/pages/status/pending' });
           }
        } else if (user.status === USER_STATUS.DISABLED) {
           // C: 已禁用
           if (this.getActivePageName() !== 'pages/status/pending') {
              wx.reLaunch({ url: '/pages/status/pending?status=disabled' });
           }
        } else if (user.status === USER_STATUS.REJECTED) {
           // D: 已拒绝
           if (this.getActivePageName() !== 'pages/status/pending') {
              wx.reLaunch({
                url: `/pages/status/pending?status=rejected&reason=${encodeURIComponent(user.reject_reason || '')}`
              });
           }
        } else {
           // E: 已激活 -> 首页 (如果还在其他页面比如注册页，则跳转)
           // 如果已经在首页或其他业务页面，则不动
           const cur = this.getActivePageName();
           if (cur === 'pages/register/index' || cur === 'pages/status/pending') {
               wx.reLaunch({ url: '/pages/index/index' });
           }
        }
      }

    } catch (err) {
      console.error('身份校验对失败:', err);
      wx.showModal({
        title: '身份校验失败',
        content: '请检查网络连接或确认云函数已部署后重试。',
        confirmText: '重试',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) {
            this.checkUserStatus();
          }
        }
      });
    } finally {
      wx.hideLoading();
    }
  },

  getActivePageName() {
    const pages = getCurrentPages();
    return pages.length > 0 ? pages[pages.length - 1].route : '';
  }
});
