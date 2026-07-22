import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  listTestMaterialIdentities,
  createTestMaterialIdentity,
  batchCreateTestMaterialIdentities,
  setTestMaterialIdentityStatus
} = require('../../../utils/test-material-identity-service');
const {
  persistBase64File,
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  parseImportTemplateFileBuffer,
  resolveImportTemplateErrorMessage
} = require('../../../utils/import-file-parser');

const IDENTITY_TEMPLATE_HEADER_ROWS = [
  ['测试料产品代码*', '物料名称（系统参考）', '原厂型号*'],
  ['必填，从下拉选择已启用测试料主数据', '系统参考，随产品代码自动带出', '必填；保留大小写，系统会整理全角和多余空格']
];
const INVALID_IDENTITY_TEMPLATE_MESSAGE = '请上传系统导出的测试料型号库模板';
const IDENTITY_TEMPLATE_BINARY_HINT = '当前运行环境未正确识别文件内容，请重新选择文件后再试';
const MAX_IMPORT_ROWS = 100;

function getInputValue(e) {
  if (e && e.detail && e.detail.value !== undefined) {
    return e.detail.value;
  }
  if (e && e.detail !== undefined) {
    return e.detail;
  }
  return '';
}

function normalizeSupplierModel(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/\s*([-/])\s*/gu, '$1');
}

function normalizeProductCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function buildPreviewRows(rows = []) {
  return rows
    .filter(item => item && Array.isArray(item.values))
    .filter(item => item.rowIndex >= 3)
    .map((item) => {
      const productCode = normalizeProductCode(item.values[0]);
      const materialNameRef = String(item.values[1] || '').trim();
      const supplierModel = normalizeSupplierModel(item.values[2]);
      let error = '';
      if (!productCode) {
        error = '测试料产品代码必填';
      } else if (!/^[A-Z]{1,4}-\d{3}$/u.test(productCode)) {
        error = '产品代码格式应为 J-999';
      } else if (!supplierModel) {
        error = '原厂型号必填';
      }
      return {
        rowIndex: item.rowIndex,
        product_code: productCode,
        material_name_ref: materialNameRef,
        supplier_model: supplierModel,
        error,
        hasError: !!error,
        previewKey: `${item.rowIndex}:${productCode}:${materialNameRef}:${supplierModel}:${error || 'ok'}`
      };
    })
    .filter(item => item.product_code || item.supplier_model);
}

function buildImportMessage(result = {}, previewErrors = []) {
  const lines = [`新增 ${Number(result.created) || 0} 条测试料型号`];
  const results = Array.isArray(result.results) ? result.results : [];
  const failed = results.filter(item => item.status === 'error');
  if (previewErrors.length || failed.length) {
    lines.push(`失败 ${previewErrors.length + failed.length} 条`);
    lines.push('');
    previewErrors.concat(failed).slice(0, 20).forEach((item) => {
      lines.push(`第 ${item.rowIndex} 行：${item.msg || item.error || '导入失败'}`);
    });
  }
  return lines.join('\n');
}

