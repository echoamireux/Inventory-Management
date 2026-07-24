import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const {
  createTestMaterialIdentity,
  normalizeTestMaterialSupplier,
  normalizeTestMaterialSupplierModel
} = require('../../../utils/test-material-identity-service');

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
    loading: false,
    submitting: false,
    hasLoadedOptions: false,
    showMaterialPicker: false,
    materialOptions: [],
    materialOptionLabels: [],
    materialIndex: 0,
    selectedMaterial: null,
    form: {
      material_id: '',
      product_code: '',
      material_name: '',
      category: '',
      supplier_model: '',
      supplier: ''
    },
    supplierModelError: ''
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
    this.loadTestMaterialOptions();
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
      'form.material_name': material.material_name || '',
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

  async submit(confirmSimilar = false) {
    const form = this.data.form;
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
    if (!supplierModel) {
      this.setData({ supplierModelError: '请输入原厂型号' });
      Toast.fail('请输入原厂型号');
      return;
    }

    this.setData({ submitting: true });
    try {
      await createTestMaterialIdentity({
        material_id: form.material_id,
        product_code: form.product_code,
        supplier_model: supplierModel,
        supplier,
        confirmSimilar
      });
      Toast.success('创建成功');
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
