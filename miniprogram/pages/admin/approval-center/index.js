// pages/admin/approval-center/index.js
import Dialog from '@vant/weapp/dialog/dialog';

Page({
  data: {
    activeTab: 'material', // 'material' | 'user' | 'correction'

    // Material Data
    materialList: [],
    materialLoading: false,

    // User Data
    userList: [],
    userLoading: false,

    // Correction Data
    correctionList: [],
    correctionLoading: false,

    // Reject Dialog State
    showRejectDialog: false,
    rejectReason: '',
    currentAction: null
  },

  onLoad(options) {
    if (options.tab) {
        this.setData({ activeTab: options.tab });
    }
    this.checkAdmin();
  },

  checkAdmin() {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      });
      return;
    }
    // Auth passed, load data
    this.loadData();
  },

  onTabChange(e) {
      this.setData({ activeTab: e.detail.name }, () => {
          this.loadData();
      });
  },

  loadData() {
      if (this.data.activeTab === 'material') {
          this.fetchMaterials();
      } else if (this.data.activeTab === 'correction') {
          this.fetchCorrections();
      } else {
          this.fetchUsers();
      }
  },

  async fetchMaterials() {
    this.setData({ materialLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'materials' }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载物料申请失败');
        }
        this.setData({ materialList: result.materialList || [] });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载物料申请失败', icon: 'none' });
    } finally {
        this.setData({ materialLoading: false });
    }
  },

  async fetchUsers() {
    this.setData({ userLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'users' }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载人员申请失败');
        }
        this.setData({ userList: result.userList || [] });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载人员申请失败', icon: 'none' });
    } finally {
        this.setData({ userLoading: false });
    }
  },

  async fetchCorrections() {
    this.setData({ correctionLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'corrections' }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载纠错申请失败');
        }
        this.setData({ correctionList: result.correctionList || [] });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载纠错申请失败', icon: 'none' });
    } finally {
        this.setData({ correctionLoading: false });
    }
  },

  // Actions
  onApprove(e) {
      const { id, type } = e.currentTarget.dataset;
      let message = '确认激活该用户账号？';
      if (type === 'material') message = '确认将该物料加入正式库？';
      if (type === 'correction') message = '确认通过该库存纠错申请？';
      Dialog.confirm({
          title: '确认通过',
          message
      }).then(() => {
          if (type === 'material') this.handleMaterialAction(id, 'approve');
          else if (type === 'correction') this.handleCorrectionAction(id, 'approve');
          else this.handleUserAction(id, 'approve');
      }).catch(() => {})
  },

  onReject(e) {
      const { id, type } = e.currentTarget.dataset;
      this.setData({
          currentAction: { id, type },
          rejectReason: '',
          showRejectDialog: true
      });
  },

  onRejectReasonInput(e) {
      this.setData({ rejectReason: e.detail });
  },

  onConfirmReject() {
      const { currentAction, rejectReason } = this.data;
      if (!currentAction) return;

      const { id, type } = currentAction;
      if (type === 'material') {
          this.handleMaterialAction(id, 'reject', rejectReason);
      } else if (type === 'correction') {
          this.handleCorrectionAction(id, 'reject', rejectReason);
      } else {
          this.handleUserAction(id, 'reject', rejectReason);
      }
      this.setData({ showRejectDialog: false });
  },

  onCancelReject() {
      this.setData({ showRejectDialog: false });
  },

  /* Logic Handlers */

  async handleMaterialAction(id, action, reason = '') {
      wx.showLoading({ title: '处理中...' });
      try {
          const res = await wx.cloud.callFunction({
              name: 'approveMaterialRequest',
              data: {
                  request_id: id,
                  action: action,
                  reject_reason: reason
              }
          });

          wx.hideLoading();

          if (res.result && res.result.success) {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchMaterials(); // Reload
          } else {
              wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' });
          }
      } catch(err) {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
          console.error(err);
      }
  },

  async handleUserAction(id, action, reason = '') {
      wx.showLoading({ title: '处理中...' });
      try {
          const res = await wx.cloud.callFunction({
              name: 'adminUpdateUserStatus',
              data: {
                  userId: id,
                  status: action === 'approve' ? 'active' : 'rejected',
                  rejectReason: action === 'reject' ? reason : ''
              }
          });

          wx.hideLoading();

          if (res.result && res.result.success) {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchUsers(); // Reload
          } else {
              wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' });
          }
      } catch(err) {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
          console.error(err);
      }
  },

  async handleCorrectionAction(id, action, reason = '') {
      wx.showLoading({ title: '处理中...' });
      try {
          const res = await wx.cloud.callFunction({
              name: 'approveInventoryCorrectionRequest',
              data: {
                  request_id: id,
                  action: action,
                  reject_reason: reason
              }
          });

          wx.hideLoading();

          if (res.result && res.result.success) {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchCorrections();
          } else {
              wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' });
          }
      } catch(err) {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
          console.error(err);
      }
  },

  /* Utils */
  formatTime(dateVal) {
      if (!dateVal) return '--';
      const date = new Date(dateVal);
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const h = date.getHours().toString().padStart(2, '0');
      const min = date.getMinutes().toString().padStart(2, '0');
      return `${m}-${d} ${h}:${min}`;
  }
});
