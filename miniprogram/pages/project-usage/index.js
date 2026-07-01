import Toast from '@vant/weapp/toast/toast';
const { listProjectCodes, buildProjectCodePickerColumns } = require('../../utils/project-code-service');
const { resolveOpenDocumentPath } = require('../../utils/download-file');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
}

function decorateDetailRows(rows = []) {
  return rows.map(item => ({
    ...item,
    _timeStr: formatDateTime(item.timestamp),
    _quantityText: `${normalizeQuantity(item.quantity)} ${item.unit || ''}`.trim(),
    _projectText: item.project_name ? `${item.project_code} - ${item.project_name}` : item.project_code || '-',
    _noteText: item.withdraw_note || item.note || item.description || ''
  }));
}

function decorateSummaryRows(rows = []) {
  return rows.map(item => ({
    ...item,
    _quantityText: `${normalizeQuantity(item.total_quantity)} ${item.unit || ''}`.trim(),
    _projectText: item.projects || '-'
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
  data: {
    activeTab: 'detail',
    detailList: [],
    summaryList: [],
    projectOptions: [{ text: '全部项目编码', value: 'all', project_code: 'all', project_name: '' }],
    selectedProjectCode: 'all',
    selectedProjectName: '',
    keyword: '',
    startDate: '',
    endDate: '',
    showProjectPicker: false,
    loading: false,
    exporting: false,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false,
    requestId: 0
  },

  onLoad() {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.status !== 'active') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限已激活用户访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    this.loadProjectOptions();
    this.loadReport(true);
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadProjectOptions(),
      this.loadReport(true)
    ]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.isEnd && this.data.activeTab === 'detail') {
      this.loadReport(false);
    }
  },

  async loadProjectOptions() {
    try {
      const projects = await listProjectCodes(false);
      this.setData({
        projectOptions: [
          { text: '全部项目编码', value: 'all', project_code: 'all', project_name: '' },
          ...buildProjectCodePickerColumns(projects)
        ]
      });
    } catch (err) {
      console.warn('加载项目编码失败:', err);
      Toast.fail(err.message || '加载项目编码失败');
    }
  },

  buildQueryPayload(page) {
    const {
      selectedProjectCode,
      keyword,
      startDate,
      endDate,
      pageSize
    } = this.data;

    return {
      project_code: selectedProjectCode,
      keyword,
      startDate,
      endDate,
      page,
      pageSize
    };
  },

  async loadReport(reset = false) {
    if (!reset && this.data.loading) {
      return;
    }

    const nextPage = reset ? 1 : this.data.page;
    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getProjectUsageReport',
        data: this.buildQueryPayload(nextPage)
      });
      const result = res.result || {};
      if (!result.success) {
        throw new Error(result.msg || '项目用料查询失败');
      }
      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const detailRows = decorateDetailRows(result.detailList || result.list || []);
      const nextDetailList = reset ? detailRows : this.data.detailList.concat(detailRows);
      this.setData({
        detailList: nextDetailList,
        summaryList: decorateSummaryRows(result.summaryList || []),
        total: Number(result.total) || nextDetailList.length,
        page: nextPage + 1,
        isEnd: !!result.isEnd
      });
    } catch (err) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(err);
      Toast.fail(err.message || '项目用料查询失败');
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
    }
  },

  onTabChange(e) {
    this.setData({ activeTab: e.detail.name });
  },

  onSearch(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      keyword: resolveSearchValue(e && e.detail),
      page: 1,
      isEnd: false
    });
    this.loadReport(true);
  },

  onSearchChange(e) {
    this.setData({
      keyword: resolveSearchValue(e && e.detail),
      page: 1,
      isEnd: false
    });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.loadReport(true);
    }, 400);
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ keyword: '', page: 1, isEnd: false });
    this.loadReport(true);
  },

  onShowProjectPicker() {
    this.setData({ showProjectPicker: true });
  },

  onProjectPickerCancel() {
    this.setData({ showProjectPicker: false });
  },

  onProjectPickerConfirm(e) {
    const detail = e.detail || {};
    const rawSelected = detail.value || this.data.projectOptions[detail.index] || this.data.projectOptions[0];
    const selected = typeof rawSelected === 'string'
      ? this.data.projectOptions.find(item => item.value === rawSelected || item.project_code === rawSelected) || {
        value: rawSelected,
        project_code: rawSelected,
        project_name: ''
      }
      : rawSelected;
    this.setData({
      selectedProjectCode: selected.project_code || selected.value || 'all',
      selectedProjectName: selected.project_name || '',
      showProjectPicker: false,
      page: 1,
      isEnd: false
    });
    this.loadReport(true);
  },

  onStartDateChange(e) {
    this.setData({ startDate: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
  },

  onEndDateChange(e) {
    this.setData({ endDate: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
  },

  onApplyDateFilter() {
    this.loadReport(true);
  },

  onClearFilters() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      keyword: '',
      selectedProjectCode: 'all',
      selectedProjectName: '',
      startDate: '',
      endDate: '',
      page: 1,
      isEnd: false
    });
    this.loadReport(true);
  },

  async onExportReport() {
    if (this.data.exporting) {
      return;
    }

    this.setData({ exporting: true });
    Toast.loading({ message: '正在生成报表...', forbidClick: true, duration: 0 });
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportProjectUsageReport',
        data: this.buildQueryPayload(1)
      });
      const result = res.result || {};
      if (!result.success || !result.fileID) {
        throw new Error(result.msg || '导出失败');
      }
      Toast.loading({ message: '正在打开文件...', forbidClick: true, duration: 0 });
      const downRes = await wx.cloud.downloadFile({
        fileID: result.fileID
      });
      if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
        throw new Error('文件下载失败');
      }
      const localFilePath = await resolveOpenDocumentPath({
        tempFilePath: downRes.tempFilePath,
        fileName: result.fileName || `项目用料报表_${formatDate(new Date())}.xlsx`,
        fileSystemManager: wx.getFileSystemManager(),
        userDataPath: wx.env.USER_DATA_PATH,
        fallbackFileName: '项目用料报表.xlsx'
      });
      Toast.clear();
      await openDocument({
        filePath: localFilePath,
        showMenu: true,
        fileType: 'xlsx'
      });
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '导出失败');
    } finally {
      this.setData({ exporting: false });
    }
  }
});
