// pages/admin/approval-center/index.js
import Dialog from '@vant/weapp/dialog/dialog';
const {
  ensureOperationId,
  clearOperationId
} = require('../../../utils/operation-id');

Page({
  data: {
    activeTab: 'material', // 'material' | 'user' | 'correction'

    // Material Data
    materialList: [],
    materialLoading: false,
    materialPage: 0,
    materialPageSize: 20,
    materialTotal: 0,
    materialIsEnd: false,

    // User Data
    userList: [],
    userLoading: false,
    userPage: 0,
    userPageSize: 20,
    userTotal: 0,
    userIsEnd: false,

    // Correction Data
    correctionList: [],
    correctionLoading: false,
    correctionPage: 0,
    correctionPageSize: 20,
    correctionTotal: 0,
    correctionIsEnd: false,

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
    this.loadData(true);
  },

  onTabChange(e) {
      this.setData({ activeTab: e.detail.name }, () => {
          this.loadData(true);
      });
  },

  loadData(reset = false) {
      if (this.data.activeTab === 'material') {
          return this.fetchMaterials(reset);
      } else if (this.data.activeTab === 'correction') {
          return this.fetchCorrections(reset);
      } else {
          return this.fetchUsers(reset);
      }
  },

  async fetchMaterials(reset = false) {
    if (this.data.materialLoading || (!reset && this.data.materialIsEnd)) return;
    const page = reset ? 1 : this.data.materialPage + 1;
    this.setData({ materialLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'materials', page, pageSize: this.data.materialPageSize }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载物料申请失败');
        }
        const incoming = result.materialList || [];
        this.setData({
            materialList: reset ? incoming : [...this.data.materialList, ...incoming],
            materialPage: result.page || page,
            materialTotal: Number(result.total) || 0,
            materialIsEnd: !!result.isEnd
        });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载物料申请失败', icon: 'none' });
    } finally {
        this.setData({ materialLoading: false });
    }
  },

  async fetchUsers(reset = false) {
    if (this.data.userLoading || (!reset && this.data.userIsEnd)) return;
    const page = reset ? 1 : this.data.userPage + 1;
    this.setData({ userLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'users', page, pageSize: this.data.userPageSize }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载人员申请失败');
        }
        const incoming = result.userList || [];
        this.setData({
            userList: reset ? incoming : [...this.data.userList, ...incoming],
            userPage: result.page || page,
            userTotal: Number(result.total) || 0,
            userIsEnd: !!result.isEnd
        });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载人员申请失败', icon: 'none' });
    } finally {
        this.setData({ userLoading: false });
    }
  },

  async fetchCorrections(reset = false) {
    if (this.data.correctionLoading || (!reset && this.data.correctionIsEnd)) return;
    const page = reset ? 1 : this.data.correctionPage + 1;
    this.setData({ correctionLoading: true });
    try {
        const res = await wx.cloud.callFunction({
            name: 'getApprovalCenterData',
            data: { action: 'corrections', page, pageSize: this.data.correctionPageSize }
        });
        const result = res.result || {};
        if (!result.success) {
            throw new Error(result.msg || '加载纠错申请失败');
        }
        const incoming = result.correctionList || [];
        this.setData({
            correctionList: reset ? incoming : [...this.data.correctionList, ...incoming],
            correctionPage: result.page || page,
            correctionTotal: Number(result.total) || 0,
            correctionIsEnd: !!result.isEnd
        });
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
              if (action === 'approve') {
                  getApp().globalData.masterDataChangedAt = Date.now();
              }
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchMaterials(true);
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
                  action: action === 'approve' ? 'approveUser' : 'rejectUser',
                  userId: id,
                  rejectReason: action === 'reject' ? reason : ''
              }
          });

          wx.hideLoading();

          if (res.result && res.result.success) {
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchUsers(true);
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
          const payload = {
              request_id: id,
              action: action,
              reject_reason: reason
          };
          const operationScope = `approveInventoryCorrectionRequest:${id}:${action}`;
          const res = await wx.cloud.callFunction({
              name: 'approveInventoryCorrectionRequest',
              data: {
                  ...payload,
                  operation_id: ensureOperationId(operationScope, payload, 'approve')
              }
          });

          wx.hideLoading();

          if (res.result && res.result.success) {
              clearOperationId(operationScope);
              wx.showToast({ title: '操作成功', icon: 'success' });
              this.fetchCorrections(true);
          } else {
              wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' });
          }
      } catch(err) {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
          console.error(err);
      }
  },

  onReachBottom() {
      this.loadData(false);
  },

  onPullDownRefresh() {
      Promise.resolve(this.loadData(true)).finally(() => wx.stopPullDownRefresh());
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
