import Toast from '@vant/weapp/toast/toast';
const {
  normalizeLabelExportResult
} = require('../../../utils/label-export');
const {
  resolveOpenDocumentPath
} = require('../../../utils/download-file');

const TEMPLATE_CATEGORY_MAP = {
  film: 'film',
  chemical_std: 'chemical',
  chemical_mini: 'chemical'
};

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

function buildRequestId() {
  return `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decorateMaterial(item = {}) {
  return {
    ...item,
    display_name: item.material_name || item.name || '--',
    display_code: item.product_code || '--',
    display_model: item.supplier_model || '',
    is_test_material: !!item.is_test_material
  };
}

Page({
  options: {
    styleIsolation: 'shared'
  },

  data: {
    mode: 'preprint',
    templateType: 'film',
    preprintForm: {
      materialSearchVal: '',
      selectedMaterial: null,
      count: 1,
      supplier_model: '',
      supplier: '',
      sample_note: '',
      requestId: buildRequestId(),
      lastJobId: '',
      lastRecords: []
    },
    materialSuggestions: [],
    materialSearching: false,
    materialSearchState: '',
    creatingPreprint: false,
    exportingPreprint: false,
    voidingPreprint: false,
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
    if (this.data.mode === 'reprint') {
      this.getList(true);
    } else {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom() {
    if (this.data.mode !== 'reprint' || this.data.loading || this.data.isEnd) {
      return;
    }
    this.getList(false);
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
      this.materialSearchTimer = null;
    }
  },

  onModeChange(e) {
    const mode = (e.detail && e.detail.name) || e.detail || 'preprint';
    this.setData({ mode });
    if (mode === 'reprint' && !this.data.hasLoadedOnce) {
      this.getList(true);
    }
  },

  onTemplateChange(e) {
    const templateType = (e.detail && e.detail.name) || e.detail || 'film';
    if (templateType === this.data.templateType) {
      return;
    }

    this.resetSelection();
    this.materialSearchRequestId = (this.materialSearchRequestId || 0) + 1;
    this.setData({
      templateType,
      page: 1,
      isEnd: false,
      materialSuggestions: [],
      materialSearchState: '',
      'preprintForm.materialSearchVal': '',
      'preprintForm.selectedMaterial': null,
      'preprintForm.supplier_model': '',
      'preprintForm.supplier': '',
      'preprintForm.sample_note': '',
      'preprintForm.requestId': buildRequestId(),
      'preprintForm.lastJobId': '',
      'preprintForm.lastRecords': []
    });
    this.getList(true);
  },

  onPreprintFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = resolveSearchValue(e && e.detail);
    if (!field) {
      return;
    }
    this.setData({
      [`preprintForm.${field}`]: value
    });
  },

  onPreprintCountChange(e) {
    const value = resolveSearchValue(e && e.detail);
    this.setData({
      'preprintForm.count': value
    });
  },

  onMaterialSearchChange(e) {
    const materialSearchVal = resolveSearchValue(e && e.detail);
    const keyword = String(materialSearchVal || '').trim();
    this.setData({
      'preprintForm.materialSearchVal': materialSearchVal,
      'preprintForm.selectedMaterial': null,
      materialSuggestions: [],
      materialSearchState: keyword ? 'loading' : ''
    });

    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
    }
    if (!keyword) {
      this.materialSearchRequestId = (this.materialSearchRequestId || 0) + 1;
      this.setData({ materialSuggestions: [], materialSearchState: '' });
      return;
    }

    this.materialSearchTimer = setTimeout(() => {
      this.searchMaterialSuggestions(keyword);
    }, 400);
  },

  onMaterialSearchClear() {
    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
      this.materialSearchTimer = null;
    }
    this.materialSearchRequestId = (this.materialSearchRequestId || 0) + 1;
    this.setData({
      'preprintForm.materialSearchVal': '',
      'preprintForm.selectedMaterial': null,
      materialSuggestions: [],
      materialSearchState: ''
    });
  },

  async searchMaterialSuggestions(searchVal) {
    const requestId = (this.materialSearchRequestId || 0) + 1;
    this.materialSearchRequestId = requestId;
    this.setData({ materialSearching: true, materialSearchState: 'loading' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal,
            category: TEMPLATE_CATEGORY_MAP[this.data.templateType],
            pageSize: 8
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '查询物料失败');
      }
      const suggestions = Array.isArray(res.result.list)
        ? res.result.list.map(decorateMaterial)
        : [];
      if (requestId !== this.materialSearchRequestId) {
        return;
      }
      this.setData({
        materialSuggestions: suggestions,
        materialSearchState: suggestions.length > 0 ? '' : 'empty'
      });
    } catch (error) {
      console.error(error);
      if (requestId === this.materialSearchRequestId) {
        this.setData({
          materialSuggestions: [],
          materialSearchState: 'error'
        });
      }
      Toast.fail(error.message || '查询物料失败');
    } finally {
      if (requestId === this.materialSearchRequestId) {
        this.setData({ materialSearching: false });
      }
    }
  },

  onSelectMaterial(e) {
    const item = e.currentTarget.dataset.item;
    const material = decorateMaterial(item || {});
    this.setData({
      'preprintForm.selectedMaterial': material,
      'preprintForm.materialSearchVal': `${material.display_code} ${material.display_name}`,
      'preprintForm.supplier_model': material.supplier_model || '',
      'preprintForm.supplier': material.supplier || '',
      materialSuggestions: [],
      materialSearchState: ''
    });
  },

  async onCreatePreprintJob() {
    if (this.data.creatingPreprint) {
      return;
    }
    const { preprintForm, templateType } = this.data;
    const selectedMaterial = preprintForm.selectedMaterial;
    if (!selectedMaterial || !selectedMaterial._id) {
      Toast.fail('请先从搜索结果中选择物料');
      return;
    }
    if (selectedMaterial.is_test_material && !String(preprintForm.supplier_model || '').trim()) {
      Toast.fail('测试料必须填写原厂型号');
      return;
    }

    this.setData({ creatingPreprint: true });
    Toast.loading({ message: '正在生成新标签...', forbidClick: true, duration: 0 });
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'createPreprintJob',
          data: {
            requestId: preprintForm.requestId,
            templateType,
            materialId: selectedMaterial._id,
            count: preprintForm.count,
            form: {
              supplier_model: preprintForm.supplier_model,
              supplier: preprintForm.supplier,
              sample_note: preprintForm.sample_note
            }
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '生成失败');
      }
      Toast.success(res.result.reused ? '已复用本批标签' : '生成成功');
      this.setData({
        'preprintForm.lastJobId': res.result.job_id || '',
        'preprintForm.lastRecords': res.result.records || []
      });
    } catch (error) {
      console.error(error);
      Toast.fail(error.message || '生成失败');
    } finally {
      this.setData({ creatingPreprint: false });
    }
  },

  async onExportPreprintJob() {
    if (this.data.exportingPreprint) {
      return;
    }
    const { preprintForm, templateType } = this.data;
    if (!preprintForm.lastJobId) {
      Toast.fail('请先生成新标签');
      return;
    }

    this.setData({ exportingPreprint: true });
    Toast.loading({ message: '正在生成文件...', forbidClick: true, duration: 0 });
    try {
      const result = normalizeLabelExportResult(await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'exportPreprintJob',
          data: {
            templateType,
            jobId: preprintForm.lastJobId
          }
        }
      }));
      await this.downloadAndOpenWorkbook(result);
      Toast.success('文件已打开');
    } catch (error) {
      console.error('导出预生成标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exportingPreprint: false });
    }
  },

  async onVoidPreprintLabels() {
    if (this.data.voidingPreprint) {
      return;
    }
    const records = this.data.preprintForm.lastRecords || [];
    const ids = records
      .filter(item => item.status === 'unused')
      .map(item => item._id)
      .filter(Boolean);
    if (!ids.length) {
      Toast.fail('本批没有可作废的未入库标签');
      return;
    }

    this.setData({ voidingPreprint: true });
    Toast.loading({ message: '正在作废标签...', forbidClick: true, duration: 0 });
    try {
      const res = await wx.cloud.callFunction({
        name: 'exportLabelData',
        data: {
          action: 'voidPreprintLabels',
          data: {
            ids
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '作废失败');
      }
      Toast.success('已作废');
      const nextRecords = records.map(item => ids.includes(item._id)
        ? { ...item, status: 'voided' }
        : item);
      this.setData({
        'preprintForm.lastRecords': nextRecords
      });
    } catch (error) {
      console.error('作废预生成标签失败', error);
      Toast.fail(error.message || '作废失败');
    } finally {
      this.setData({ voidingPreprint: false });
    }
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

  async downloadAndOpenWorkbook(result) {
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

      await this.downloadAndOpenWorkbook(result);
      Toast.success('文件已打开');
    } catch (error) {
      console.error('导出信息标签失败', error);
      Toast.fail(error.message || '导出失败');
    } finally {
      this.setData({ exporting: false });
    }
  }
});
