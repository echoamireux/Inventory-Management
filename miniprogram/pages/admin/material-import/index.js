// pages/admin/material-import/index.js
import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';

// 子类别映射
const CHEMICAL_SUB_CATEGORIES = [
  '溶剂 (Solvent)', '树脂 (Resin)', '助剂 (Additive)',
  '固化剂 (Hardener)', '色浆 (Pigment)', '胶水 (Adhesive)', '其他'
];
const FILM_SUB_CATEGORIES = [
  '基材-PET', '基材-PI', '基材-PP/PE', '离型膜',
  '保护膜', '光学膜', '胶带', '其他'
];

// 单位映射
const CHEMICAL_UNITS = ['kg', 'g', 'L', 'mL'];
const FILM_UNITS = ['m', 'm²', '卷', '张', 'pcs(个)'];

Page({
  options: {
    styleIsolation: 'shared'
  },
  data: {
    selectedFile: null,
    parsing: false,
    importing: false,
    previewData: [],
    validCount: 0,
    errorCount: 0,
    showTemplateDialog: false // 控制模板说明弹窗
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.user || app.globalData.user.role !== 'admin') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => { wx.navigateBack(); }
      });
    }
  },

  // 下载模板 - 复制到剪贴板
  onDownloadTemplate() {
    // 模板内容（用 Tab 分隔便于粘贴到 Excel）
    const templateRows = [
      // 表头
      ['产品代码', '物料名称', '类别', '子类别', '子类别说明', '默认单位', '供应商', '厂家型号', '保质期(天)'],
      // 空行 - 从这里开始填写数据
      ['', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      // 说明区（与数据区用空行分隔）
      ['', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', ''],
      ['【重要：填写说明】请仔细阅读以下内容', '', '', '', '', '', '', '', ''],
      ['═══════════════════════════════════════════════════════════════════════════════', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['▶ 操作步骤：', '', '', '', '', '', '', '', ''],
      ['1. 在【第2行】开始填写物料数据（第1行是表头，不要修改）', '', '', '', '', '', '', '', ''],
      ['2. 每行填写一个物料，【不要留空行】', '', '', '', '', '', '', '', ''],
      ['3. 如果数据超过5行，请在第6行之前【插入】新行，不要在说明区填写', '', '', '', '', '', '', '', ''],
      ['4. 填写完成后，【删除】所有空行和本说明区', '', '', '', '', '', '', '', ''],
      ['5. 另存为 CSV 格式（文件 → 另存为 → 选择 CSV）', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['▶ 字段说明：（★ 表示必填）', '', '', '', '', '', '', '', ''],
      ['★ 产品代码：仅填数字部分，系统自动加前缀（化材→J-，膜材→M-）', '', '', '', '', '', '', '', ''],
      ['★ 物料名称：物料的中文名称', '', '', '', '', '', '', '', ''],
      ['★ 类别：只能填 "化材" 或 "膜材"（必须完全一致）', '', '', '', '', '', '', '', ''],
      ['★ 子类别：从下方选项中选择一个填写', '', '', '', '', '', '', '', ''],
      ['  子类别说明：仅当子类别填"其他"时必填，填写具体说明', '', '', '', '', '', '', '', ''],
      ['  默认单位：可选。不填则使用默认值（化材=kg，膜材=m）', '', '', '', '', '', '', '', ''],
      ['  供应商 / 厂家型号 / 保质期：可选', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['▶ 子类别选项：', '', '', '', '', '', '', '', ''],
      ['【化材】溶剂 (Solvent) | 树脂 (Resin) | 助剂 (Additive) | 固化剂 (Hardener) | 色浆 (Pigment) | 胶水 (Adhesive) | 其他', '', '', '', '', '', '', '', ''],
      ['【膜材】基材-PET | 基材-PI | 基材-PP/PE | 离型膜 | 保护膜 | 光学膜 | 胶带 | 其他', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['▶ 单位选项：', '', '', '', '', '', '', '', ''],
      ['【化材】kg | g | L | mL', '', '', '', '', '', '', '', ''],
      ['【膜材】m | m² | 卷 | 张 | pcs(个)', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['▶ 示例：', '', '', '', '', '', '', '', ''],
      ['001', '异丙醇', '化材', '溶剂 (Solvent)', '', 'L', '国药', 'IPA-99', '365'],
      ['002', 'PET保护膜', '膜材', '保护膜', '', 'm', '东丽', 'T100', '730']
    ];

    // 构建 Tab 分隔内容
    let content = templateRows.map(row => row.join('\t')).join('\n');

    wx.setClipboardData({
      data: content,
      success: () => {
        Dialog.alert({
          title: '简易结构已复制',
          message: '此内容仅包含最基础的列名结构。\n\n建议您优先使用管理员分发的《标准物料导入模板》，以获得更好的填写体验（包含下拉选项和校验）。',
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
  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'xlsx', 'xls'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ selectedFile: file });

        // 根据文件类型选择解析方式
        if (file.name.endsWith('.csv')) {
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
          const dataRows = lines.slice(1).filter(line => {
            const parts = this.parseCSVLine(line);
            return parts.length >= 3 && parts[0] && parts[1] && parts[2];
          });

          const previewData = dataRows.map((line, index) => {
            const row = this.parseCSVLine(line);
            return this.validateRow(row, index);
          });

          const validCount = previewData.filter(item => !item.error).length;
          const errorCount = previewData.filter(item => item.error).length;

          this.setData({
            previewData,
            validCount,
            errorCount,
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
    let productCode = String(row[0] || '').trim();
    const materialName = String(row[1] || '').trim();
    const categoryText = String(row[2] || '').trim();
    const subCategory = String(row[3] || '').trim();
    const subCategoryNote = String(row[4] || '').trim();
    let defaultUnit = String(row[5] || '').trim();
    const supplier = String(row[6] || '').trim();
    const supplierModel = String(row[7] || '').trim();
    const shelfLifeDays = row[8] ? parseInt(row[8]) : null;

    let error = null;
    let category = '';

    // 类别转换
    if (categoryText === '化材') {
      category = 'chemical';
    } else if (categoryText === '膜材') {
      category = 'film';
    } else {
      error = '类别必须为"化材"或"膜材"';
    }

    // 产品代码处理：去除可能的前缀
    if (productCode.toUpperCase().startsWith('J-')) {
      productCode = productCode.substring(2);
    } else if (productCode.toUpperCase().startsWith('M-')) {
      productCode = productCode.substring(2);
    }

    // 添加正确的前缀
    const prefix = category === 'film' ? 'M-' : 'J-';
    const fullProductCode = prefix + productCode;

    // 必填校验
    if (!productCode) {
      error = '产品代码必填';
    } else if (!materialName) {
      error = '物料名称必填';
    } else if (!subCategory) {
      error = '子类别必填';
    }

    // 子类别校验
    if (!error && subCategory) {
      const validSubs = category === 'chemical' ? CHEMICAL_SUB_CATEGORIES : FILM_SUB_CATEGORIES;
      if (!validSubs.includes(subCategory)) {
        error = `子类别无效，请选择：${validSubs.join('、')}`;
      }
      // 其他类别需要说明
      if (subCategory === '其他' && !subCategoryNote) {
        error = '子类别为"其他"时，子类别说明必填';
      }
    }

    // 单位默认值
    if (!defaultUnit) {
      defaultUnit = category === 'film' ? 'm' : 'kg';
    }

    // 单位校验
    if (!error && defaultUnit) {
      const validUnits = category === 'chemical' ? CHEMICAL_UNITS : FILM_UNITS;
      if (!validUnits.includes(defaultUnit)) {
        error = `单位无效，请选择：${validUnits.join('、')}`;
      }
    }

    return {
      rowIndex: index + 2,
      product_code: fullProductCode,
      product_code_number: productCode,
      material_name: materialName,
      category: category,
      sub_category: subCategory === '其他' && subCategoryNote ? subCategoryNote : subCategory,
      default_unit: defaultUnit,
      supplier: supplier,
      supplier_model: supplierModel,
      shelf_life_days: shelfLifeDays,
      error: error
    };
  },

  // 确认导入
  async onImport() {
    const validItems = this.data.previewData.filter(item => !item.error);

    if (validItems.length === 0) {
      Toast.fail('没有可导入的数据');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: '确认导入',
      message: `将导入 ${validItems.length} 条物料数据，是否继续？`
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
        const { created, skipped, errors } = res.result;
        let msg = `成功导入 ${created} 条`;
        if (skipped > 0) msg += `，跳过 ${skipped} 条重复`;
        if (errors > 0) msg += `，${errors} 条失败`;

        await Dialog.alert({
          title: '导入完成',
          message: msg,
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
