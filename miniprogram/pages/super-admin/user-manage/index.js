// pages/super-admin/user-manage/index.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';

Page({
  data: {
    list: [],
    filteredList: [],
    searchVal: '',
    showUserActions: false,
    userActions: [],
    selectedUser: null
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
    wx.showLoading({ title: '加载中' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminUpdateUserStatus',
        data: {
          action: 'listActiveUsers'
        }
      });
      const result = res.result || {};
      if (!result.success) {
        throw new Error(result.msg || '加载失败');
      }
      const rawList = result.list || [];

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

  onOpenUserActions(e) {
    const targetUser = this.data.list.find(item => item._id === e.currentTarget.dataset.id);
    if (!targetUser) {
      return;
    }

    const actions = [];
    if (targetUser.status === 'active') {
      [
        { value: 'user', name: '设为普通用户' },
        { value: 'admin', name: '设为管理员' },
        { value: 'super_admin', name: '设为超级管理员' }
      ].filter(item => item.value !== targetUser.role).forEach(item => {
        actions.push({ ...item, actionType: 'role' });
      });
      actions.push({
        name: '禁用账号',
        value: 'disabled',
        actionType: 'status',
        color: '#dc2626'
      });
    } else {
      actions.push({
        name: '重新启用账号',
        value: 'active',
        actionType: 'status',
        color: '#2563eb'
      });
    }

    this.setData({
      selectedUser: targetUser,
      userActions: actions,
      showUserActions: true
    });
  },

  onUserActionsClose() {
    this.setData({ showUserActions: false });
  },

  onUserActionSelect(e) {
    const selectedAction = e.detail || {};
    const targetUser = this.data.selectedUser;
    this.setData({ showUserActions: false });
    if (!targetUser || !selectedAction.actionType) {
      return;
    }

    const isRoleAction = selectedAction.actionType === 'role';
    const actionName = selectedAction.name || '执行操作';
    const warningText = isRoleAction
      ? '角色变更会立即影响该用户可访问的功能。'
      : (selectedAction.value === 'disabled'
        ? '禁用后该用户将无法继续进入系统。'
        : '启用后该用户将恢复原角色对应的权限。');

    Dialog.confirm({
      title: `确认${actionName}`,
      message: `确定要对 ${targetUser.name || '该用户'} 执行“${actionName}”吗？\n${warningText}`,
      confirmButtonText: '确认执行',
      confirmButtonColor: selectedAction.value === 'disabled' ? '#dc2626' : '#2563eb'
    }).then(() => this.executeUserMutation(targetUser, selectedAction)).catch(() => {});
  },

  async executeUserMutation(targetUser, selectedAction) {
    Toast.loading({ message: '执行中', forbidClick: true });
    try {
      const data = selectedAction.actionType === 'role'
        ? {
          action: 'updateRole',
          userId: targetUser._id,
          role: selectedAction.value
        }
        : {
          action: 'updateStatus',
          userId: targetUser._id,
          status: selectedAction.value
        };
      const res = await wx.cloud.callFunction({
        name: 'adminUpdateUserStatus',
        data
      });
      if (!res.result || !res.result.success) {
        throw new Error(res.result ? res.result.msg : '操作失败');
      }
      Toast.success('操作成功');
      await this.getList();
    } catch (err) {
      console.error(err);
      Dialog.alert({ title: '操作失败', message: err.message || '网络或权限错误' });
    } finally {
      Toast.clear();
    }
  }
});
