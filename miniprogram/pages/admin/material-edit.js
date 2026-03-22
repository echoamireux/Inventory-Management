// pages/admin/material-edit.js
import Toast from '@vant/weapp/toast/toast';
import { PACKAGE_TYPES } from '../../utils/constants';
const {
  getAllowedUnits,
  getDefaultUnit,
  buildUnitFieldState,
  normalizeUnitInput
} = require('../../utils/material-units');
const {
  listSubcategoryRecords
} = require('../../utils/subcategory-service');
const {
  resolveSubcategoryDisplay,
  isSelectableSubcategoryRecord
} = require('../../utils/material-subcategory');
const {
  sanitizeProductCodeNumberInput,
  normalizeProductCodeInput,
  validateStandardProductCode
} = require('../../utils/product-code');

Page({
  data: {
    id: null,
    isEdit: false,
    form: {
      product_code: '',
      product_code_number: '',  // 用户输入的数字部分
      material_name: '',
      category: '',  // 必选，不设默认值
      subcategory_key: '',
      sub_category: '',
      supplier: '',
      supplier_model: '',
      default_unit: '',
      package_type: '',
      thickness_um: '',
      width_mm: ''
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
    subCategoryRecords: [],
    subCategoryPickerRecords: [],
    subCategoryOptions: [],
    subCategoryIndex: 0,
    showSubCategoryPicker: false,
    hasInvalidSubcategory: false,

    // 单位（动态）
    unitOptions: [],
    unitIndex: 0,
    showUnitPicker: false,
    hasInvalidDefaultUnit: false,

    packageTypeOptions: PACKAGE_TYPES.map((item) => item.name),
    packageTypeIndex: 0,
    showPackageTypePicker: false,

    submitting: false
  },

  async initializeCreatePrefill(options = {}) {
    const rawCategory = options.category === 'film' || options.category === 'chemical'
      ? options.category
      : '';
    const rawProductCode = options.product_code ? decodeURIComponent(options.product_code) : '';

    if (!rawCategory && !rawProductCode) {
      return;
    }

    const inferredCategory = rawCategory || (String(rawProductCode).startsWith('M-') ? 'film' : 'chemical');
    const categoryIndex = inferredCategory === 'film' ? 1 : 0;
    const codePrefix = inferredCategory === 'film' ? 'M-' : 'J-';
    const normalizedCode = rawProductCode
      ? normalizeProductCodeInput(inferredCategory, rawProductCode)
      : null;
    const codeNumber = normalizedCode && normalizedCode.ok
      ? normalizedCode.number
      : '';

    await this.updateOptionsForCategory(inferredCategory, {});

    this.setData({
      categoryIndex,
      codePrefix,
      form: {
        ...this.data.form,
        category: inferredCategory,
        default_unit: getDefaultUnit(inferredCategory),
        product_code: normalizedCode && normalizedCode.ok ? normalizedCode.product_code : '',
        product_code_number: codeNumber
      }
    });

    if (normalizedCode && normalizedCode.ok) {
      this.checkDuplicate(normalizedCode.product_code);
    }
  },

  async onLoad(options) {
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

    if (options.id) {
      this.setData({ id: options.id, isEdit: true });
      wx.setNavigationBarTitle({ title: '编辑物料' });
      this.loadMaterial(options.id);
    } else {
      wx.setNavigationBarTitle({ title: '新增物料' });
      await this.initializeCreatePrefill(options);
    }
  },

  onShow() {
    if (this.data.form.category) {
      this.updateOptionsForCategory(this.data.form.category, {
        subcategory_key: this.data.form.subcategory_key,
        sub_category: this.data.form.sub_category
      });
    }
  },

  // 根据类别更新子类别和单位选项
  async updateOptionsForCategory(category, currentSelection = {}) {
    const units = getAllowedUnits(category);
    try {
      const subCategoryRecords = await listSubcategoryRecords(category, true);
      const pickerRecords = subCategoryRecords.filter((item) => {
        if (item.status === 'active') {
          return true;
        }
        return item.subcategory_key === currentSelection.subcategory_key;
      });
      const subCategoryOptions = pickerRecords.map(item => item.name);
      const displayName = resolveSubcategoryDisplay(currentSelection, new Map(
        subCategoryRecords.map(item => [item.subcategory_key, item])
      ));
      const subCategoryIndex = subCategoryOptions.indexOf(displayName);
      const hasInvalidSubcategory = !!displayName && !pickerRecords.some((item) => {
        if (currentSelection.subcategory_key) {
          return item.subcategory_key === currentSelection.subcategory_key;
        }
        return item.name === displayName;
      });

      this.setData({
        subCategoryRecords,
        subCategoryPickerRecords: pickerRecords,
        subCategoryOptions,
        subCategoryIndex: subCategoryIndex >= 0 ? subCategoryIndex : 0,
        unitOptions: units,
        'form.sub_category': displayName || this.data.form.sub_category,
        hasInvalidSubcategory
      });
    } catch (err) {
      console.error(err);
      this.setData({
        subCategoryRecords: [],
        subCategoryPickerRecords: [],
        subCategoryOptions: [],
        subCategoryIndex: 0,
        unitOptions: units,
        hasInvalidSubcategory: false
      });
      Toast.fail(err.message || '加载子类别失败');
    }
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

        await this.updateOptionsForCategory(data.category, {
          subcategory_key: data.subcategory_key,
          sub_category: data.sub_category
        });

        // 然后找到对应索引
        const unitState = buildUnitFieldState(data.category, data.default_unit);
        const matchedRecord = this.data.subCategoryRecords.find((item) => {
          if (data.subcategory_key && item.subcategory_key === data.subcategory_key) {
            return true;
          }
          return item.name === data.sub_category;
        });
        const resolvedSubCategory = matchedRecord ? matchedRecord.name : (data.sub_category || '');
        const subCategoryIndex = this.data.subCategoryOptions.indexOf(resolvedSubCategory);
        const packageTypeIndex = this.data.packageTypeOptions.indexOf(data.package_type || '');
        const materialSpecs = data.specs || {};

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
            subcategory_key: matchedRecord ? matchedRecord.subcategory_key : (data.subcategory_key || ''),
            sub_category: resolvedSubCategory,
            supplier: data.supplier || '',
            supplier_model: data.supplier_model || '',
            default_unit: unitState.value,
            package_type: data.package_type || '',
            thickness_um: materialSpecs.thickness_um !== undefined && materialSpecs.thickness_um !== null
              ? String(materialSpecs.thickness_um)
              : '',
            width_mm: (
              materialSpecs.standard_width_mm !== undefined && materialSpecs.standard_width_mm !== null
                ? materialSpecs.standard_width_mm
                : materialSpecs.width_mm
            ) !== undefined && (
              materialSpecs.standard_width_mm !== undefined && materialSpecs.standard_width_mm !== null
                ? materialSpecs.standard_width_mm
                : materialSpecs.width_mm
            ) !== null
              ? String(
                materialSpecs.standard_width_mm !== undefined && materialSpecs.standard_width_mm !== null
                  ? materialSpecs.standard_width_mm
                  : materialSpecs.width_mm
              )
              : ''
          },
          categoryIndex,
          codePrefix: codePrefix, // Set prefix
          subCategoryIndex: subCategoryIndex >= 0 ? subCategoryIndex : 0,
          unitIndex: unitState.selectedIndex,
          packageTypeIndex: packageTypeIndex >= 0 ? packageTypeIndex : 0,
          hasInvalidDefaultUnit: !!data.default_unit && !unitState.isCurrentUnitValid
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
    const number = sanitizeProductCodeNumberInput(e.detail.value || '');
    const { codePrefix } = this.data;
    const normalizedCode = normalizeProductCodeInput(
      this.data.form.category || 'chemical',
      `${codePrefix}${number}`
    );

    this.setData({
      'form.product_code_number': number,
      'form.product_code': normalizedCode.ok ? normalizedCode.product_code : `${codePrefix}${number}`
    });

    // 防抖检查重复
    if (this.data.checkTimer) clearTimeout(this.data.checkTimer);

    if (!number) {
      this.setData({ duplicateStatus: '', existingMaterial: null });
      return;
    }

    this.setData({
      checkTimer: setTimeout(() => {
        if (normalizedCode.ok) {
          this.checkDuplicate(normalizedCode.product_code);
        }
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

    // 重置产品代码
    const number = this.data.form.product_code_number;

    this.setData({
      categoryIndex: index,
      'form.category': category,
      'form.subcategory_key': '',
      'form.sub_category': '', // 重置子类别
      'form.default_unit': getDefaultUnit(category),
      'form.package_type': category === 'chemical' ? this.data.form.package_type : '',
      'form.thickness_um': category === 'film' ? this.data.form.thickness_um : '',
      'form.width_mm': category === 'film' ? this.data.form.width_mm : '',
      'form.product_code': codePrefix + number,
      codePrefix: codePrefix,
      subCategoryIndex: 0,
      unitIndex: 0,
      packageTypeIndex: 0,
      hasInvalidSubcategory: false,
      hasInvalidDefaultUnit: false,
      showCategoryPicker: false,
      duplicateStatus: '',  // 重置检查状态
      existingMaterial: null
    });
    this.updateOptionsForCategory(category);

    // 如果已有数字，重新检查重复
    if (number) {
      const normalizedCode = normalizeProductCodeInput(category, `${codePrefix}${number}`);
      if (normalizedCode.ok) {
        this.checkDuplicate(normalizedCode.product_code);
      }
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
    const selectedRecord = this.data.subCategoryPickerRecords[index];
    this.setData({
      subCategoryIndex: index,
      'form.subcategory_key': selectedRecord ? selectedRecord.subcategory_key : '',
      'form.sub_category': selectedRecord ? selectedRecord.name : '',
      showSubCategoryPicker: false,
      hasInvalidSubcategory: false
    });
  },

  onSubCategoryCancel() {
    this.setData({ showSubCategoryPicker: false });
  },

  onManageSubcategories() {
    const category = this.data.form.category;
    if (!category) {
      Toast.fail('请先选择类别');
      return;
    }

    wx.navigateTo({
      url: `/pages/admin/subcategory-manage/index?category=${category}`
    });
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
      hasInvalidDefaultUnit: false,
      showUnitPicker: false
    });
  },

  onUnitCancel() {
    this.setData({ showUnitPicker: false });
  },

  onShowPackageTypePicker() {
    if (this.data.form.category !== 'chemical') {
      return;
    }
    this.setData({ showPackageTypePicker: true });
  },

  onPackageTypeConfirm(e) {
    const index = e.detail.index;
    this.setData({
      packageTypeIndex: index,
      'form.package_type': this.data.packageTypeOptions[index] || '',
      showPackageTypePicker: false
    });
  },

  onPackageTypeCancel() {
    this.setData({ showPackageTypePicker: false });
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
    const selectedSubcategory = this.data.subCategoryPickerRecords.find((item) => (
      item.subcategory_key === form.subcategory_key && isSelectableSubcategoryRecord(item)
    ));
    if (!form.subcategory_key || !selectedSubcategory) {
      Toast.fail('请选择有效子类别');
      return;
    }
    const normalizedCode = validateStandardProductCode(form.category, form.product_code);
    if (!normalizedCode.ok) {
      Toast.fail(normalizedCode.msg);
      return;
    }
    const normalizedUnit = normalizeUnitInput(form.category, form.default_unit);
    if (!normalizedUnit.ok) {
      Toast.fail(normalizedUnit.msg);
      return;
    }

    this.setData({ submitting: true });
    Toast.loading({ message: '保存中...', forbidClick: true });

    try {
      const action = isEdit ? 'update' : 'create';
      const data = {
        ...form,
        product_code: normalizedCode.product_code,
        default_unit: normalizedUnit.unit,
        package_type: form.category === 'chemical' ? form.package_type : '',
        thickness_um: form.category === 'film' && form.thickness_um !== ''
          ? Number(form.thickness_um)
          : '',
        width_mm: form.category === 'film' && form.width_mm !== ''
          ? Number(form.width_mm)
          : ''
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
