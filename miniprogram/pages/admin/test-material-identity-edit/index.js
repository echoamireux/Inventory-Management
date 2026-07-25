import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  getTestMaterialIdentity,
  createTestMaterialIdentity,
  updateTestMaterialIdentity,
  normalizeTestMaterialSupplier,
  normalizeTestMaterialLabelName,
  normalizeTestMaterialSupplierModel
} = require('../../../utils/test-material-identity-service');
const {
  listSubcategoryRecords
} = require('../../../utils/subcategory-service');
const {
  resolveSubcategoryDisplay,
  isSelectableSubcategoryRecord
} = require('../../../utils/material-subcategory');

function getInputValue(e) {
  if (e && e.detail && e.detail.value !== undefined) {
    return e.detail.value;
  }
  if (e && e.detail !== undefined) {
    return e.detail;
  }
  return '';
}

function buildMaterialOptionLabel(item = {}) {
  const categoryLabel = item.category === 'film' ? '膜材' : '化材';
  return `${item.product_code || ''}｜${item.material_name || '测试料主数据'}｜${categoryLabel}`;
}

Page({
  data: {
    id: '',
    isEdit: false,
    currentIdentity: null,
    canManageSubcategories: false,
    loading: false,
    submitting: false,
    hasLoadedOptions: false,
    showMaterialPicker: false,
    materialOptions: [],
    materialOptionLabels: [],
    materialIndex: 0,
    selectedMaterial: null,
    subCategoryRecords: [],
    subCategoryPickerRecords: [],
    subCategoryOptions: [],
    subCategoryIndex: 0,
    showSubCategoryPicker: false,
    hasInvalidSubcategory: false,
    form: {
      material_id: '',
      product_code: '',
      material_name: '',
      category: '',
      subcategory_key: '',
      sub_category: '',
      supplier_model: '',
      supplier: ''
    },
    materialNameError: '',
    supplierModelError: ''
  },

  async onLoad(options = {}) {
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
    const id = String(options.id || options._id || '').trim();
    this.setData({
      id,
      isEdit: !!id,
      canManageSubcategories: ['admin', 'super_admin'].includes(user.role)
    });
    wx.setNavigationBarTitle({ title: id ? '编辑测试料型号' : '新增测试料型号' });
    await this.loadTestMaterialOptions();
    if (id) {
      await this.loadIdentity(id);
    }
  },

  async loadTestMaterialOptions() {
    this.setData({ loading: true });
    try {
      const allMaterials = [];
      const pageSize = 100;
      let page = 1;
      let total = 0;
      do {
        const res = await wx.cloud.callFunction({
          name: 'manageMaterial',
          data: {
            action: 'list',
            data: {
              status: 'active',
              page,
              pageSize
            }
          }
        });
        if (!(res.result && res.result.success)) {
          throw new Error((res.result && res.result.msg) || '加载测试料主数据失败');
        }
        const pageList = res.result.list || [];
        allMaterials.push(...pageList);
        total = Number(res.result.total) || allMaterials.length;
        if (!pageList.length) {
          break;
        }
        page += 1;
      } while (allMaterials.length < total);

      const materialOptions = allMaterials
        .filter(item => item && item.is_test_material && item.status !== 'archived')
        .map(item => ({
          _id: item._id,
          product_code: item.product_code || '',
          material_name: item.material_name || item.name || '',
          category: item.category || ''
        }));
      const materialOptionLabels = materialOptions.map(buildMaterialOptionLabel);

      this.setData({
        materialOptions,
        materialOptionLabels,
        hasLoadedOptions: true,
        selectedMaterial: materialOptions.length === 1 ? materialOptions[0] : null,
        materialIndex: 0,
        ...(materialOptions.length === 1
          ? this.buildSelectedMaterialState(materialOptions[0])
          : {})
      });
      if (materialOptions.length === 1 && !this.data.isEdit) {
        await this.loadSubcategoryOptions(materialOptions[0].category, {
          subcategory_key: this.data.form.subcategory_key,
          sub_category: this.data.form.sub_category
        });
      }
    } catch (err) {
      console.error('加载测试料主数据失败', err);
      Toast.fail(err.message || '加载测试料主数据失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  onShow() {
    if (this.data.hasLoadedOptions && !this.data.loading && this.data.materialOptions.length === 0) {
      this.loadTestMaterialOptions();
    }
  },

  buildSelectedMaterialState(material = {}) {
    return {
      'form.material_id': material._id || '',
      'form.product_code': material.product_code || '',
      'form.category': material.category || ''
    };
  },

  onShowMaterialPicker() {
    if (this.data.materialOptions.length === 0) {
      Toast.fail('请先维护并启用测试料主数据代码壳');
      return;
    }
    this.setData({ showMaterialPicker: true });
  },

  onMaterialPickerCancel() {
    this.setData({ showMaterialPicker: false });
  },

  onMaterialPickerConfirm(e) {
    const index = Number(e.detail.index) || 0;
    const material = this.data.materialOptions[index];
    if (!material) {
      this.setData({ showMaterialPicker: false });
      return;
    }
    this.setData({
      selectedMaterial: material,
      materialIndex: index,
      showMaterialPicker: false,
      ...this.buildSelectedMaterialState(material)
    }, () => {
      this.loadSubcategoryOptions(material.category, {
        subcategory_key: this.data.form.subcategory_key,
        sub_category: this.data.form.sub_category
      });
    });
  },

  async loadIdentity(id) {
    this.setData({ loading: true });
    try {
      const record = await getTestMaterialIdentity({ id });
      if (!record) {
        throw new Error('测试料型号不存在');
      }
      const materialIndex = this.data.materialOptions.findIndex(item => (
        item._id === record.material_id || item.product_code === record.product_code
      ));
      const selectedMaterial = materialIndex >= 0 ? this.data.materialOptions[materialIndex] : null;
      this.setData({
        currentIdentity: record,
        selectedMaterial,
        materialIndex: materialIndex >= 0 ? materialIndex : 0,
        'form.material_id': record.material_id || (selectedMaterial && selectedMaterial._id) || '',
        'form.product_code': record.product_code || '',
        'form.category': record.category || (selectedMaterial && selectedMaterial.category) || '',
        'form.material_name': record.label_material_name || record.material_name || '',
        'form.subcategory_key': record.subcategory_key || '',
        'form.sub_category': record.sub_category || '',
        'form.supplier_model': record.supplier_model || '',
        'form.supplier': record.supplier || ''
      });
      await this.loadSubcategoryOptions(record.category || (selectedMaterial && selectedMaterial.category), {
        subcategory_key: record.subcategory_key,
        sub_category: record.sub_category
      });
    } catch (err) {
      console.error('加载测试料型号失败', err);
      Toast.fail(err.message || '加载测试料型号失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadSubcategoryOptions(category, currentSelection = {}) {
    if (!category) {
      this.setData({
        subCategoryRecords: [],
        subCategoryPickerRecords: [],
        subCategoryOptions: [],
        subCategoryIndex: 0,
        hasInvalidSubcategory: false
      });
      return;
    }

    try {
      const subCategoryRecords = await listSubcategoryRecords(category, true);
      const pickerRecords = subCategoryRecords.filter((item) => {
        if (item.status === 'active' && isSelectableSubcategoryRecord(item)) {
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
        'form.sub_category': displayName || this.data.form.sub_category,
        hasInvalidSubcategory
      });
    } catch (err) {
      console.error('加载子类别失败', err);
      Toast.fail(err.message || '加载子类别失败');
    }
  },

  onMaterialNameInput(e) {
    const value = normalizeTestMaterialLabelName(getInputValue(e));
    this.setData({
      'form.material_name': value,
      materialNameError: value ? '' : '请输入物料名称'
    });
  },

  onSupplierModelInput(e) {
    const value = normalizeTestMaterialSupplierModel(getInputValue(e));
    this.setData({
      'form.supplier_model': value,
      supplierModelError: value ? '' : '请输入原厂型号'
    });
  },

  onSupplierInput(e) {
    this.setData({
      'form.supplier': normalizeTestMaterialSupplier(getInputValue(e))
    });
  },

  onShowSubCategoryPicker() {
    if (!this.data.form.category) {
      Toast.fail('请先选择测试料产品代码');
      return;
    }
    if (!this.data.subCategoryOptions.length) {
      Toast.fail('当前类别没有可选子类别，请先维护子类别');
      return;
    }
    this.setData({ showSubCategoryPicker: true });
  },

  onSubCategoryConfirm(e) {
    const index = Number(e.detail.index) || 0;
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
      Toast.fail('请先选择测试料产品代码');
      return;
    }
    wx.navigateTo({
      url: `/pages/admin/subcategory-manage/index?category=${category}`
    });
  },

  async submit(confirmSimilar = false) {
    const form = this.data.form;
    const materialName = normalizeTestMaterialLabelName(form.material_name);
    const supplierModel = normalizeTestMaterialSupplierModel(form.supplier_model);
    const supplier = normalizeTestMaterialSupplier(form.supplier);
    if (this.data.materialOptions.length === 0) {
      Toast.fail('请先维护并启用测试料主数据代码壳');
      return;
    }
    if (!form.material_id && !form.product_code) {
      Toast.fail('请选择测试料产品代码');
      return;
    }
    if (!materialName) {
      this.setData({ materialNameError: '请输入物料名称' });
      Toast.fail('请输入物料名称');
      return;
    }
    if (!form.subcategory_key) {
      Toast.fail('请选择子类别');
      return;
    }
    if (!supplierModel) {
      this.setData({ supplierModelError: '请输入原厂型号' });
      Toast.fail('请输入原厂型号');
      return;
    }

    this.setData({ submitting: true });
    try {
      const payload = {
        id: this.data.id,
        material_id: form.material_id,
        product_code: form.product_code,
        label_material_name: materialName,
        material_name: materialName,
        subcategory_key: form.subcategory_key,
        sub_category: form.sub_category,
        supplier_model: supplierModel,
        supplier,
        confirmSimilar
      };
      if (this.data.isEdit) {
        await updateTestMaterialIdentity(payload);
      } else {
        await createTestMaterialIdentity(payload);
      }
      getApp().globalData.masterDataChangedAt = Date.now();
      Toast.success(this.data.isEdit ? '保存成功' : '创建成功');
      setTimeout(() => wx.navigateBack(), 800);
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
          await this.submit(true);
        }
        return;
      }
      Toast.fail(err.message || '创建失败');
    } finally {
      this.setData({ submitting: false });
    }
  },

  onSubmit() {
    this.submit(false);
  },

  onManageMaterialMaster() {
    wx.navigateTo({ url: '/pages/admin/material-edit?is_test_material=1' });
  }
});
