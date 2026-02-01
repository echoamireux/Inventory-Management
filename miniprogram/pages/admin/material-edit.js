// pages/admin/material-edit.js
import Toast from '@vant/weapp/toast/toast';
import {
  CHEMICAL_CATEGORIES,
  FILM_CATEGORIES,
  UNIT_OPTIONS
} from '../../utils/constants';

Page({
  data: {
    id: null,
    isEdit: false,
    form: {
      product_code: '',
      product_code_number: '',  // 用户输入的数字部分
      material_name: '',
      category: '',  // 必选，不设默认值
      sub_category: '',
      custom_sub_category: '', // NEW: For 'Other' input
      supplier: '',
      supplier_model: '',
      default_unit: '',
      shelf_life_days: ''
    },
    // 产品代码前缀
    codePrefix: '',

    // 重复检查状态
    checkingDuplicate: false,
    duplicateStatus: '',  // 'exists' | 'new' | ''
    existingMaterial: null,  // 已存在的物料信息
    checkTimer: null,

    // 类别
    categoryOptions: ['化材', '膜材'],
    categoryIndex: null,  // null 表示未选择
    showCategoryPicker: false,

    // 子类别（动态）
    subCategoryOptions: [],
    subCategoryIndex: 0,
    showSubCategoryPicker: false,
    showAddSubCategory: false,
    newSubCategory: '',

    // 单位（动态）
    unitOptions: [],
    unitIndex: 0,
    showUnitPicker: false,
    showAddUnit: false,
    newUnit: '',

    // 默认选项（从常量加载）
    chemicalSubCategories: CHEMICAL_CATEGORIES.map(c => c.name),
    filmSubCategories: FILM_CATEGORIES.map(c => c.name),
    chemicalUnits: ['kg', 'g', 'L', 'mL'],
    filmUnits: ['m', 'mm', '卷', '张'],

    // 自定义选项（从数据库加载）
    customSubCategories: { chemical: [], film: [] },
    customUnits: { chemical: [], film: [] },

    submitting: false
  },

  onLoad(options) {
    const app = getApp();
    if (!app.globalData.user || app.globalData.user.role !== 'admin') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => { wx.navigateBack(); }
      });
      return;
    }

    // 加载自定义选项
    this.loadCustomOptions();

    if (options.id) {
      this.setData({ id: options.id, isEdit: true });
      wx.setNavigationBarTitle({ title: '编辑物料' });
      this.loadMaterial(options.id);
    } else {
      wx.setNavigationBarTitle({ title: '新增物料' });
    }
  },

  // 加载自定义选项
  async loadCustomOptions() {
    try {
      const db = wx.cloud.database();
      // 尝试读取 settings 表，如果表或记录不存在会返回空数组
      const res = await db.collection('settings')
        .where({
          _id: db.command.in(['custom_sub_categories', 'custom_units'])
        })
        .get()
        .catch(() => ({ data: [] })); // 表不存在时返回空

      if (res.data && res.data.length > 0) {
        res.data.forEach(item => {
          if (item._id === 'custom_sub_categories') {
            this.setData({ customSubCategories: item.data || { chemical: [], film: [] } });
          } else if (item._id === 'custom_units') {
            this.setData({ customUnits: item.data || { chemical: [], film: [] } });
          }
        });
      }
      // 如果没有数据，使用默认的空对象（已在 data 中初始化）
    } catch (err) {
      console.warn('加载自定义选项失败，使用默认值:', err);
      // 静默失败，使用默认值
    }
  },

  // 根据类别更新子类别和单位选项
  updateOptionsForCategory(category) {
    const { chemicalSubCategories, filmSubCategories, chemicalUnits, filmUnits, customSubCategories, customUnits } = this.data;

    let subCats, units;
    if (category === 'chemical') {
      subCats = [...chemicalSubCategories, ...(customSubCategories.chemical || [])];
      units = [...chemicalUnits, ...(customUnits.chemical || [])];
    } else {
      subCats = [...filmSubCategories, ...(customSubCategories.film || [])];
      units = [...filmUnits, ...(customUnits.film || [])];
    }

    this.setData({
      subCategoryOptions: subCats,
      unitOptions: units
    });
  },

  async loadMaterial(id) {
    Toast.loading({ message: '加载中...', forbidClick: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'get',
          data: { id }
        }
      });

      if (res.result.success) {
        const data = res.result.data;
        const categoryIndex = data.category === 'film' ? 1 : 0;

        // 先更新选项列表
        this.updateOptionsForCategory(data.category);

        // 然后找到对应索引
        const subCategoryIndex = this.data.subCategoryOptions.indexOf(data.sub_category);
        const unitIndex = this.data.unitOptions.indexOf(data.default_unit);

        // Parse product code
        let codePrefix = '';
        let codeNumber = '';
        if (data.product_code) {
             if (data.product_code.startsWith('J-')) {
                 codePrefix = 'J-';
                 codeNumber = data.product_code.substring(2);
             } else if (data.product_code.startsWith('M-')) {
                 codePrefix = 'M-';
                 codeNumber = data.product_code.substring(2);
             } else {
                 codeNumber = data.product_code;
             }
        } else {
             // Fallback based on category
             codePrefix = data.category === 'film' ? 'M-' : 'J-';
        }

        this.setData({
          form: {
            product_code: data.product_code || '',
            product_code_number: codeNumber, // Set extracted number
            material_name: data.material_name || '',
            category: data.category || '',
            sub_category: data.sub_category || '',
            supplier: data.supplier || '',
            supplier_model: data.supplier_model || '',
            default_unit: data.default_unit || '',
            shelf_life_days: data.shelf_life_days ? String(data.shelf_life_days) : ''
          },
          categoryIndex,
          codePrefix: codePrefix, // Set prefix
          subCategoryIndex: subCategoryIndex >= 0 ? subCategoryIndex : 0,
          unitIndex: unitIndex >= 0 ? unitIndex : 0
        });
        Toast.clear();
      } else {
        Toast.fail(res.result.msg);
      }
    } catch (err) {
      console.error(err);
      Toast.fail('加载失败');
    }
  },

  // 表单输入处理
  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`form.${field}`]: e.detail
    });
  },

  // 产品代码数字部分输入
  onCodeNumberInput(e) {
    // 原生 input 组件使用 e.detail.value
    const number = e.detail.value || '';
    const { codePrefix } = this.data;

    this.setData({
      'form.product_code_number': number,
      'form.product_code': codePrefix + number
    });

    // 防抖检查重复
    if (this.data.checkTimer) clearTimeout(this.data.checkTimer);

    if (!number) {
      this.setData({ duplicateStatus: '', existingMaterial: null });
      return;
    }

    this.setData({
      checkTimer: setTimeout(() => {
        this.checkDuplicate(codePrefix + number);
      }, 500)
    });
  },

  // 检查物料是否已存在
  async checkDuplicate(productCode) {
    if (!productCode || this.data.isEdit) return;

    this.setData({ checkingDuplicate: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: {
          action: 'get',
          data: { product_code: productCode }
        }
      });

      if (res.result.success && res.result.data) {
        // 物料已存在
        this.setData({
          duplicateStatus: 'exists',
          existingMaterial: res.result.data
        });
      } else {
        // 新物料
        this.setData({
          duplicateStatus: 'new',
          existingMaterial: null
        });
      }
    } catch (err) {
      console.error('检查重复失败:', err);
      this.setData({ duplicateStatus: '' });
    } finally {
      this.setData({ checkingDuplicate: false });
    }
  },

  // === 类别选择 ===
  onShowCategoryPicker() {
    this.setData({ showCategoryPicker: true });
  },

  onCategoryConfirm(e) {
    const index = e.detail.index;
    const category = index === 0 ? 'chemical' : 'film';
    const codePrefix = index === 0 ? 'J-' : 'M-';

    // 更新子类别和单位选项
    this.updateOptionsForCategory(category);

    // 重置产品代码
    const number = this.data.form.product_code_number;

    this.setData({
      categoryIndex: index,
      'form.category': category,
      'form.sub_category': '', // 重置子类别
      'form.default_unit': '', // 重置单位
      'form.product_code': codePrefix + number,
      codePrefix: codePrefix,
      subCategoryIndex: 0,
      unitIndex: 0,
      showCategoryPicker: false,
      duplicateStatus: '',  // 重置检查状态
      existingMaterial: null
    });

    // 如果已有数字，重新检查重复
    if (number) {
      this.checkDuplicate(codePrefix + number);
    }
  },

  onCategoryCancel() {
    this.setData({ showCategoryPicker: false });
  },

  // === 子类别选择 ===
  onShowSubCategoryPicker() {
    if (!this.data.form.category) {
      Toast.fail('请先选择类别');
      return;
    }
    this.setData({ showSubCategoryPicker: true });
  },

  onSubCategoryConfirm(e) {
    const index = e.detail.index;
    this.setData({
      subCategoryIndex: index,
      'form.sub_category': this.data.subCategoryOptions[index],
      showSubCategoryPicker: false
    });
  },

  onSubCategoryCancel() {
    this.setData({ showSubCategoryPicker: false });
  },

  // 新增子类别
  onShowAddSubCategory() {
    if (!this.data.form.category) {
      Toast.fail('请先选择类别');
      return;
    }
    this.setData({ showAddSubCategory: true, newSubCategory: '' });
  },

  onNewSubCategoryInput(e) {
    this.setData({ newSubCategory: e.detail });
  },

  async onAddSubCategoryConfirm() {
    const { newSubCategory, form, subCategoryOptions, customSubCategories } = this.data;

    if (!newSubCategory.trim()) {
      Toast.fail('请输入子类别名称');
      return;
    }

    if (subCategoryOptions.includes(newSubCategory.trim())) {
      Toast.fail('该子类别已存在');
      return;
    }

    Toast.loading({ message: '保存中...' });

    try {
      const db = wx.cloud.database();
      const category = form.category;
      const newCustom = { ...customSubCategories };
      newCustom[category] = [...(newCustom[category] || []), newSubCategory.trim()];

      // 保存到数据库
      await db.collection('settings').doc('custom_sub_categories').set({
        data: { data: newCustom }
      });

      // 更新本地
      this.setData({
        customSubCategories: newCustom,
        subCategoryOptions: [...subCategoryOptions, newSubCategory.trim()],
        'form.sub_category': newSubCategory.trim(),
        showAddSubCategory: false
      });

      Toast.success('已添加');
    } catch (err) {
      console.error(err);
      Toast.fail('保存失败');
    }
  },

  onAddSubCategoryCancel() {
    this.setData({ showAddSubCategory: false });
  },

  // === 单位选择 ===
  onShowUnitPicker() {
    if (!this.data.form.category) {
      Toast.fail('请先选择类别');
      return;
    }
    this.setData({ showUnitPicker: true });
  },

  onUnitConfirm(e) {
    const index = e.detail.index;
    this.setData({
      unitIndex: index,
      'form.default_unit': this.data.unitOptions[index],
      showUnitPicker: false
    });
  },

  onUnitCancel() {
    this.setData({ showUnitPicker: false });
  },

  // 新增单位
  onShowAddUnit() {
    if (!this.data.form.category) {
      Toast.fail('请先选择类别');
      return;
    }
    this.setData({ showAddUnit: true, newUnit: '' });
  },

  onNewUnitInput(e) {
    this.setData({ newUnit: e.detail });
  },

  async onAddUnitConfirm() {
    const { newUnit, form, unitOptions, customUnits } = this.data;

    if (!newUnit.trim()) {
      Toast.fail('请输入单位名称');
      return;
    }

    if (unitOptions.includes(newUnit.trim())) {
      Toast.fail('该单位已存在');
      return;
    }

    Toast.loading({ message: '保存中...' });

    try {
      const db = wx.cloud.database();
      const category = form.category;
      const newCustom = { ...customUnits };
      newCustom[category] = [...(newCustom[category] || []), newUnit.trim()];

      // 保存到数据库
      await db.collection('settings').doc('custom_units').set({
        data: { data: newCustom }
      });

      // 更新本地
      this.setData({
        customUnits: newCustom,
        unitOptions: [...unitOptions, newUnit.trim()],
        'form.default_unit': newUnit.trim(),
        showAddUnit: false
      });

      Toast.success('已添加');
    } catch (err) {
      console.error(err);
      Toast.fail('保存失败');
    }
  },

  onAddUnitCancel() {
    this.setData({ showAddUnit: false });
  },

  // Helper: Save custom sub-category to DB settings (Fire and Forget)
  async saveCustomSubCategory(name) {
      if (!name) return;
      const { customSubCategories, subCategoryOptions, form } = this.data;

      // If already exists in options, skip
      if (subCategoryOptions.includes(name)) return;

      try {
          const db = wx.cloud.database();
          const category = form.category;
          const newCustom = { ...customSubCategories };
          newCustom[category] = [...(newCustom[category] || []), name];

          // Optimistically update local options to avoid re-save
          const newOptions = [...subCategoryOptions, name];
          this.setData({
              customSubCategories: newCustom,
              subCategoryOptions: newOptions
          });

          // Save to DB
          await db.collection('settings').doc('custom_sub_categories').update({
              data: { data: newCustom }
          }).catch(async () => {
              // If doc doesn't exist, create it
               await db.collection('settings').doc('custom_sub_categories').set({
                  data: { data: newCustom }
              });
          });
          console.log('Custom sub-category auto-saved:', name);
      } catch (err) {
          console.error('Failed to auto-save custom sub-category', err);
      }
  },

  // 提交表单
  async onSubmit() {
    const { form, isEdit, id } = this.data;

    // 验证必填字段
    if (!form.product_code.trim()) {
      Toast.fail('请输入产品代码');
      return;
    }
    if (!form.material_name.trim()) {
      Toast.fail('请输入物料名称');
      return;
    }
    if (!form.category) {
      Toast.fail('请选择类别');
      return;
    }
    if (!form.sub_category) {
      Toast.fail('请选择子类别');
      return;
    }

    // Handle Custom Sub-category
    let finalSubCategory = form.sub_category;
    if (form.sub_category === '其他' || form.sub_category === '其他 (Other)') {
        if (!form.custom_sub_category || !form.custom_sub_category.trim()) {
            Toast.fail('请输入自定义子类名称');
            return;
        }
        finalSubCategory = form.custom_sub_category.trim();

        // Auto-add to options (Fire and Forget)
        this.saveCustomSubCategory(finalSubCategory);
    }

    this.setData({ submitting: true });
    Toast.loading({ message: '保存中...', forbidClick: true });

    try {
      const action = isEdit ? 'update' : 'create';
      const data = {
        ...form,
        sub_category: finalSubCategory, // Override with custom value
        shelf_life_days: form.shelf_life_days ? parseInt(form.shelf_life_days) : null
      };

      if (isEdit) {
        data.id = id;
      }

      const res = await wx.cloud.callFunction({
        name: 'manageMaterial',
        data: { action, data }
      });

      if (res.result.success) {
        Toast.success(isEdit ? '已更新' : '已创建');
        setTimeout(() => {
          wx.navigateBack();
        }, 1000);
      } else {
        Toast.fail(res.result.msg);
      }
    } catch (err) {
      console.error(err);
      Toast.fail('保存失败');
    } finally {
      this.setData({ submitting: false });
    }
  }
});
