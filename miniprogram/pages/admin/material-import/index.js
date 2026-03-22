// pages/admin/material-import/index.js
import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const { listSubcategoryRecords } = require('../../../utils/subcategory-service');
const {
  isTemplateInlineHintRow,
  applyImportDuplicateGuards,
  validateImportRow,
  buildImportResultMessage
} = require('../../../utils/material-import');
const {
  normalizeTemplateExportResult
} = require('../../../utils/material-template-export');

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
    }
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

    await this.loadSubcategoryOptions();
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

      Toast.loading({ message: '正在下载模板...', forbidClick: true, duration: 0 });
      const downRes = await wx.cloud.downloadFile({
        fileID: result.fileID
      });

      if (downRes.statusCode !== 200 || !downRes.tempFilePath) {
        throw new Error('模板下载失败');
      }

      Toast.clear();
      await wx.openDocument({
        filePath: downRes.tempFilePath,
        showMenu: true,
        fileType: 'xlsx'
      });

      await Dialog.alert({
        title: '模板已打开',
        message: '已生成并打开最新模板。\n\n请填写后另存为 CSV，再回到本页上传导入。',
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
      ['产品代码', '物料名称', '类别', '子类别', '默认单位', '化材包装形式', '膜材厚度(μm)', '默认幅宽(mm)', '供应商', '原厂型号'],
      // 固定提示行
      ['必填', '必填', '必填', '必填', '必填', '化材选填', '膜材必填', '膜材选填', '选填', '选填'],
      // 空行 - 从这里开始填写数据
      ['', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      // 说明区（与数据区用空行分隔）
      ['', '', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', '', ''],
      ['【重要：填写说明】请仔细阅读以下内容', '', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['▶ 操作步骤：', '', '', '', '', '', '', '', '', ''],
      ['1. 在【第3行】开始填写物料数据（第1行是表头，第2行是填写提示，不要修改）', '', '', '', '', '', '', '', '', ''],
      ['2. 每行填写一个物料，【不要留空行】', '', '', '', '', '', '', '', '', ''],
      ['3. 如果数据超过5行，请在第6行之前【插入】新行，不要在说明区填写', '', '', '', '', '', '', '', '', ''],
      ['4. 填写完成后，【删除】所有空行和本说明区', '', '', '', '', '', '', '', '', ''],
      ['5. 另存为 CSV 格式（文件 → 另存为 → 选择 CSV）', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['▶ 字段说明：（* 表示必填）', '', '', '', '', '', '', '', '', ''],
      ['产品代码*：必填，建议填写 3 位数字（如 001）；系统会统一成标准格式', '', '', '', '', '', '', '', '', ''],
      ['物料名称*：必填', '', '', '', '', '', '', '', '', ''],
      ['类别*：必填，只能填 "化材" 或 "膜材"', '', '', '', '', '', '', '', '', ''],
      ['子类别*：必填，必须填写系统内已启用的正式子类别', '', '', '', '', '', '', '', '', ''],
      ['默认单位*：必填。化材仅支持 kg/g/L/mL；膜材仅支持 m/m²', '', '', '', '', '', '', '', '', ''],
      ['化材包装形式：选填，仅化材使用；膜材请留空', '', '', '', '', '', '', '', '', ''],
      ['膜材厚度(μm)*：膜材必填；化材请留空', '', '', '', '', '', '', '', '', ''],
      ['默认幅宽(mm)：膜材选填；化材请留空。填写即写入主数据默认幅宽，留空则后续补齐', '', '', '', '', '', '', '', '', ''],
      ['供应商、原厂型号：选填', '', '', '', '', '', '', '', '', ''],
      ['模板仅用于新建物料；若产品代码已存在，系统会跳过，不会更新现有主数据', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['▶ 当前有效子类别：', '', '', '', '', '', '', '', '', ''],
      [`【化材】${chemicalSubcategories.length > 0 ? chemicalSubcategories.join(' | ') : '请先在“子类别管理”中维护后再导入'}`, '', '', '', '', '', '', '', '', ''],
      [`【膜材】${filmSubcategories.length > 0 ? filmSubcategories.join(' | ') : '请先在“子类别管理”中维护后再导入'}`, '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['▶ 单位选项：', '', '', '', '', '', '', '', '', ''],
      ['【化材】kg | g | L | mL', '', '', '', '', '', '', '', '', ''],
      ['【膜材】m | m²', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['▶ 示例：', '', '', '', '', '', '', '', '', ''],
      ['001', '异丙醇', '化材', '溶剂', 'L', '铁桶', '', '', '国药', 'IPA-99'],
      ['002', 'PET保护膜', '膜材', '保护膜', 'm', '', '25', '1240', '东丽', 'T100']
    ];

    // 构建 Tab 分隔内容
    let content = templateRows.map(row => row.join('\t')).join('\n');

    wx.setClipboardData({
      data: content,
      success: () => {
        Dialog.alert({
          title: '简易结构已复制',
          message: '此内容仅包含最基础的列名结构，不带正式下拉和校验。\n\n建议优先使用“导出最新模板”获取系统当前规则，再填写后另存为 CSV 导入。',
          messageAlign: 'left',
          confirmButtonText: '我知道了'
        });
      },
      fail: () => {
        Toast.fail('复制失败');
      }
    });
  },

  // 选择文件 - 支持 CSV 和 Excel
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
      extension: ['csv'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ selectedFile: file });

        if (file.name.toLowerCase().endsWith('.csv')) {
          this.parseCSV(file.path);
        } else {
          Toast.fail('请使用 CSV 格式文件');
        }
      }
    });
  },

  // 解析 CSV
  parseCSV(filePath) {
    this.setData({ parsing: true, previewData: [] });

    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath: filePath,
      encoding: 'utf8',
      success: (res) => {
        try {
          // 移除 BOM
          let content = res.data;
          if (content.charCodeAt(0) === 0xFEFF) {
            content = content.substring(1);
          }

          // 解析 CSV
          const lines = content.split('\n').filter(line => line.trim());

          // 跳过表头，过滤有效数据行
          const dataRows = lines.slice(1).filter((line) => {
            const parts = this.parseCSVLine(line);
            if (isTemplateInlineHintRow(parts)) {
              return false;
            }
            return parts.length >= 3 && parts[0] && parts[1] && parts[2];
          });

          const rawPreviewData = dataRows.map((line, index) => {
            const row = this.parseCSVLine(line);
            return this.validateRow(row, index);
          });
          const previewData = applyImportDuplicateGuards(rawPreviewData);

          const validCount = previewData.filter(item => !item.error).length;
          const errorCount = previewData.filter(item => item.error).length;
          const warningCount = previewData.filter(item => item.warning && !item.error).length;

          this.setData({
            previewData,
            validCount,
            errorCount,
            warningCount,
            parsing: false
          });

          if (previewData.length === 0) {
            Toast.fail('未找到有效数据');
          }
        } catch (err) {
          console.error('解析失败', err);
          Toast.fail('文件解析失败');
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

  // 解析 CSV 行（处理逗号和引号）
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  },

  // 校验单行数据
  validateRow(row, index) {
    return validateImportRow(row, index, this.data.subcategoriesByCategory);
  },

  // 确认导入
  async onImport() {
    const previewErrors = this.data.previewData.filter(item => item.error);
    const previewWarnings = this.data.previewData.filter(item => item.warning && !item.error);
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
