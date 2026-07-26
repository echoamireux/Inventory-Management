// pages/admin/material-list.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
const {
  listTestMaterialIdentities
} = require('../../utils/test-material-identity-service');
const { normalizeSearchKeyword } = require('../../utils/search');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

function buildSearchNoticeText(...messages) {
  return Array.from(new Set(
    messages
      .map(message => String(message || '').trim())
      .filter(Boolean)
  )).join('；');
}

Page({
  data: {
    activeTab: 'materials', // materials | testIdentity
    materialStatus: 'active', // active | archived
    list: [],
    identityList: [],
    searchVal: '',
    hasSearchKeyword: false,
    materialSearchMessage: '',
    identitySearchMessage: '',
    searchNoticeText: '',
    loading: false,
    identityLoading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    identityPage: 1,
    identityPageSize: 20,
    identityTotal: 0,
    identityIsEnd: false,
    isEnd: false,
    requestId: 0,
    identityRequestId: 0,
    hasLoadedOnce: false,
    lastSeenMasterDataChangedAt: 0,

    // 批量管理模式
    isEditMode: false,
    selectedIds: [],
    selectedCount: 0,
    isAllSelected: false
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.user || !['admin', 'super_admin'].includes(app.globalData.user.role)) {
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
    const app = getApp();
    const masterDataChangedAt = (app.globalData && app.globalData.masterDataChangedAt) || 0;
    if (
      !this.data.hasLoadedOnce
      || !masterDataChangedAt
      || masterDataChangedAt === this.data.lastSeenMasterDataChangedAt
    ) {
      return;
    }

    if (normalizeSearchKeyword(this.data.searchVal)) {
      this.refreshSearchResults();
      return;
    }
    if (this.data.activeTab === 'testIdentity') {
      this.loadIdentityResults({ refresh: true });
      return;
    }
    this.getList(true);
  },

  onPullDownRefresh() {
    if (normalizeSearchKeyword(this.data.searchVal)) {
      Promise.all([
        this.getList(true),
        this.loadIdentityResults({ refresh: true })
      ]).finally(() => wx.stopPullDownRefresh());
      return;
    }
    if (this.data.activeTab === 'testIdentity') {
      this.loadIdentityResults({ refresh: true }).finally(() => wx.stopPullDownRefresh());
    } else {
      this.getList(true).finally(() => wx.stopPullDownRefresh());
    }
  },

  onReachBottom() {
    if (normalizeSearchKeyword(this.data.searchVal)) {
      if (!this.data.isEnd && !this.data.loading) {
        this.getList(false);
      }
      if (!this.data.identityIsEnd && !this.data.identityLoading) {
        this.loadIdentityResults();
      }
      return;
    }
    if (this.data.activeTab === 'testIdentity') {
      if (!this.data.identityIsEnd && !this.data.identityLoading) {
        this.loadIdentityResults();
      }
      return;
    }
    if (!this.data.isEnd && !this.data.loading) {
      this.loadMore();
    }
  },

  // 切换筛选状态
  onTabChange(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      activeTab: e.detail.name,
      page: 1,
      isEnd: false,
      total: 0,
      identityPage: 1,
      identityIsEnd: false,
      identityTotal: 0,
       // 切换 Tab 时退出编辑模式
      isEditMode: false,
      selectedIds: [],
      selectedCount: 0,
      isAllSelected: false
    }, () => {
      this.refreshSearchResults();
    });
  },

  async getList(refresh = false) {
    if (this.data.activeTab === 'testIdentity' && !normalizeSearchKeyword(this.data.searchVal)) {
      return this.loadIdentityResults({ refresh });
    }
    if (!refresh && this.data.loading) return;

    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const page = refresh ? 1 : this.data.page;
      const { searchVal, pageSize, materialStatus } = this.data;
      const normalizedSearchVal = normalizeSearchKeyword(searchVal);

      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal,
            page,
            pageSize,
            // 传递状态筛选参数
            status: normalizedSearchVal ? 'all' : materialStatus
          }
        }
      });

      if (res.result.success) {
        if (this.data.requestId !== currentRequestId) {
          return;
        }
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
          page: page + 1,
          total: res.result.total,
          isEnd,
          hasLoadedOnce: true,
          lastSeenMasterDataChangedAt: (getApp().globalData && getApp().globalData.masterDataChangedAt) || 0,
          materialSearchMessage: normalizedSearchVal ? (res.result.searchMessage || '') : '',
          searchNoticeText: normalizedSearchVal
            ? buildSearchNoticeText(res.result.searchMessage, this.data.identitySearchMessage)
            : ''
        });

        if (!normalizedSearchVal && this.data.activeTab !== 'testIdentity') {
          this.setData({
            identityList: [],
            identityTotal: 0,
            identityPage: 1,
            identityIsEnd: false,
            identitySearchMessage: '',
            searchNoticeText: ''
          });
        }
      } else {
        Toast.fail(res.result.msg || '加载失败');
      }
    } catch (err) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(err);
      Toast.fail('加载失败');
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
    }
  },

  loadMore() {
    this.getList(false);
  },

  async loadIdentityResults({ refresh = false, compact = false } = {}) {
    if (!refresh && this.data.identityLoading) return;

    const currentRequestId = this.data.identityRequestId + 1;
    this.setData({
      identityLoading: true,
      identityRequestId: currentRequestId
    });

    try {
      const page = refresh || compact ? 1 : this.data.identityPage;
      const pageSize = compact ? 5 : this.data.identityPageSize;
      const result = await listTestMaterialIdentities({
        page,
        pageSize,
        includeDisabled: this.data.activeTab === 'testIdentity' || !!normalizeSearchKeyword(this.data.searchVal),
        searchVal: this.data.searchVal
      });

      if (this.data.identityRequestId !== currentRequestId) {
        return;
      }

      const newList = result.list || [];
      const identityList = refresh || compact
        ? newList
        : [...this.data.identityList, ...newList];
      const identityTotal = Number(result.total) || 0;
      const normalizedSearchVal = normalizeSearchKeyword(this.data.searchVal);
      this.setData({
        identityList,
        identityTotal,
        identityPage: page + 1,
        identityIsEnd: compact ? true : identityList.length >= identityTotal,
        hasLoadedOnce: true,
        lastSeenMasterDataChangedAt: (getApp().globalData && getApp().globalData.masterDataChangedAt) || 0,
        identitySearchMessage: normalizedSearchVal ? (result.searchMessage || '') : '',
        searchNoticeText: normalizedSearchVal
          ? buildSearchNoticeText(this.data.materialSearchMessage, result.searchMessage)
          : ''
      });
    } catch (err) {
      if (this.data.identityRequestId !== currentRequestId) {
        return;
      }
      console.error(err);
      Toast.fail(err.message || '加载测试料型号失败');
    } finally {
      if (this.data.identityRequestId === currentRequestId) {
        this.setData({ identityLoading: false });
      }
    }
  },

  onSearch(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    const hasSearchKeyword = !!normalizeSearchKeyword(searchVal);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      searchVal,
      hasSearchKeyword,
      page: 1,
      isEnd: false,
      identityPage: 1,
      identityIsEnd: false,
      materialSearchMessage: '',
      identitySearchMessage: '',
      searchNoticeText: ''
    });
    this.refreshSearchResults();
  },

  onSearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    const hasSearchKeyword = !!normalizeSearchKeyword(searchVal);
    this.setData({
      searchVal,
      hasSearchKeyword,
      page: 1,
      isEnd: false,
      identityPage: 1,
      identityIsEnd: false,
      materialSearchMessage: '',
      identitySearchMessage: '',
      searchNoticeText: ''
    });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refreshSearchResults(), 400);
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      searchVal: '',
      hasSearchKeyword: false,
      page: 1,
      isEnd: false,
      identityPage: 1,
      identityIsEnd: false,
      identityList: [],
      identityTotal: 0,
      materialSearchMessage: '',
      identitySearchMessage: '',
      searchNoticeText: ''
    });
    this.refreshSearchResults();
  },

  refreshSearchResults() {
    if (normalizeSearchKeyword(this.data.searchVal)) {
      Promise.all([
        this.getList(true),
        this.loadIdentityResults({ refresh: true })
      ]);
      return;
    }
    if (this.data.activeTab === 'testIdentity') {
      this.loadIdentityResults({ refresh: true });
    } else {
      this.getList(true);
    }
  },

  onMaterialStatusChange(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const materialStatus = (e && e.detail && e.detail.name) || 'active';
    this.setData({
      materialStatus,
      page: 1,
      isEnd: false,
      isEditMode: false,
      selectedIds: [],
      selectedCount: 0,
      isAllSelected: false
    }, () => {
      if (!normalizeSearchKeyword(this.data.searchVal)) {
        this.getList(true);
      }
    });
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  },

  // ==========================================
  // 批量管理逻辑
  // ==========================================

  // 长按进入编辑模式
  onLongPress(e) {
      if (
        this.data.isEditMode
        || this.data.activeTab !== 'materials'
        || normalizeSearchKeyword(this.data.searchVal)
      ) return;

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
          selectedCount: 1,
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
          selectedCount: 0,
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

  onIdentityItemClick(e) {
    const id = String(e.currentTarget.dataset.id || '').trim();
    wx.navigateTo({
      url: id
        ? `/pages/admin/test-material-identity-edit/index?id=${encodeURIComponent(id)}`
        : '/pages/admin/test-material-identity-edit/index'
    });
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
          selectedCount: ids.length,
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
          selectedIds: ids,
          selectedCount: ids.length
      });
  },

  noop() {},

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
      Toast.loading({ message: '检查中', forbidClick: true });

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
      Toast.loading({ message: '处理中', forbidClick: true });

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
              getApp().globalData.masterDataChangedAt = Date.now();
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
          Toast.loading('还原中');

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
          if (successCount > 0) {
            getApp().globalData.masterDataChangedAt = Date.now();
          }
          this.toggleEditMode();
          this.getList(true);
      }).catch(() => {});
  },

  // 单个归档入口 - 带理由输入
  async onArchive(e) {
      const id = e.currentTarget.dataset.id;
      const item = this.data.list.find(i => i._id === id);

      // 先检查是否有历史记录
      Toast.loading({ message: '检查中', forbidClick: true });

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
  },

  onCreateTestMaterialIdentity() {
    wx.navigateTo({ url: '/pages/admin/test-material-identity-edit/index' });
  },

  onOpenTestMaterialIdentityManage() {
    wx.navigateTo({ url: '/pages/admin/test-material-identity-manage/index' });
  }
});
