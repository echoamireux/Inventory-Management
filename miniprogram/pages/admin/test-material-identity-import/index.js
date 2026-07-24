// pages/admin/test-material-identity-import/index.js
import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  batchCreateTestMaterialIdentities,
  normalizeTestMaterialSupplier,
  normalizeTestMaterialSupplierModel
} = require('../../../utils/test-material-identity-service');
const { normalizeSearchKeyword } = require('../../../utils/search');
const {
  persistBase64File,
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta,
  resolveImportTemplateErrorMessage
} = require('../../../utils/import-file-parser');

const IDENTITY_TEMPLATE_HEADER_ROWS = [
  ['测试料产品代码*', '原厂型号*', '供应商（选填）'],
  ['必填，从下拉选择已启用测试料主数据', '必填；保留大小写，系统会整理全角和多余空格', '选填；作为入库和预打印默认供应商']
];
const INVALID_IDENTITY_TEMPLATE_MESSAGE = '请上传系统导出的测试料型号库模板';
const IDENTITY_TEMPLATE_BINARY_HINT = '当前运行环境未正确识别文件内容，请重新选择文件后再试';
const IDENTITY_TEMPLATE_RUNTIME_HINT = '当前前端与测试料型号库模板协议不一致，请更新小程序后重试';
const MAX_IMPORT_ROWS = 100;

function normalizeProductCode(value) {
  return normalizeSearchKeyword(value);
}

function buildPreviewRows(dataRows = []) {
  const seenKeys = new Map();
  return (Array.isArray(dataRows) ? dataRows : []).map((row, index) => {
    const productCode = normalizeProductCode(row.values && row.values[0]);
    const supplierModel = normalizeTestMaterialSupplierModel(row.values && row.values[1]);
    const supplier = normalizeTestMaterialSupplier(row.values && row.values[2]);
    const rowIndex = Number(row.rowIndex) || (index + 1);
    const errors = [];

    if (!productCode) {
      errors.push('测试料产品代码必填');
    } else if (!/^[A-Z]{1,4}-\d{3}$/u.test(productCode)) {
      errors.push('产品代码格式应为 J-999');
    }
    if (!supplierModel) {
      errors.push('原厂型号必填');
    }

    const duplicateKey = `${productCode}::${supplierModel}`;
    if (productCode && supplierModel) {
      const firstRowIndex = seenKeys.get(duplicateKey);
      if (firstRowIndex) {
        errors.push(`与第 ${firstRowIndex} 行重复`);
      } else {
        seenKeys.set(duplicateKey, rowIndex);
      }
    }

    const error = errors.join('；');
    return {
      previewKey: `${rowIndex}-${index}`,
      rowIndex,
      product_code: productCode,
      supplier_model: supplierModel,
      supplier,
      hasError: !!error,
      error
    };
  });
}

function buildImportMessage(result = {}, previewErrors = []) {
  const rowResults = Array.isArray(result.results) ? result.results : [];
  const created = Number(result.created) || rowResults.filter(item => item.status === 'created').length;
  const backendErrors = rowResults.filter(item => item.status === 'error');
  const skipped = Array.isArray(previewErrors) ? previewErrors.length : 0;
  const lines = [
    `新增 ${created} 条测试料型号。`
  ];

  if (backendErrors.length > 0) {
    lines.push(`导入失败 ${backendErrors.length} 条：`);
    backendErrors.slice(0, 8).forEach((item) => {
      lines.push(`- 第 ${item.rowIndex || '?'} 行：${item.msg || '导入失败'}`);
    });
    if (backendErrors.length > 8) {
      lines.push(`- 还有 ${backendErrors.length - 8} 条失败记录未展示，请按文件行号检查。`);
    }
  }

  if (skipped > 0) {
    lines.push(`预校验失败 ${skipped} 条未提交。`);
  }

  return lines.join('\n');
}

