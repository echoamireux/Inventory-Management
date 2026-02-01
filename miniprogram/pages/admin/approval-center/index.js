// pages/admin/approval-center/index.js
const db = wx.cloud.database();
import Dialog from '@vant/weapp/dialog/dialog';

Page({
  data: {
    activeTab: 'material', // 'material' | 'user'

    // Material Data
    materialList: [],
    materialLoading: false,

    // User Data
    userList: [],
    userLoading: false,

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
    if (!user || user.role !== 'admin') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' });
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
      } else {
          this.fetchUsers();
      }
  },

  async fetchMaterials() {
    this.setData({ materialLoading: true });
    try {
        const res = await db.collection('material_requests')
            .where({ status: 'pending' })
            .orderBy('created_at', 'desc')
            .get();

        const list = res.data.map(item => ({
            ...item,
            _timeStr: this.formatTime(item.created_at)
        }));
        this.setData({ materialList: list });
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
        const res = await db.collection('users')
            .where({ status: 'pending' })
            .orderBy('create_time', 'desc') // or created_at depending on schema, user-list.js used create_time
            .get();

        const uniqueUsers = [];
        const seenOpenids = new Set();

        res.data.forEach(item => {
            if (!seenOpenids.has(item._openid)) {
                seenOpenids.add(item._openid);
                uniqueUsers.push({
                    ...item,
                    _timeStr: this.formatTime(item.create_time || item.created_at)
                });
            }
        });

        this.setData({ userList: uniqueUsers });
    } catch(err) {
        console.error(err);
        wx.showToast({ title: '加载人员申请失败', icon: 'none' });
    } finally {
        this.setData({ userLoading: false });
    }
  },

  // Actions
  onApprove(e) {
      const { id, type } = e.currentTarget.dataset;
      Dialog.confirm({
          title: '确认通过',
          message: type === 'material' ? '确认将该物料加入正式库？' : '确认激活该用户账号？'
      }).then(() => {
          if (type === 'material') this.handleMaterialAction(id, 'approve');
          else this.handleUserAction(id, 'approve');
      }).catch(() => {});
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
      // 简单处理：Client Update (仅供 MVP，正规应走云函数)
      wx.showLoading({ title: '处理中...' });
      try {
          const updateData = {
              status: action === 'approve' ? 'active' : 'rejected',
              // approved_at: db.serverDate() // 如果schema支持
          };

          if (action === 'reject' && reason) {
              updateData.reject_reason = reason;
          }

          if (action === 'approve') {
              // 默认激活为操作员
              // updateData.role = 'operator';
          }

          await db.collection('users').doc(id).update({
              data: updateData
          });

          wx.hideLoading();
          wx.showToast({ title: '操作成功', icon: 'success' });
          this.fetchUsers(); // Reload
      } catch(err) {
          wx.hideLoading();
          console.error(err);
          wx.showToast({ title: '操作失败', icon: 'none' });
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
