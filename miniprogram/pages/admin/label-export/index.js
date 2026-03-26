import Toast from '@vant/weapp/toast/toast';
const {
  normalizeLabelExportResult
} = require('../../../utils/label-export');
const {
  resolveOpenDocumentPath
} = require('../../../utils/download-file');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

function decorateSelectedState(list = [], selectedIds = []) {
  const selectedIdSet = new Set(selectedIds || []);
  return (list || []).map(item => ({
    ...item,
    _selected: selectedIdSet.has(item._id)
  }));
}

function openDocument(options = {}) {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      ...options,
      success: resolve,
      fail: reject
    });
  });
}

Page({
  options: {
    styleIsolation: 'shared'
  },

  data: {
    templateType: 'film',
    searchVal: '',
    list: [],
    loading: false,
    exporting: false,
    hasLoadedOnce: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0,
    selectedIds: []
  },

  async onLoad() {
    const app = getApp();
    const currentUser = app.globalData.user;
    if (!currentUser || currentUser.status !== 'active') {
      wx.showModal({
        title: '无权限',
        content: '仅已激活用户可访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    await this.getList(true);
  },

  onPullDownRefresh() {
    this.getList(true);
  },

  onReachBottom() {
    if (this.data.loading || this.data.isEnd) {
      return;
    }
    this.getList(false);
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  onTemplateChange(e) {
    const templateType = (e.detail && e.detail.name) || e.detail || 'film';
    if (templateType === this.data.templateType) {
      return;
    }

    this.resetSelection();
    this.setData({
      templateType,
      page: 1,
      isEnd: false
    });
    this.getList(true);
  },

  onSearch(e) {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const searchVal = resolveSearchValue(e && e.detail);
    this.resetSelection();
    this.setData({
      searchVal,
      page: 1,
      isEnd: false
    });
    this.getList(true);
  },

  onSearchChange(e) {
    const searchVal = resolveSearchValue(e && e.detail);
    this.setData({
      searchVal
    });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      this.resetSelection();
      this.setData({
        page: 1,
        isEnd: false
      });
      this.getList(true);
    }, 500);
  },

  onSearchClear() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    this.resetSelection();
    this.setData({
      searchVal: '',
      page: 1,
      isEnd: false
    });
    this.getList(true);
  },

  resetSelection() {
    this.setData({
      selectedIds: [],
      list: decorateSelectedState(this.data.list, [])
    });
  },

  async getList(reset = true) {
    if (!reset && this.data.loading) {
      wx.stopPullDownRefresh();
      return;
    }

    const nextPage = reset ? 1 : this.data.page;
    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const { searchVal, templateType, pageSize, list, selectedIds } = this.data;
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'list',
          data: {
            searchVal,
            templateType,
            page: nextPage,
            pageSize
          }
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载失败');
      }

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const pageList = res.result.list || [];
      const mergedList = reset ? pageList : list.concat(pageList);
      this.setData({
        list: decorateSelectedState(mergedList, selectedIds),
        total: Number(res.result.total) || mergedList.length,
        page: nextPage + 1,
        isEnd: Boolean(res.result.isEnd),
        hasLoadedOnce: true
      });
    } catch (error) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(error);
      Toast.fail(error.message || '加载失败');
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  toggleSelectItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }

    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter(item => item !== id)
      : this.data.selectedIds.concat(id);

    this.setData({
      selectedIds,
      list: decorateSelectedState(this.data.list, selectedIds)
    });
  },

  async onExportSelected() {
    if (this.data.exporting || this.data.selectedIds.length === 0) {
      if (this.data.selectedIds.length === 0) {
        Toast.fail('请先勾选需要打印的标签');
      }
      return;
    }

    this.setData({ exporting: true });
    Toast.loading({ message: '正在生成文件...', forbidClick: true, duration: 0 });

    try {
      const result = normalizeLabelExportResult(await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'export',
          data: {
            templateType: this.data.templateType,
            selectedIds: this.data.selectedIds
          }
        }
      }));

      Toast.loading({ message: '正在下载文件...', forbidClick: true, duration: 0 });
      const downRes = await wx.cloud.downloadFile({
        fileID: result.fileID
      });

      if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
        throw new Error('文件下载失败');
      }

      const localFilePath = await resolveOpenDocumentPath({
        tempFilePath: downRes.tempFilePath,
        fileName: result.fileName || '信息标签.xlsx',
        fileSystemManager: wx.getFileSystemManager(),
        userDataPath: wx.env.USER_DATA_PATH,
        fallbackFileName: '信息标签.xlsx'
      });

      Toast.clear();
      await openDocument({
        filePath: localFilePath,
        showMenu: true,
        fileType: 'xlsx'
      });
      Toast.success('文件已打开');
    } catch (error) {
      console.error('导出信息标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exporting: false });
    }
  }
});
