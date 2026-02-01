// pages/admin/material-list.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';

Page({
  data: {
    activeTab: 'active', // active | archived
    list: [],
    searchVal: '',
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,

    // 批量管理模式
    isEditMode: false,
    selectedIds: [],
    isAllSelected: false
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

  // 切换筛选状态
  onTabChange(e) {
    this.setData({
      activeTab: e.detail.name,
      page: 1,
      list: [],
      isEnd: false,
      total: 0,
       // 切换 Tab 时退出编辑模式
      isEditMode: false,
      selectedIds: [],
      isAllSelected: false
    }, () => {
      this.getList(true);
    });
  },

  async getList(refresh = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      const page = refresh ? 1 : this.data.page;
      const { searchVal, pageSize, activeTab } = this.data;

      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal,
            page,
            pageSize,
            // 传递状态筛选参数
            status: activeTab
          }
        }
      });

      if (res.result.success) {
        let newList = res.result.list || [];

        // 如果在编辑模式下刷新，保持选中状态
        if (this.data.isEditMode) {
             newList = newList.map(item => ({
                 ...item,
                 checked: this.data.selectedIds.includes(item._id)
             }));
        }

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

  // ==========================================
  // 批量管理逻辑
  // ==========================================

  // 长按进入编辑模式
  onLongPress(e) {
      if (this.data.isEditMode) return;

      const id = e.currentTarget.dataset.id;
      // 震动反馈
      wx.vibrateShort();

      // 选中当前项
      const list = this.data.list.map(item => {
          if (item._id === id) return { ...item, checked: true };
          return item;
      });

      this.setData({
          isEditMode: true,
          list,
          selectedIds: [id],
          isAllSelected: list.length === 1 && this.data.total === 1
      });
  },

  // 切换编辑模式
  toggleEditMode() {
      const isEdit = !this.data.isEditMode;
      const list = this.data.list.map(item => ({ ...item, checked: false }));

      this.setData({
          isEditMode: isEdit,
          list,
          selectedIds: [],
          isAllSelected: false
      });
  },

  // 点击列表项 (编辑模式: 选中/取消; 普通模式: 进入编辑页)
  onItemClick(e) {
      const id = e.currentTarget.dataset.id;

      if (this.data.isEditMode) {
          this.toggleSelection(id);
      } else {
          // 普通点击 -> 跳转详情 (暂时没有详情页，直接去编辑)
          wx.navigateTo({
            url: `/pages/admin/material-edit?id=${id}`,
          });
      }
  },

  // 选中/取消单个
  toggleSelection(id) {
      let ids = [...this.data.selectedIds];
      const index = ids.indexOf(id);
      let isChecked = false;

      if (index > -1) {
          ids.splice(index, 1);
          isChecked = false;
      } else {
          ids.push(id);
          isChecked = true;
      }

      // Update UI List
      const list = this.data.list.map(item => {
          if (item._id === id) return { ...item, checked: isChecked };
          return item;
      });

      this.setData({
          selectedIds: ids,
          list,
          isAllSelected: ids.length === this.data.list.length && this.data.list.length > 0
      });
  },

  // 全选/反选 (当前页)
  onSelectAll() {
      const isAll = !this.data.isAllSelected;
      const list = this.data.list.map(item => ({ ...item, checked: isAll }));
      const ids = isAll ? list.map(item => item._id) : [];

      this.setData({
          isAllSelected: isAll,
          list,
          selectedIds: ids
      });
  },

  // 计算选中数量
  get selectedCount() {
      return this.data.selectedIds.length;
  },

  // 批量删除 / 归档 - 带理由输入
  onBatchDelete() {
      const ids = this.data.selectedIds;
      if (ids.length === 0) return Toast.fail('请先选择');

      // 使用带输入框的Dialog
      this.setData({ archiveReasonInput: '' });

      Dialog.confirm({
          title: '删除/归档确认',
          message: `您选中了 ${ids.length} 个物料。\n\n系统将按照以下策略处理：\n• 无历史记录 → 弹窗确认后彻底删除\n• 有历史记录 → 需填写归档原因后归档\n\n是否继续？`,
          confirmButtonText: '继续'
      }).then(() => {
          // 先检查哪些有历史记录
          this.checkAndProcessBatch(ids);
      }).catch(() => {});
  },

  // 检查并分类处理
  async checkAndProcessBatch(ids) {
      Toast.loading({ message: '检查中...', forbidClick: true });

      try {
          // 调用云函数检查每个物料的历史记录
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'checkHistory',
                  data: { ids }
              }
          });

          Toast.clear();

          if (!res.result.success) {
              throw new Error(res.result.msg);
          }

          const { toDelete, toArchive } = res.result;

          // 如果有需要删除的（无历史记录）
          if (toDelete.length > 0) {
              const confirmDelete = await Dialog.confirm({
                  title: '⚠️ 永久删除警告',
                  message: `以下 ${toDelete.length} 个物料无历史记录，将被永久删除：\n\n${toDelete.map(m => m.product_code).join(', ')}\n\n此操作不可撤销！`,
                  confirmButtonText: '确认删除',
                  confirmButtonColor: '#ee0a24'
              }).then(() => true).catch(() => false);

              if (!confirmDelete) return;
          }

          // 如果有需要归档的（有历史记录）
          let archiveReason = '';
          if (toArchive.length > 0) {
              // 弹出输入框让用户填写归档原因
              const inputResult = await this.showArchiveReasonDialog(toArchive);
              if (!inputResult.confirmed) return;
              archiveReason = inputResult.reason;
          }

          // 执行操作
          this.doBatchDelete(ids, archiveReason);

      } catch (err) {
          Toast.clear();
          Toast.fail(err.message || '检查失败');
      }
  },

  // 显示归档原因输入弹窗
  showArchiveReasonDialog(toArchive) {
      return new Promise((resolve) => {
          wx.showModal({
              title: '填写归档原因',
              content: `以下 ${toArchive.length} 个物料有历史记录，将被归档：\n${toArchive.map(m => m.product_code).join(', ')}`,
              editable: true,
              placeholderText: '请输入归档原因（必填）',
              success: (res) => {
                  if (res.confirm) {
                      if (!res.content || res.content.trim() === '') {
                          Toast.fail('请填写归档原因');
                          resolve({ confirmed: false });
                      } else {
                          resolve({ confirmed: true, reason: res.content.trim() });
                      }
                  } else {
                      resolve({ confirmed: false });
                  }
              }
          });
      });
  },

  async doBatchDelete(ids, reason) {
      Toast.loading({ message: '处理中...', forbidClick: true });

      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'batchDelete',
                  data: {
                      ids,
                      archive_reason: reason
                  }
              }
          });

          if (res.result.success) {
              const { deleted, archived } = res.result;
              let msg = '操作完成';
              if (deleted > 0) msg += `\n已物理删除 ${deleted} 条`;
              if (archived > 0) msg += `\n已归档 ${archived} 条`;

              await Dialog.alert({ title: '结果', message: msg, messageAlign: 'left' });

              // Refresh
              this.toggleEditMode(); // Exit edit
              this.getList(true);
          } else {
              throw new Error(res.result.msg);
          }
      } catch (err) {
          Toast.fail(err.message || '操作失败');
      } finally {
          Toast.clear();
      }
  },

  // 批量还原
  onRestore() {
      const ids = this.data.selectedIds;
      if (ids.length === 0) return Toast.fail('请先选择');

      Dialog.confirm({
          title: '还原确认',
          message: `确定要还原这 ${ids.length} 个物料吗？\n还原后将立即生效。`
      }).then(async () => {
          Toast.loading('还原中...');

          let successCount = 0;
          for (const id of ids) {
              try {
                const res = await wx.cloud.callFunction({
                    name: 'manageMaterial',
                    data: { action: 'restore', data: { id } }
                });
                if (res.result.success) successCount++;
              } catch(e) {}
          }

          Toast.clear();
          Toast.success(`成功还原 ${successCount} 条`);
          this.toggleEditMode();
          this.getList(true);
      }).catch(() => {});
  },

  // 兼容旧的单点编辑入口
  onEdit(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
         url: `/pages/admin/material-edit?id=${id}`,
      });
  },

  // 单个归档入口 - 带理由输入
  async onArchive(e) {
      const id = e.currentTarget.dataset.id;
      const item = this.data.list.find(i => i._id === id);

      // 先检查是否有历史记录
      Toast.loading({ message: '检查中...', forbidClick: true });

      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'checkHistory',
                  data: { ids: [id] }
              }
          });

          Toast.clear();

          if (!res.result.success) {
              throw new Error(res.result.msg);
          }

          const { toDelete, toArchive } = res.result;

          if (toDelete.length > 0) {
              // 无历史记录 - 确认删除
              Dialog.confirm({
                  title: '⚠️ 永久删除警告',
                  message: `物料 ${item?.product_code || ''} 无历史记录。\n\n此操作将永久删除该物料，不可撤销！`,
                  confirmButtonText: '确认删除',
                  confirmButtonColor: '#ee0a24'
              }).then(() => {
                  this.doBatchDelete([id], '');
              }).catch(() => {});
          } else {
              // 有历史记录 - 输入归档原因
              wx.showModal({
                  title: '填写归档原因',
                  content: `归档物料: ${item?.product_code || ''}`,
                  editable: true,
                  placeholderText: '请输入归档原因（必填）',
                  success: (res) => {
                      if (res.confirm) {
                          if (!res.content || res.content.trim() === '') {
                              Toast.fail('请填写归档原因');
                          } else {
                              this.doBatchDelete([id], res.content.trim());
                          }
                      }
                  }
              });
          }
      } catch (err) {
          Toast.clear();
          Toast.fail(err.message || '检查失败');
      }
  },

  // 新增
  onAdd() {
    wx.navigateTo({ url: '/pages/admin/material-edit' });
  },

  // 导入
  onImport() {
    wx.navigateTo({ url: '/pages/admin/material-import/index' });
  }
});