Page({
  data: {
    identities: [],
    total: 0,
    loading: false,
    searchVal: '',
    includeDisabled: true,
    formVisible: false,
    formSubmitting: false,
    materialSearching: false,
    materialSuggestions: [],
    formSupplierModelError: '',
    form: {
      material_id: '',
      product_code: '',
      material_name: '',
      category: '',
      materialSearchVal: '',
      supplier_model: ''
    },
    selectedFile: null,
    importPreviewData: [],
    importing: false,
    exportingTemplate: false
  },

  onLoad() {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    this.loadIdentities();
  },

  async loadIdentities() {
    this.setData({ loading: true });
    try {
      const result = await listTestMaterialIdentities({
        includeDisabled: this.data.includeDisabled,
        searchVal: this.data.searchVal,
        pageSize: 100
      });
      this.setData({
        identities: result.list,
        total: result.total
      });
    } catch (err) {
      Toast.fail(err.message || '加载测试料型号失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  onSearchChange(e) {
    this.setData({ searchVal: getInputValue(e) });
  },

  onSearchConfirm() {
    this.loadIdentities();
  },

  onClearSearch() {
    this.setData({ searchVal: '' });
    this.loadIdentities();
  },

  onCreateIdentity() {
    this.setData({
      formVisible: true,
      formSupplierModelError: '',
      materialSuggestions: [],
      form: {
        material_id: '',
        product_code: '',
        material_name: '',
        category: '',
        materialSearchVal: '',
        supplier_model: ''
      }
    });
  },

  onCloseForm() {
    if (this.data.formSubmitting) return;
    this.setData({ formVisible: false });
  },

  onMaterialSearchInput(e) {
    const value = getInputValue(e);
    this.setData({
      'form.materialSearchVal': value
    });
    if (this.materialSearchTimer) {
      clearTimeout(this.materialSearchTimer);
    }
    this.materialSearchTimer = setTimeout(() => {
      this.searchTestMaterials(value);
    }, 300);
  },

  async searchTestMaterials(keyword) {
    const value = String(keyword || '').trim();
    if (!value) {
      this.setData({ materialSuggestions: [] });
      return;
    }
    this.setData({ materialSearching: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'list',
          data: {
            searchVal: value,
            pageSize: 20
          }
        }
      });
      if (!(res.result && res.result.success)) {
        throw new Error((res.result && res.result.msg) || '查询物料失败');
      }
      const suggestions = (res.result.list || [])
        .filter(item => item.is_test_material && item.status !== 'archived')
        .map(item => ({
          _id: item._id,
          product_code: item.product_code,
          material_name: item.material_name || item.name || '',
          category: item.category
        }));
      this.setData({ materialSuggestions: suggestions });
    } catch (err) {
      Toast.fail(err.message || '查询物料失败');
    } finally {
      this.setData({ materialSearching: false });
    }
  },

  onSelectMaterial(e) {
    const item = e.currentTarget.dataset.item || {};
    this.setData({
      'form.material_id': item._id || '',
      'form.product_code': item.product_code || '',
      'form.material_name': item.material_name || '',
      'form.category': item.category || '',
      'form.materialSearchVal': `${item.product_code || ''} ${item.material_name || ''}`.trim(),
      materialSuggestions: []
    });
  },

  onSupplierModelInput(e) {
    const value = normalizeSupplierModel(getInputValue(e));
    this.setData({
      'form.supplier_model': value,
      formSupplierModelError: value ? '' : '请输入原厂型号'
    });
  },

  async submitForm(confirmSimilar = false) {
    const form = this.data.form;
    const supplierModel = normalizeSupplierModel(form.supplier_model);
    if (!form.material_id && !form.product_code) {
      Toast.fail('请先选择测试料主数据');
      return;
    }
    if (!supplierModel) {
      this.setData({ formSupplierModelError: '请输入原厂型号' });
      Toast.fail('请输入原厂型号');
      return;
    }

    this.setData({ formSubmitting: true });
    try {
      await createTestMaterialIdentity({
        material_id: form.material_id,
        product_code: form.product_code,
        supplier_model: supplierModel,
        confirmSimilar
      });
      Toast.success('创建成功');
      this.setData({ formVisible: false });
      await this.loadIdentities();
    } catch (err) {
      if (err.code === 'SIMILAR_TEST_MATERIAL_IDENTITY') {
        const confirmed = await Dialog.confirm({
          title: '发现相似型号',
          message: err.message || '已存在相似型号，是否仍要新增？',
          messageAlign: 'left',
          confirmButtonText: '仍要新增',
          cancelButtonText: '取消'
        }).then(() => true).catch(() => false);
        if (confirmed) {
          await this.submitForm(true);
        }
        return;
      }
      Toast.fail(err.message || '创建失败');
    } finally {
      this.setData({ formSubmitting: false });
    }
  },

  onSubmitForm() {
    this.submitForm(false);
  },

  async onToggleStatus(e) {
    const record = this.data.identities[e.currentTarget.dataset.index];
    if (!record) return;
    const nextStatus = record.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';
    try {
      await setTestMaterialIdentityStatus(record, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadIdentities();
    } catch (err) {
      Toast.fail(err.message || `${actionLabel}失败`);
    }
  },

  onCopyTemplateStructure() {
    wx.setClipboardData({
      data: [
        ['测试料产品代码*', '物料名称（系统参考）', '原厂型号*'].join('\t'),
        ['必填，从下拉选择已启用测试料主数据', '系统参考，随产品代码自动带出', '必填；保留大小写，系统会整理全角和多余空格'].join('\t'),
        ['J-999', '测试料主数据', 'MODEL-A'].join('\t')
      ].join('\n')
    });
  },

  async onExportLatestTemplate() {
    if (this.data.exportingTemplate) {
      return;
    }

    this.setData({ exportingTemplate: true });
    Toast.loading({ message: '正在生成模板...', forbidClick: true, duration: 0 });

    try {
      const res = await wx.cloud.callFunction({
        name: 'exportTestMaterialIdentityTemplate'
      });
      const result = res && res.result ? res.result : {};
      if (!result.success) {
        throw new Error(result.msg || '导出模板失败');
      }
      if (!result.fileID) {
        throw new Error('当前云函数版本过旧，请部署最新版 exportTestMaterialIdentityTemplate');
      }

      Toast.loading({ message: '正在打开模板...', forbidClick: true, duration: 0 });
      let localFilePath = '';
      if (result.fileContentBase64) {
        localFilePath = await persistBase64File({
          fileContentBase64: result.fileContentBase64,
          fileName: result.fileName || '测试料型号库导入模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '测试料型号库导入模板.xlsx'
        });
      } else {
        const downRes = await wx.cloud.downloadFile({
          fileID: result.fileID
        });

        if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
          throw new Error('模板下载失败');
        }

        localFilePath = await resolveOpenDocumentPath({
          tempFilePath: downRes.tempFilePath,
          fileName: result.fileName || '测试料型号库导入模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '测试料型号库导入模板.xlsx'
        });
      }

      Toast.clear();
      await wx.openDocument({
        filePath: localFilePath,
        showMenu: true,
        fileType: 'xlsx'
      });

      await Dialog.alert({
        title: '模板已打开',
        message: '请在 A 列从下拉选择测试料产品代码，在 C 列填写真实原厂型号；完成后回到本页上传导入。',
        messageAlign: 'left',
        confirmButtonText: '我知道了'
      });
    } catch (err) {
      console.error('导出测试料型号库模板失败', err);
      Toast.fail(err.message || '导出模板失败');
    } finally {
      Toast.clear();
      this.setData({ exportingTemplate: false });
    }
  },

  onChooseImportFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ selectedFile: file });
        this.parseImportFile(file);
      }
    });
  },

  parseImportFile(file) {
    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath: file.path,
      success: (res) => {
        try {
          const rows = parseImportTemplateFileBuffer(res.data, {
            fileName: file.name || file.path || '',
            sheetName: '测试料型号库',
            expectedHeaderRows: IDENTITY_TEMPLATE_HEADER_ROWS,
            invalidTemplateMessage: INVALID_IDENTITY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: IDENTITY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: '当前前端与测试料型号库模板协议不一致，请更新小程序后重试'
          });
          const previewData = buildPreviewRows(rows);
          if (previewData.length > MAX_IMPORT_ROWS) {
            Toast.fail(`单次最多导入 ${MAX_IMPORT_ROWS} 条测试料型号`);
            this.setData({ importPreviewData: [] });
            return;
          }
          this.setData({ importPreviewData: previewData });
          if (!previewData.length) {
            Toast.fail('未检测到可导入数据');
          }
        } catch (err) {
          Toast.fail(resolveImportTemplateErrorMessage(err, {
            fallbackMessage: '文件解析失败',
            sheetName: '测试料型号库',
            invalidTemplateMessage: INVALID_IDENTITY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: IDENTITY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: '当前前端与测试料型号库模板协议不一致，请更新小程序后重试'
          }));
        }
      },
      fail: () => Toast.fail('读取文件失败')
    });
  },

  async onImportPreviewRows() {
    const previewErrors = this.data.importPreviewData.filter(item => item.hasError);
    const validRows = this.data.importPreviewData.filter(item => !item.hasError);
    if (!validRows.length) {
      Toast.fail('没有可导入的数据');
      return;
    }

    this.setData({ importing: true });
    try {
      const result = await batchCreateTestMaterialIdentities(validRows);
      await Dialog.alert({
        title: '导入完成',
        message: buildImportMessage(result, previewErrors),
        messageAlign: 'left'
      });
      this.setData({
        selectedFile: null,
        importPreviewData: []
      });
      await this.loadIdentities();
    } catch (err) {
      Toast.fail(err.message || '导入失败');
    } finally {
      this.setData({ importing: false });
    }
  }
});
