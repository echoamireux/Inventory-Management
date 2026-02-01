// pages/admin/material-list.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';

Page({
  data: {
    list: [],
    searchVal: '',
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false
  },

  onLoad() {
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

  // 页面显示时刷新列表（从编辑页返回后能看到最新数据）
  onShow() {
    // 仅当已有数据时才刷新，避免 onLoad 和 onShow 重复加载
    if (this.data.list.length > 0) {
      this.getList(true);
    }
  },

  onPullDownRefresh() {
    this.getList(true);
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (!this.data.isEnd && !this.data.loading) {
      this.loadMore();
    }
  },

  async getList(refresh = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      const page = refresh ? 1 : this.data.page;
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal: this.data.searchVal,
            page,
            pageSize: this.data.pageSize
          }
        }
      });

      if (res.result.success) {
        const newList = res.result.list;
        const list = refresh ? newList : [...this.data.list, ...newList];
        const isEnd = list.length >= res.result.total;

        this.setData({
          list,
          page,
          total: res.result.total,
          isEnd
        });
      } else {
        Toast.fail(res.result.msg || '加载失败');
      }
    } catch (err) {
      console.error(err);
      Toast.fail('加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    this.setData({ page: this.data.page + 1 });
    this.getList();
  },

  onSearch(e) {
    this.setData({ searchVal: e.detail || '' });
    this.getList(true);
  },

  onSearchClear() {
    this.setData({ searchVal: '' });
    this.getList(true);
  },

  // 新增物料
  onAdd() {
    wx.navigateTo({ url: '/pages/admin/material-edit' });
  },

  // 编辑物料
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/admin/material-edit?id=${id}` });
  },

  // 归档物料
  onArchive(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(m => m._id === id);

    Dialog.confirm({
      title: '确认归档',
      message: `确定要归档物料 "${item.product_code}" 吗？归档后将不再显示在入库选择中。`,
      confirmButtonColor: '#ee0a24'
    }).then(async () => {
      Toast.loading({ message: '处理中...', forbidClick: true });
      try {
        const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
            action: 'archive',
            data: { id }
          }
        });
        if (res.result.success) {
          Toast.success('已归档');
          this.getList(true);
        } else {
          Toast.fail(res.result.msg);
        }
      } catch (err) {
        Toast.fail('操作失败');
      }
    }).catch(() => {});
  }
});
