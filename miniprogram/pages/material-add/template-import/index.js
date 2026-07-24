import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  normalizeInventoryTemplateExportResult
} = require('../../../utils/inventory-template-export');
const {
  assertInventoryTemplateImportLimit,
  normalizeInventoryTemplatePreviewResult,
  normalizeInventoryTemplateSubmitResult
} = require('../../../utils/inventory-template-import');
const {
  persistBase64File,
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta,
  resolveImportTemplateErrorMessage
} = require('../../../utils/import-file-parser');
const {
  ensureOperationId,
  clearOperationId
} = require('../../../utils/operation-id');
const {
  runChunkedBatchTask,
  saveBatchTask,
  loadBatchTask,
  clearBatchTask
} = require('../../../utils/batch-task');

const TEMPLATE_BATCH_TASK_SCOPE = 'importInventoryTemplate:submit';

const INVENTORY_TEMPLATE_HEADER_ROWS = [
  ['基础信息', '', '', '', '', '库位信息', '', '化材信息', '', '膜材信息', '', '', '来源信息', '', '', '时效信息', ''],
  ['标签编号*', '代码前缀*', '产品编号*', '类别*', '生产批号*', '存储区域*', '详细坐标', '净含量', '包装形式', '膜材厚度(μm)', '本批次实际幅宽(mm)', '长度(m)', '供应商', '原厂型号', '样品说明/备注', '过期日期', '长期有效'],
  ['必填', '必填', '必填', '必填', '必填', '必填', '条件必填', '化材必填', '化材选填', '膜材条件必填', '膜材必填', '膜材必填', '选填', '测试料必填', '选填', '二选一', '二选一']
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
      return;
    }
    this.offerPendingBatchTask();
  },

  offerPendingBatchTask() {
    const task = loadBatchTask(TEMPLATE_BATCH_TASK_SCOPE);
    if (!task || !Array.isArray(task.items) || !task.items.length) {
      return;
    }

    setTimeout(async () => {
      const shouldResume = await Dialog.confirm({
        title: '发现未完成导入任务',
        message: `已完成 ${Number(task.succeeded) || 0}/${task.items.length} 条，是否继续重试未完成批次？`,
        messageAlign: 'left',
        confirmButtonText: '继续',
        cancelButtonText: '取消任务'
      }).then(() => true).catch(() => false);

      if (!shouldResume) {
        clearBatchTask(TEMPLATE_BATCH_TASK_SCOPE);
        clearOperationId(TEMPLATE_BATCH_TASK_SCOPE);
        return;
      }
      await this.executeTemplateBatchTask(task);
    }, 0);
  },

  async executeTemplateBatchTask(task) {
    const completedChunkIndexes = Array.isArray(task.completedChunkIndexes)
      ? task.completedChunkIndexes.slice()
      : [];
    saveBatchTask(TEMPLATE_BATCH_TASK_SCOPE, task);
    this.setData({ importing: true });
    Toast.loading({ message: '分批入库中...', forbidClick: true, duration: 0 });

    const result = await runChunkedBatchTask({
      items: task.items,
      rootOperationId: task.rootOperationId,
      completedChunkIndexes,
      submitChunk: async ({ items, operationId }) => normalizeInventoryTemplateSubmitResult(
        await wx.cloud.callFunction({
          name: 'importInventoryTemplate',
          data: {
            action: 'submit',
            operation_id: operationId,
            data: { items }
          }
        })
      ),
      onProgress: chunk => {
        if (chunk.status === 'completed' && !completedChunkIndexes.includes(chunk.chunk_index)) {
          completedChunkIndexes.push(chunk.chunk_index);
        }
        saveBatchTask(TEMPLATE_BATCH_TASK_SCOPE, {
          ...task,
          completedChunkIndexes,
          succeeded: completedChunkIndexes.reduce((total, chunkIndex) => {
            const start = chunkIndex * 10;
            return total + task.items.slice(start, start + 10).length;
          }, 0)
        });
      }
    });

    Toast.clear();
    this.setData({ importing: false });
    if (result.status === 'completed') {
      clearBatchTask(TEMPLATE_BATCH_TASK_SCOPE);
      clearOperationId(TEMPLATE_BATCH_TASK_SCOPE);
      await Dialog.alert({
        title: '入库完成',
        message: `成功处理 ${result.succeeded} 条`,
        messageAlign: 'left',
        confirmButtonText: '完成'
      });
      wx.navigateBack();
      return result;
    }

    saveBatchTask(TEMPLATE_BATCH_TASK_SCOPE, {
      ...task,
      completedChunkIndexes,
      succeeded: result.succeeded,
      lastResult: result
    });
    const failure = result.failed[0] || {};
    await Dialog.alert({
      title: result.status === 'partial' ? '部分入库成功' : '入库失败',
      message: `已成功 ${result.succeeded}/${result.total} 条。\n失败批次：第 ${Number(failure.chunk_index) + 1} 批\n失败行：${(failure.row_indexes || []).join('、')}\n原因：${failure.msg || '批次处理失败'}\n\n可稍后重新进入本页继续重试。`,
      messageAlign: 'left'
    });
    return result;
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

      Toast.loading({ message: '正在打开模板...', forbidClick: true, duration: 0 });
      let localFilePath = '';
      if (result.fileContentBase64) {
        localFilePath = await persistBase64File({
          fileContentBase64: result.fileContentBase64,
          fileName: result.fileName || '库存入库模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '库存入库模板.xlsx'
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
          fileName: result.fileName || '库存入库模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '库存入库模板.xlsx'
        });
      }

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
    try {
      assertInventoryTemplateImportLimit(validItems.length);
    } catch (error) {
      Toast.fail(error.message || '单次导入数量过多');
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

    try {
      const operationPayload = { items: validItems };
      const result = await this.executeTemplateBatchTask({
        rootOperationId: ensureOperationId(TEMPLATE_BATCH_TASK_SCOPE, operationPayload, 'tplin'),
        items: validItems,
        completedChunkIndexes: [],
        succeeded: 0
      });
      return result;
    } catch (error) {
      console.error('模板导入入库失败', error);
      Toast.fail(error.message || '入库失败');
    }
  }
});
