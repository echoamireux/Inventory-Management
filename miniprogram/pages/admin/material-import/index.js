// pages/admin/material-import/index.js
import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const { listSubcategoryRecords } = require('../../../utils/subcategory-service');
const { listProductCodePrefixes } = require('../../../utils/product-code-prefix-service');
const {
  isTemplateInlineHintRow,
  applyImportDuplicateGuards,
  decorateImportPreviewRows,
  validateImportRow,
  buildImportResultMessage
} = require('../../../utils/material-import');
const {
  normalizeTemplateExportResult
} = require('../../../utils/material-template-export');
const {
  persistBase64File,
  resolveOpenDocumentPath
} = require('../../../utils/download-file');
const {
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta,
  resolveImportTemplateErrorMessage
} = require('../../../utils/import-file-parser');

const MATERIAL_TEMPLATE_HEADER_ROWS = [
  ['代码前缀', '产品编号', '物料名称', '类别', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号', '是否测试料'],
  ['必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '正式选填/测试必填', '是/否，空白=否']
];
const INVALID_MATERIAL_TEMPLATE_MESSAGE = '请使用系统导出的最新版物料导入模板';
const MATERIAL_TEMPLATE_BINARY_HINT = '当前运行环境未正确识别文件内容，请重新选择文件后再试';
const MATERIAL_TEMPLATE_RUNTIME_HINT = '当前前端与物料模板协议不一致，请更新小程序后重试';
const MAX_IMPORT_ROWS = 100;

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
    subcategoriesByCategory: {
      chemical: [],
      film: []
    },
    productCodePrefixes: []
  },

  async onLoad() {
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

    await Promise.all([
      this.loadSubcategoryOptions(),
      this.loadProductCodePrefixes()
    ]);
  },

  async loadSubcategoryOptions() {
    try {
      const [chemicalRecords, filmRecords] = await Promise.all([
        listSubcategoryRecords('chemical', false),
        listSubcategoryRecords('film', false)
      ]);

      this.setData({
        subcategoriesByCategory: {
          chemical: chemicalRecords.map(item => item.name),
          film: filmRecords.map(item => item.name)
        }
      });
    } catch (err) {
      console.error('加载子类别失败', err);
      Toast.fail(err.message || '加载子类别失败');
    }
  },

  async loadProductCodePrefixes() {
    try {
      const productCodePrefixes = await listProductCodePrefixes(false);
      this.setData({ productCodePrefixes });
    } catch (err) {
      console.error('加载产品代码前缀失败', err);
      Toast.fail(err.message || '加载产品代码前缀失败');
    }
  },

  async onExportLatestTemplate() {
    if (this.data.exportingTemplate) {
      return;
    }

    this.setData({ exportingTemplate: true });
    Toast.loading({ message: '正在生成模板...', forbidClick: true, duration: 0 });

    try {
      const result = normalizeTemplateExportResult(await wx.cloud.callFunction({
        name: 'exportMaterialTemplate'
      }));

      Toast.loading({ message: '正在打开模板...', forbidClick: true, duration: 0 });
      let localFilePath = '';
      if (result.fileContentBase64) {
        localFilePath = await persistBase64File({
          fileContentBase64: result.fileContentBase64,
          fileName: result.fileName || '标准物料导入模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '标准物料导入模板.xlsx'
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
          fileName: result.fileName || '标准物料导入模板.xlsx',
          fileSystemManager: wx.getFileSystemManager(),
          userDataPath: wx.env.USER_DATA_PATH,
          fallbackFileName: '标准物料导入模板.xlsx'
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
        message: '已生成并打开最新模板。\n\n单次最多导入 100 行。测试料请使用已维护代码，填“是否测试料=是”，且原厂型号必填。\n\n填写后请直接上传系统导出的 .xlsx 文件回到本页预览并导入。',
        messageAlign: 'left',
        confirmButtonText: '我知道了'
      });
    } catch (err) {
      console.error('导出最新模板失败', err);
      Toast.fail(err.message || '导出模板失败');
    } finally {
      Toast.clear();
      this.setData({ exportingTemplate: false });
    }
  },

  // 复制简易结构 - 仅应急
  onCopyTemplateStructure() {
    const chemicalSubcategories = this.data.subcategoriesByCategory.chemical || [];
    const filmSubcategories = this.data.subcategoriesByCategory.film || [];
    // 模板内容（用 Tab 分隔便于粘贴到 Excel）
    const templateRows = [
      // 表头
      ['代码前缀', '产品编号', '物料名称', '类别', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号', '是否测试料'],
      // 固定提示行
      ['必填', '必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '正式选填/测试必填', '是/否，空白=否'],
      // 空行 - 从这里开始填写数据
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      // 说明区（与数据区用空行分隔）
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', '', ''],
      ['【重要：填写说明】请仔细阅读以下内容', '', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['▶ 操作步骤：', '', '', '', '', '', '', '', '', ''],
      ['1. 在【第3行】开始填写物料数据（第1行是表头，第2行是填写提示，不要修改）', '', '', '', '', '', '', '', '', ''],
      ['2. 每行填写一个物料，单次最多导入 100 行，【不要留空行】', '', '', '', '', '', '', '', '', ''],
      ['3. 正式物料和测试料可在同一个模板维护，通过“是否测试料”区分', '', '', '', '', '', '', '', '', ''],
      ['4. 测试料请填“是否测试料=是”，产品代码必须是已维护并启用的测试料代码，且原厂型号必填；物料名称和子类别用于标签、入库和库存展示', '', '', '', '', '', '', '', '', ''],
      ['5. 填写完成后，【删除】所有空行和本说明区，再直接保存并上传 .xlsx 文件', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['▶ 字段说明：（* 表示必填）', '', '', '', '', '', '', '', '', ''],
      ['代码前缀*：必填。请先填写类别，再选择该类别可用前缀；只填写 1-4 位英文字母，不填写横杠', '', '', '', '', '', '', '', '', ''],
      ['产品编号*：必填，填写 1-3 位数字（如 1 或 001）；系统会与代码前缀组合为完整产品代码', '', '', '', '', '', '', '', '', ''],
      ['物料名称*：必填', '', '', '', '', '', '', '', '', ''],
      ['类别*：必填，只能填 "化材" 或 "膜材"', '', '', '', '', '', '', '', '', ''],
      ['子类别*：必填，必须填写系统内已启用的正式子类别', '', '', '', '', '', '', '', '', ''],
      ['默认单位*：必填。化材仅支持 g/kg/mL/L；膜材仅支持 m/m²', '', '', '', '', '', '', '', '', ''],
      ['化材包装形式：选填，仅化材使用；膜材请留空', '', '', '', '', '', '', '', '', ''],
      ['膜材厚度(μm)*：膜材必填；化材请留空', '', '', '', '', '', '', '', '', ''],
      ['默认幅宽(mm)：膜材选填；化材请留空。填写即写入主数据默认幅宽，留空则后续补齐', '', '', '', '', '', '', '', '', ''],
      ['供应商：选填。正式物料写主数据供应商；测试料写该型号默认供应商', '', '', '', '', '', '', '', '', '', ''],
      ['原厂型号：正式物料选填；测试料必填，用于区分同一测试料产品代码下的不同样品', '', '', '', '', '', '', '', '', '', ''],
      ['是否测试料：填“是”或“否”，空白按“否”处理；选择“是”时，本行会维护测试料型号，产品代码必须是已维护测试料代码', '', '', '', '', '', '', '', '', '', ''],
      ['正式物料若产品代码已存在，系统会跳过；测试料若“产品代码+原厂型号”已存在，系统会跳过', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['▶ 当前有效子类别：', '', '', '', '', '', '', '', '', ''],
      [`【化材】${chemicalSubcategories.length > 0 ? chemicalSubcategories.join(' | ') : '请先在“子类别管理”中维护后再导入'}`, '', '', '', '', '', '', '', '', ''],
      [`【膜材】${filmSubcategories.length > 0 ? filmSubcategories.join(' | ') : '请先在“子类别管理”中维护后再导入'}`, '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['▶ 单位选项：', '', '', '', '', '', '', '', '', ''],
      ['【化材】kg | g | L | mL', '', '', '', '', '', '', '', '', ''],
      ['【膜材】m | m²', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['▶ 示例：', '', '', '', '', '', '', '', '', ''],
      ['J', '001', '异丙醇', '化材', '溶剂', 'L', '桶装', '', '', '国药', 'IPA-99', '否'],
      ['J', '999', '环氧树脂样品', '化材', '树脂', 'g', '瓶装', '', '', '供应商A', 'TEST-RESIN-A', '是'],
      ['M', '002', 'PET保护膜', '膜材', '保护膜', 'm', '', '25', '1240', '东丽', 'T100', '否']
    ];

    // 构建 Tab 分隔内容；说明行也补齐到表头列数，避免粘贴到 Excel 后列数漂移。
    const columnCount = MATERIAL_TEMPLATE_HEADER_ROWS[0].length;
    const normalizedTemplateRows = templateRows.map((row) => {
      if (row.length >= columnCount) {
        return row;
      }
      return row.concat(Array(columnCount - row.length).fill(''));
    });
    let content = normalizedTemplateRows.map(row => row.join('\t')).join('\n');

    wx.setClipboardData({
      data: content,
      success: () => {
        Dialog.alert({
          title: '简易结构已复制',
          message: '此内容仅包含最基础的列名结构，不带正式下拉和校验。\n\n建议优先使用“导出最新模板”获取系统当前规则，再填写后直接上传 .xlsx。',
          messageAlign: 'left',
          confirmButtonText: '我知道了'
        });
      },
      fail: () => {
        Toast.fail('复制失败');
      }
    });
  },

  // 选择文件 - 仅支持 XLSX
  async onChooseFile() {
    if (
      !this.data.subcategoriesByCategory.chemical.length ||
      !this.data.subcategoriesByCategory.film.length
    ) {
      await this.loadSubcategoryOptions();
    }

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
    this.setData({ parsing: true, previewData: [] });

    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath: file.path,
      success: (res) => {
        try {
          const rows = parseImportTemplateFileBuffer(res.data, {
            fileName: file.name || file.path || '',
            sheetName: '物料导入表',
            expectedHeaderRows: MATERIAL_TEMPLATE_HEADER_ROWS,
            invalidTemplateMessage: INVALID_MATERIAL_TEMPLATE_MESSAGE,
            binaryPayloadMessage: MATERIAL_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: MATERIAL_TEMPLATE_RUNTIME_HINT
          });
          const templateMeta = getParsedTemplateMeta(rows) || {};
          const dataStartRowIndex = Number(templateMeta.dataStartRowIndex) || 3;
          const dataRows = rows
            .filter(item => item.rowIndex >= dataStartRowIndex)
            .filter(item => item.values.some(value => String(value == null ? '' : value).trim()))
            .filter(item => !isTemplateInlineHintRow(item.values))
            .filter(item => item.values.length >= 3 && item.values[0] && item.values[1] && item.values[2]);

          if (dataRows.length > MAX_IMPORT_ROWS) {
            throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 条物料数据，请拆分文件后再上传`);
          }

          const rawPreviewData = dataRows.map((row) => {
            return this.validateRow(row.values, row.rowIndex - 2);
          });
          const previewData = decorateImportPreviewRows(applyImportDuplicateGuards(rawPreviewData));

          const validCount = previewData.filter(item => !item.error).length;
          const errorCount = previewData.filter(item => item.error).length;
          const warningCount = previewData.filter(item => item.hasWarning && !item.hasError && item.warning).length;

          this.setData({
            previewData,
            validCount,
            errorCount,
            warningCount,
            parsing: false
          });

          if (previewData.length === 0) {
            Toast.fail('未检测到有效数据行');
          }
        } catch (err) {
          console.error('解析失败', err);
          Toast.fail(resolveImportTemplateErrorMessage(err, {
            fallbackMessage: '文件解析失败',
            sheetName: '物料导入表',
            invalidTemplateMessage: INVALID_MATERIAL_TEMPLATE_MESSAGE,
            binaryPayloadMessage: MATERIAL_TEMPLATE_BINARY_HINT,
            legacyRuntimeMessage: MATERIAL_TEMPLATE_RUNTIME_HINT
          }));
          this.setData({ parsing: false });
        }
      },
      fail: (err) => {
        console.error('读取文件失败', err);
        Toast.fail('读取文件失败');
        this.setData({ parsing: false });
      }
    });
  },

  // 校验单行数据
  validateRow(row, index) {
    return validateImportRow(row, index, this.data.subcategoriesByCategory, this.data.productCodePrefixes);
  },

  // 确认导入
  async onImport() {
    const previewErrors = this.data.previewData.filter(item => item.error);
    const previewWarnings = this.data.previewData.filter(item => item.hasWarning && !item.hasError && item.warning);
    const validItems = this.data.previewData.filter(item => !item.error);

    if (validItems.length === 0) {
      Toast.fail('没有可导入的数据');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: '确认导入',
      message: previewErrors.length > 0
        ? `将导入 ${validItems.length} 条物料数据，另有 ${previewErrors.length} 条预校验失败不会导入，是否继续？`
        : `将导入 ${validItems.length} 条物料数据，是否继续？`
    }).catch(() => false);

    if (!confirmed) return;

    this.setData({ importing: true });
    Toast.loading({ message: '导入中...', forbidClick: true, duration: 0 });

    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'batchCreate',
          data: { items: validItems }
        }
      });

      Toast.clear();

      if (res.result.success) {
        const finalMsg = buildImportResultMessage(res.result, previewErrors, previewWarnings);

        await Dialog.alert({
          title: '导入完成',
          message: finalMsg,
          messageAlign: 'left',
          confirmButtonText: '完成'
        });

        wx.navigateBack();
      } else {
        Toast.fail(res.result.msg || '导入失败');
      }
    } catch (err) {
      console.error('导入失败', err);
      Toast.fail('导入失败');
    } finally {
      this.setData({ importing: false });
    }
  }
});