Page({
  options: {
    styleIsolation: 'shared'
  },

  data: {
    selectedFile: null,
    parsing: false,
    importing: false,
    exportingTemplate: false,
    importPreviewData: [],
    validCount: 0,
    errorCount: 0
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
  },

  onCopyTemplateStructure() {
    const templateRows = [
      IDENTITY_TEMPLATE_HEADER_ROWS[0],
      IDENTITY_TEMPLATE_HEADER_ROWS[1],
      ['J-999', 'MODEL-A', '供应商A']
    ];
    wx.setClipboardData({
      data: templateRows.map(row => row.join('\t')).join('\n'),
      success: () => {
        Dialog.alert({
          title: '简易结构已复制',
        message: '此内容只适合应急创建，不带系统下拉和模板协议。\n\n建议优先使用“导出最新模板”，按 B 列填写原厂型号，C 列可填写供应商后上传 .xlsx。',
          messageAlign: 'left',
          confirmButtonText: '我知道了'
        });
      },
      fail: () => {
        Toast.fail('复制失败');
      }
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
      const result = res.result || {};
      if (!result.success) {
        throw new Error(result.msg || '导出模板失败');
      }
      if (!result.fileID && !result.fileContentBase64) {
        throw new Error('无法导出模板，请重新部署 exportTestMaterialIdentityTemplate 云函数后再试');
      }

      Toast.loading({ message: '正在打开模板...', forbidClick: true, duration: 0 });
      let localFilePath = '';
      const fallbackFileName = result.fileName || '测试料型号库导入模板.xlsx';
      if (result.fileContentBase64) {
        localFilePath = await persistBase64File({
          fileContentBase64: result.fileContentBase64,
          fileName: fallbackFileName,
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName
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
          fileName: fallbackFileName,
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName
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
        message: '已生成并打开最新模板。\n\n请在 B 列填写原厂型号，C 列可选填供应商，保存后回到本页上传 .xlsx 文件预览并导入。',
        messageAlign: 'left',
        confirmButtonText: '我知道了'
      });
    } catch (err) {
      console.error('导出测试料型号模板失败', err);
      Toast.clear();
      await Dialog.alert({
        title: '无法导出模板',
        message: err.message || '导出模板失败',
        messageAlign: 'left',
        confirmButtonText: '我知道了'
      });
    } finally {
      this.setData({ exportingTemplate: false });
    }
  },

  onChooseImportFile() {
    if (this.data.parsing || this.data.importing) {
      return;
    }

    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          return;
        }
        this.setData({ selectedFile: file });
        this.parseImportFile(file);
      }
    });
  },

  parseImportFile(file) {
    const filePath = file && (file.path || file.tempFilePath);
    if (!filePath) {
      Toast.fail('读取文件失败');
      return;
    }

    this.setData({
      parsing: true,
      importPreviewData: [],
      validCount: 0,
      errorCount: 0
    });

    wx.getFileSystemManager().readFile({
      filePath,
      success: (res) => {
        try {
          const rows = parseImportTemplateFileBuffer(res.data, {
            fileName: file.name || filePath || '',
            sheetName: '测试料型号库',
            expectedHeaderRows: IDENTITY_TEMPLATE_HEADER_ROWS,
            invalidTemplateMessage: INVALID_IDENTITY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: IDENTITY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: IDENTITY_TEMPLATE_RUNTIME_HINT
          });
          const templateMeta = getParsedTemplateMeta(rows) || {};
          const dataStartRowIndex = Number(templateMeta.dataStartRowIndex) || 3;
          const dataRows = rows
            .filter(item => item.rowIndex >= dataStartRowIndex)
            .filter(item => item.values.some(value => String(value == null ? '' : value).trim()));

          if (dataRows.length > MAX_IMPORT_ROWS) {
            Toast.fail(`单次最多导入 ${MAX_IMPORT_ROWS} 条测试料型号`);
            this.setData({
              parsing: false,
              importPreviewData: [],
              validCount: 0,
              errorCount: 0
            });
            return;
          }

          const importPreviewData = buildPreviewRows(dataRows);
          const validCount = importPreviewData.filter(item => !item.hasError).length;
          const errorCount = importPreviewData.filter(item => item.hasError).length;

          this.setData({
            importPreviewData,
            validCount,
            errorCount,
            parsing: false
          });

          if (importPreviewData.length === 0) {
            Toast.fail('未检测到可导入数据');
          }
        } catch (err) {
          console.error('解析测试料型号模板失败', err);
          Toast.fail(resolveImportTemplateErrorMessage(err, {
            fallbackMessage: '文件解析失败',
            sheetName: '测试料型号库',
            invalidTemplateMessage: INVALID_IDENTITY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: IDENTITY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: IDENTITY_TEMPLATE_RUNTIME_HINT
          }));
          this.setData({ parsing: false });
        }
      },
      fail: (err) => {
        console.error('读取测试料型号模板失败', err);
        Toast.fail('读取文件失败');
        this.setData({ parsing: false });
      }
    });
  },

  async onImportPreviewRows() {
    const previewErrors = this.data.importPreviewData.filter(item => item.hasError);
    const validRows = this.data.importPreviewData
      .filter(item => !item.hasError)
      .map(item => ({
        rowIndex: item.rowIndex,
        product_code: item.product_code,
        supplier_model: item.supplier_model,
        supplier: item.supplier
      }));

    if (validRows.length === 0) {
      Toast.fail('没有可导入的数据');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: '确认导入',
      message: previewErrors.length > 0
        ? `将导入 ${validRows.length} 条测试料型号，另有 ${previewErrors.length} 条预校验失败不会导入，是否继续？`
        : `将导入 ${validRows.length} 条测试料型号，是否继续？`,
      messageAlign: 'left',
      confirmButtonText: '确认导入',
      cancelButtonText: '取消'
    }).then(() => true).catch(() => false);

    if (!confirmed) {
      return;
    }

    this.setData({ importing: true });
    Toast.loading({ message: '导入中...', forbidClick: true, duration: 0 });

    try {
      const result = await batchCreateTestMaterialIdentities(validRows);
      Toast.clear();
      await Dialog.alert({
        title: '导入完成',
        message: buildImportMessage(result, previewErrors),
        messageAlign: 'left',
        confirmButtonText: '完成'
      });
      wx.navigateBack();
    } catch (err) {
      console.error('导入测试料型号失败', err);
      Toast.fail(err.message || '导入失败');
    } finally {
      this.setData({ importing: false });
    }
  }
});
