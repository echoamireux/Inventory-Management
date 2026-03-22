// pages/super-admin/user-manage/index.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';

Page({
  data: {
    list: [],
    filteredList: [],
    searchVal: ''
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.user || app.globalData.user.role !== 'super_admin') {
        wx.showModal({
            title: '越权访问',
            content: '该页面仅限超级管理员访问',
            showCancel: false,
            success: () => { wx.navigateBack(); }
        });
        return;
    }
    this.getList();
  },

  onPullDownRefresh() {
    this.getList().then(() => {
        wx.stopPullDownRefresh();
    });
  },

  async getList() {
    wx.showLoading({ title: '加载中...' });
    try {
      const db = wx.cloud.database();
      const pageSize = 100;
      let skip = 0;
      let rawList = [];

      while (true) {
        const res = await db.collection('users')
          .where({ status: 'active' })
          .orderBy('create_time', 'desc')
          .skip(skip)
          .limit(pageSize)
          .get();

        rawList = rawList.concat(res.data || []);
        if (!res.data || res.data.length < pageSize) break;
        skip += pageSize;
      }

      const list = rawList.map(item => {
        let timeStr = '';
        if (item.create_time) {
          const date = new Date(item.create_time);
          const y = date.getFullYear();
          const m = (date.getMonth() + 1).toString().padStart(2, '0');
          const d = date.getDate().toString().padStart(2, '0');
          timeStr = `${y}/${m}/${d}`;
        }
        return {
          ...item,
          _timeStr: timeStr
        };
      });

      this.setData({ list, filteredList: list });
      this.filterList(this.data.searchVal);
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onSearch(e) {
      const val = e.detail;
      this.setData({ searchVal: val });
      this.filterList(val);
  },

  filterList(query) {
      if (!query) {
          this.setData({ filteredList: this.data.list });
          return;
      }
      const q = query.toLowerCase();
      const filtered = this.data.list.filter(user => {
          return (user.name && user.name.toLowerCase().includes(q)) ||
                 (user.mobile && user.mobile.includes(q)) ||
                 (user.department && user.department.toLowerCase().includes(q));
      });
      this.setData({ filteredList: filtered });
  },

  onChangeRole(e) {
      const dataset = e.currentTarget.dataset;
      const targetUserId = dataset.id;
      const targetName = dataset.name || '该用户';
      const newRole = dataset.role; // 'admin' or 'user'
      
      const actionName = newRole === 'admin' ? '设为管理员' : '取消管理员权限';
      const warningText = newRole === 'admin' ? '赋予管理权限后，该用户将能进行审批和物料维护等敏感操作。' : '取消管理权限后，该用户将变为普通用户。';

      Dialog.confirm({
          title: `确认${actionName}`,
          message: `确定要${actionName} (${targetName}) 吗？\n${warningText}`,
          confirmButtonText: '确认执行',
          confirmButtonColor: newRole === 'admin' ? '#2C68FF' : '#ee0a24'
      }).then(async () => {
          Toast.loading({ message: '执行中...', forbidClick: true });
          
          try {
              const res = await wx.cloud.callFunction({
                  name: 'adminUpdateUserStatus',
                  data: {
                      action: 'updateRole',
                      userId: targetUserId,
                      role: newRole
                  }
              });

              if (res.result && res.result.success) {
                  Toast.success('操作成功');
                  this.getList(); // Reload list
              } else {
                  throw new Error(res.result ? res.result.msg : 'Unknown Error');
              }
          } catch (err) {
              console.error(err);
              Dialog.alert({ title: '操作失败', message: err.message || '网络或权限错误' });
          } finally {
              Toast.clear();
          }
      }).catch(() => {
          // Cancelled
      });
  }
});
