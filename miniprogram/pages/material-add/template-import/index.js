import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  normalizeInventoryTemplateExportResult
} = require('../../../utils/inventory-template-export');
const {
  normalizeInventoryTemplatePreviewResult,
  normalizeInventoryTemplateSubmitResult
} = require('../../../utils/inventory-template-import');
const {
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta,
  resolveImportTemplateErrorMessage
} = require('../../../utils/import-file-parser');

const INVENTORY_TEMPLATE_HEADER_ROWS = [
  ['基础信息', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '时效信息', ''],
  ['标签编号*', '产品代码*', '类别*', '生产批号*', '存储区域*', '详细坐标', '净含量', '包装形式', '膜材厚度(μm)', '本批次实际幅宽(mm)', '长度(m)', '供应商', '原厂型号', '过期日期', '长期有效'],
  ['必填', '必填', '必填', '必填', '必填', '选填', '化材必填', '化材选填', '膜材条件必填', '膜材必填', '膜材必填', '选填', '选填', '二选一', '二选一']
];
const INVALID_INVENTORY_TEMPLATE_MESSAGE = '请重新导出最新库存入库模板后填写';
const INVENTORY_TEMPLATE_BINARY_HINT = '当前运行环境未正确识别文件内容，请重新选择文件后再试';
const INVENTORY_TEMPLATE_RUNTIME_HINT = '当前前端与库存模板协议不一致，请更新小程序后重试';

function resolveValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
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
    selectedFile: null,
    parsing: false,
    importing: false,
    exportingTemplate: false,
    previewData: [],
    validCount: 0,
    errorCount: 0,
    warningCount: 0,
    refillCount: 0,
    createCount: 0
  },

  onLoad() {
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
    }
  },

  async onExportLatestTemplate() {
    if (this.data.exportingTemplate) {
      return;
    }

    this.setData({ exportingTemplate: true });
    Toast.loading({ message: '正在生成模板...', forbidClick: true, duration: 0 });

    try {
      const result = normalizeInventoryTemplateExportResult(await wx.cloud.callFunction({
        name: 'exportInventoryTemplate'
      }));

      Toast.loading({ message: '正在下载模板...', forbidClick: true, duration: 0 });
      const downRes = await wx.cloud.downloadFile({
        fileID: result.fileID
      });

      if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
        throw new Error('模板下载失败');
      }

      const localFilePath = await resolveOpenDocumentPath({
        tempFilePath: downRes.tempFilePath,
        fileName: result.fileName || '库存入库模板.xlsx',
        fileSystemManager: wx.getFileSystemManager(),
        userDataPath: wx.env.USER_DATA_PATH,
        fallbackFileName: '库存入库模板.xlsx'
      });

      Toast.clear();
      await openDocument({
        filePath: localFilePath,
        showMenu: true,
        fileType: 'xlsx'
      });

      await Dialog.alert({
        title: '模板已打开',
        message: '已生成并打开最新模板。\n\n请直接上传系统导出的 .xlsx 文件进行预览并确认入库。',
        messageAlign: 'left',
        confirmButtonText: '我知道了'
      });
    } catch (error) {
      console.error('导出库存入库模板失败', error);
      Toast.fail(error.message || '导出模板失败');
    } finally {
      Toast.clear();
      this.setData({ exportingTemplate: false });
    }
  },

  onChooseFile() {
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
    this.setData({
      parsing: true,
      previewData: [],
      validCount: 0,
      errorCount: 0,
      warningCount: 0,
      refillCount: 0,
      createCount: 0
    });

    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath: file.path,
      success: async (res) => {
        try {
          const rows = parseImportTemplateFileBuffer(res.data, {
            fileName: file.name || file.path || '',
            sheetName: '库存入库表',
            expectedHeaderRows: INVENTORY_TEMPLATE_HEADER_ROWS,
            invalidTemplateMessage: INVALID_INVENTORY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: INVENTORY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: INVENTORY_TEMPLATE_RUNTIME_HINT
          });
          const templateMeta = getParsedTemplateMeta(rows);

          const cloudRes = await wx.cloud.callFunction({
            name: 'importInventoryTemplate',
            data: {
              action: 'preview',
              data: {
                rows,
                templateMeta
              }
            }
          });
          const result = normalizeInventoryTemplatePreviewResult(cloudRes);
          const refillCount = result.list.filter(item => !item.hasError && item.submit_action === 'refill').length;
          const createCount = result.list.filter(item => !item.hasError && item.submit_action !== 'refill').length;

          this.setData({
            previewData: result.list,
            validCount: result.validCount,
            errorCount: result.errorCount,
            warningCount: result.warningCount,
            refillCount,
            createCount,
            parsing: false
          });
        } catch (error) {
          console.error('库存模板解析失败', error);
          Toast.fail(resolveImportTemplateErrorMessage(error, {
            fallbackMessage: '文件解析失败',
            sheetName: '库存入库表',
            invalidTemplateMessage: INVALID_INVENTORY_TEMPLATE_MESSAGE,
            binaryPayloadMessage: INVENTORY_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: INVENTORY_TEMPLATE_RUNTIME_HINT
          }));
          this.setData({ parsing: false });
        }
      },
      fail: (error) => {
        console.error('读取文件失败', error);
        Toast.fail('读取文件失败');
        this.setData({ parsing: false });
      }
    });
  },

  async onImport() {
    const previewErrors = this.data.previewData.filter(item => item.hasError);
    const validItems = this.data.previewData.filter(item => !item.hasError);
    const refillItems = validItems.filter(item => item.submit_action === 'refill');
    const createItems = validItems.filter(item => item.submit_action !== 'refill');

    if (!validItems.length) {
      Toast.fail('没有可入库的数据');
      return;
    }

    const confirmLines = [];
    if (createItems.length > 0) {
      confirmLines.push(`本次将新增 ${createItems.length} 条`);
    }
    if (refillItems.length > 0) {
      confirmLines.push(`本次将补料 ${refillItems.length} 条`);
    }
    if (previewErrors.length > 0) {
      confirmLines.push(`另有 ${previewErrors.length} 条错误不会导入`);
    }
    confirmLines.push('是否继续？');

    const confirmed = await Dialog.confirm({
      title: '确认入库',
      message: confirmLines.join('\n'),
      messageAlign: 'left'
    }).catch(() => false);

    if (!confirmed) {
      return;
    }

    this.setData({ importing: true });
    Toast.loading({ message: '入库中...', forbidClick: true, duration: 0 });

    try {
      const res = await wx.cloud.callFunction({
        name: 'importInventoryTemplate',
        data: {
          action: 'submit',
          data: {
            items: validItems
          }
        }
      });
      const result = normalizeInventoryTemplateSubmitResult(res);

      Toast.clear();
      const lines = [];
      if (createItems.length > 0) {
        lines.push(`新增 ${createItems.length} 条`);
      }
      if (refillItems.length > 0) {
        lines.push(`补料 ${refillItems.length} 条`);
      }
      if (!lines.length) {
        lines.push(`成功处理 ${result.created || validItems.length} 条`);
      }

      await Dialog.alert({
        title: '入库完成',
        message: lines.join('\n'),
        messageAlign: 'left',
        confirmButtonText: '完成'
      });

      wx.navigateBack();
    } catch (error) {
      console.error('模板导入入库失败', error);
      Toast.fail(error.message || '入库失败');
    } finally {
      this.setData({ importing: false });
    }
  }
});
