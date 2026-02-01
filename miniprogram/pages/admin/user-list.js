// pages/admin/user-list.js
const db = require('../../utils/db');
import Dialog from '@vant/weapp/dialog/dialog';

Page({
  data: {
    list: [],
    showRejectDialog: false,
    rejectTargetId: '',
    rejectReason: ''
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

      const list = res.data.map(item => {
        let timeStr = '';
        if (item.create_time) {
          const date = new Date(item.create_time);
          const y = date.getFullYear();
          const m = (date.getMonth() + 1).toString().padStart(2, '0');
          const d = date.getDate().toString().padStart(2, '0');
          const h = date.getHours().toString().padStart(2, '0');
          const min = date.getMinutes().toString().padStart(2, '0');
          const s = date.getSeconds().toString().padStart(2, '0');
          timeStr = `${y}/${m}/${d} ${h}:${min}:${s}`;
        }
        return {
          ...item,
          _timeStr: timeStr
        };
      });

      this.setData({ list });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 拒绝相关逻辑
  onReject(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
        showRejectDialog: true,
        rejectTargetId: id,
        rejectReason: ''
    });
  },

  onRejectInput(e) {
      this.setData({ rejectReason: e.detail });
  },

  async onRejectConfirm(action, done) {
      if (action === 'confirm') {
          const reason = this.data.rejectReason;
          if (!reason) {
              wx.showToast({ title: '请填写原因', icon: 'none' });
              done(false);
              return;
          }

          done(false); // Keep open
          wx.showLoading({ title: '处理中...' });

          try {
            await wx.cloud.callFunction({
              name: 'adminUpdateUserStatus',
              data: {
                userId: this.data.rejectTargetId,
                status: 'rejected',
                rejectReason: reason
              }
            });

            wx.showToast({ title: '已驳回', icon: 'success' });
            this.setData({ showRejectDialog: false });
            this.getList();
          } catch (err) {
            console.error(err);
            wx.showToast({ title: '操作失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
      } else {
          this.setData({ showRejectDialog: false });
      }
  },

  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该用户'; // Bonus UX

    Dialog.confirm({
      title: '确认通过',
      message: '是否批准该用户加入？',
      confirmButtonText: '批准加入',
      confirmButtonColor: '#2C68FF' // Brand Color
    }).then(async () => {
        wx.showLoading({ title: '处理中...' });
        try {
            await wx.cloud.callFunction({
              name: 'adminUpdateUserStatus',
              data: { userId: id, status: 'active' }
            });

            wx.showToast({ title: '已通过', icon: 'success' });
            this.getList();
        } catch (err) {
            console.error(err);
            wx.showToast({ title: '操作失败', icon: 'none' });
        } finally {
            wx.hideLoading();
        }
    }).catch(() => {});
  }
});
