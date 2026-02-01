// pages/material-add/index.js
import Toast from '@vant/weapp/toast/toast';
import {
  CATEGORY_PREFIX,
  CHEMICAL_CATEGORIES,
  FILM_CATEGORIES,
  UNIT_OPTIONS,
  PACKAGE_TYPES,
  DEFAULT_ZONES,
  DEFAULT_FORM,
  SEARCH_DEBOUNCE_MS
} from '../../utils/constants';
const db = require('../../utils/db');

Page({
  data: {
    activeTab: 'chemical',
    form: { ...DEFAULT_FORM },
    loading: false,

    // UI状态
    showUnitSheet: false,
    showPackageTypeSheet: false,
    showLocationSheet: false,
    showDatePicker: false,
    showSuccessDialog: false,

    // 联想建议
    suggestions: [],
    suggestionTimer: null,

    // 数据
    currentSubCategories: [],
    chemicalZonesDefaults: DEFAULT_ZONES.chemical,
    filmZonesDefaults: DEFAULT_ZONES.film,
    dbZones: [],

    locationZones: [],
    locationZoneActions: [],

    // 使用常量
    unitActions: UNIT_OPTIONS,
    packageTypeActions: PACKAGE_TYPES,
    chemicalCategories: CHEMICAL_CATEGORIES,
    filmCategories: FILM_CATEGORIES,

    // 自定义选项（从数据库加载）
    customSubCategories: { chemical: [], film: [] },
    customUnits: { chemical: [], film: [] },

    // UI binding
    subCategoryActions: [],
    showSubCategorySheet: false,

    currentDate: new Date().getTime(),
    minDate: new Date().getTime(),
  },

  onLoad(options) {
      if (options) {
          if (options.id) {
              this.setData({ 'form.unique_code': options.id });
          }
          if (options.product_code) {
              this.setData({ 'form.product_code': options.product_code });
          }
          if (options.tab) {
              this.setData({ activeTab: options.tab });
          }
      }

      this.updateSubCategoryActions(this.data.activeTab);

      // Load Zones from DB
      this.loadZones();

      // Load custom options from settings
      this.loadCustomOptions();
  },

  // 加载自定义子类别和单位选项
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

      // 刷新子类别列表
      this.updateSubCategoryActions(this.data.activeTab);
      // 刷新单位列表
      this.updateUnitActions(this.data.activeTab);
    } catch (err) {
      console.warn('加载自定义选项失败，使用默认值:', err);
      // 静默失败，仍然刷新默认选项
      this.updateSubCategoryActions(this.data.activeTab);
      this.updateUnitActions(this.data.activeTab);
    }
  },

  goToBatchEntry() {
      wx.navigateTo({
          url: '/pages/material-add/batch-entry'
      });
  },

  async loadZones() {
      try {
          const res = await wx.cloud.database().collection('warehouse_zones')
              .orderBy('order', 'asc')
              .get();

          const dbZones = res.data.map(z => z.name);
          this.setData({ dbZones: dbZones });

          this.updateZoneList();

      } catch (err) {
          console.error('Load zones failed', err);
          this.updateZoneList(); // Fallback to defaults
      }
  },

  updateZoneList() {
      const { activeTab, chemicalZonesDefaults, filmZonesDefaults, dbZones } = this.data;

      // 1. Base List
      let list = activeTab === 'chemical' ? [...chemicalZonesDefaults] : [...filmZonesDefaults];

      // 2. Merge DB Zones (deduplicate)
      // We append DB zones that are NOT in defaults
      const defaultsSet = new Set(list);
      if (dbZones && dbZones.length > 0) {
          dbZones.forEach(z => {
              if(!defaultsSet.has(z)) list.push(z);
          });
      }

      // 3. Add Create Option
      list.push('+ 新建区域...');

      this.setData({
          locationZones: list,
          locationZoneActions: list.map(z => ({ name: z }))
      });
  },

  onTabChange(e) {
    const tab = e.detail.name;

    // resetForm logic
    const { form } = this.data;
    // Keep unique_code maybe? No requirement, but let's keep it if user scanned it
    const cleanForm = {
       ...form,
       product_code: '',
       name: '',
       sub_category: '',
       supplier: '',
       supplier_model: '',
       batch_number: '',
       location: '',
       // specs
       unit: '', weight_kg: '', expiry_date: '',
       thickness_um: '', width_mm: '', length_m: ''
    };
    // Actually simpler to reset to defaultForm but keep unique_code
    // To match user Req: "Empty product_code, name, specs..."

    this.setData({
        activeTab: tab,
        // Reset dynamic fields
        'form.product_code': '',
        'form.name': '',
        'form.sub_category': '',
        'form.supplier_model': '',
        'form.batch_number': '',
        // We can keep unique_code
        suggestions: []
    }, () => {
        this.updateSubCategoryActions(tab);
        this.updateUnitActions(tab);
        this.updateZoneList(); // Refresh Zones
    });
  },

  updateSubCategoryActions(tab) {
      const baseList = tab === 'chemical' ? this.data.chemicalCategories : this.data.filmCategories;
      const customList = this.data.customSubCategories[tab] || [];

      // 合并基础选项和自定义选项
      const mergedList = [
        ...baseList,
        ...customList.map(name => ({ name, code: tab === 'chemical' ? 'J' : 'M', type: tab }))
      ];

      this.setData({ subCategoryActions: mergedList });
  },

  // 更新单位列表（合并自定义选项）
  updateUnitActions(tab) {
      const customList = this.data.customUnits[tab] || [];
      const baseList = [...UNIT_OPTIONS];

      // 添加自定义单位（去重）
      const existingNames = new Set(baseList.map(u => u.name));
      customList.forEach(name => {
        if (!existingNames.has(name)) {
          baseList.push({ name });
        }
      });

      this.setData({ unitActions: baseList });
  },

  // Helper to get prefix - 使用常量
  getPrefix(tab) {
      return CATEGORY_PREFIX[tab] || 'J-';
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail });

    // 联想输入逻辑: 改为监听 product_code
    if (field === 'product_code') {
        const val = e.detail; // This is purely numbers now
        if (this.data.suggestionTimer) clearTimeout(this.data.suggestionTimer);

        if (!val || val.length < 1) {
            this.setData({ suggestions: [] });
            return;
        }

        const prefix = this.getPrefix(this.data.activeTab);
        const fullKeyword = prefix + val; // Concat prefix

        // 防抖 500ms
        this.setData({
            suggestionTimer: setTimeout(() => {
                this.searchSuggestions(fullKeyword);
            }, 500)
        });
    }
  },

  // 分类选择
  showSubCategorySheet() { this.setData({ showSubCategorySheet: true }); },
  onSubCategoryClose() { this.setData({ showSubCategorySheet: false }); },
  onSubCategorySelect(e) {
      const item = e.detail;
      this.setData({
          'form.sub_category': item.name,
          showSubCategorySheet: false
      });
  },

  // 查询联想词 (从主数据表查询)
  async searchSuggestions(keyword) {
      if (!keyword) return;
      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'list',
                  data: {
                      searchVal: keyword,
                      category: this.data.activeTab,
                      pageSize: 10
                  }
              }
          });

          if (res.result && res.result.success) {
             // 将主数据结果映射为建议格式
             const suggestions = res.result.list.map(m => ({
                 _id: m._id,
                 product_code: m.product_code,
                 name: m.material_name,
                 supplier: m.supplier,
                 supplier_model: m.supplier_model,
                 sub_category: m.sub_category,
                 unit: m.default_unit,
                 category: m.category,
                 shelf_life_days: m.shelf_life_days
             }));
             this.setData({ suggestions });
          }
      } catch(err) {
          console.error('[Suggestion Error]', err);
      }
  },

  // 选中建议 (Auto-fill) - 自动填入所有可用字段
  onSelectSuggestion(e) {
      const item = e.currentTarget.dataset.item;
      // Parse prefix
      const prefix = this.getPrefix(this.data.activeTab);
      let numberPart = '';
      if (item.product_code && item.product_code.startsWith(prefix)) {
          numberPart = item.product_code.replace(prefix, '');
      } else if (item.product_code) {
          numberPart = item.product_code.split('-')[1] || item.product_code;
      }

      const { form } = this.data;
      const newForm = { ...form };

      // 基础信息
      newForm.product_code = numberPart;
      newForm.name = item.name || '';
      newForm.supplier = item.supplier || '';
      newForm.supplier_model = item.supplier_model || '';
      newForm.sub_category = item.sub_category || '';

      // 化材特有字段
      if (this.data.activeTab === 'chemical') {
          newForm.unit = item.unit || 'kg';
          newForm.package_type = item.package_type || '';

          // 从 specs 或其他位置恢复净含量
          let content = '';
          if (item.specs && item.specs.net_content) {
              content = item.specs.net_content;
          } else if (item.dynamic_attrs && item.dynamic_attrs.weight_kg) {
              content = item.dynamic_attrs.weight_kg;
          }
          if (content) {
              newForm.net_content = content;
          }
      } else {
          // 膜材特有字段
          if (item.specs) {
              newForm.thickness_um = item.specs.thickness_um || '';
              newForm.width_mm = item.specs.standard_width_mm || item.specs.width_mm || '';
          }
      }

      this.setData({
          form: newForm,
          suggestions: []
      });

      // 用户反馈
      wx.showToast({
          title: '已填入物料信息',
          icon: 'success',
          duration: 1500
      });
  },

  closeSuggestions() {
      this.setData({ suggestions: [] });
  },

  // 扫码
  onScanCode() {
      wx.scanCode({
          success: (res) => {
              this.setData({ 'form.unique_code': res.result });
              wx.showToast({ title: '扫码成功', icon: 'success' });
          },
          fail: (err) => {
              console.error(err);
          }
      });
  },

  // 单位选择
  showUnitSheet() { this.setData({ showUnitSheet: true }); },
  onUnitClose() { this.setData({ showUnitSheet: false }); },
  onUnitSelect(e) {
    // e.detail.name is now just 'kg', 'g', etc.
    this.setData({ 'form.unit': e.detail.name, showUnitSheet: false });
  },

  // 包装形式选择 (New)
  showPackageTypeSheet() { this.setData({ showPackageTypeSheet: true }); },
  onPackageTypeClose() { this.setData({ showPackageTypeSheet: false }); },
  onPackageTypeSelect(e) {
      this.setData({ 'form.package_type': e.detail.name, showPackageTypeSheet: false });
  },

  // 日期选择
  showDatePicker() { this.setData({ showDatePicker: true }); },
  onDateCancel() { this.setData({ showDatePicker: false }); },
  onDateConfirm(e) {
    const date = new Date(e.detail);
    const formated = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    this.setData({ 'form.expiry_date': formated, showDatePicker: false });
  },

  // 库位区域选择 (New)
  showLocationSheet() { this.setData({ showLocationSheet: true }); },
  onLocationClose() { this.setData({ showLocationSheet: false }); },
  onLocationSelect(e) {
      const zone = e.detail.name;

      if (zone === '+ 新建区域...') {
          this.setData({ showLocationSheet: false });
          wx.showModal({
              title: '新建存储区域',
              content: '',
              editable: true,
              placeholderText: '请输入区域名称 (如: 防爆柜)',
              success: async (res) => {
                  if (res.confirm && res.content) {
                       const newName = res.content.trim();
                       if(!newName) return;

                       wx.showLoading({ title: '创建中...' });
                       try {
                           const callRes = await wx.cloud.callFunction({
                               name: 'addWarehouseZone',
                               data: { name: newName }
                           });

                           if (callRes.result.success) {
                               wx.showToast({ title: '创建成功' });
                               // Refresh and Select
                               await this.loadZones();
                               this.setData({ 'form.location_zone': newName });
                           } else {
                               wx.showToast({ title: callRes.result.msg, icon: 'none' });
                           }
                       } catch(err) {
                           wx.showToast({ title: '创建失败', icon: 'none' });
                       } finally {
                           wx.hideLoading();
                       }
                  }
              }
          });
      } else {
          this.setData({
              'form.location_zone': zone,
              showLocationSheet: false
          });
      }
  },

  // SKU 校验
  validateSKU(code, type) {
      if (!code) return false;
      const upper = code.toUpperCase();
      if (type === 'chemical' && !upper.startsWith('J-')) return false;
      if (type === 'film' && !upper.startsWith('M-')) return false;
      return true;
  },

  async onSubmit() {
    const { activeTab, form } = this.data;

    // 1. 必填校验
    if (!form.unique_code) return Toast.fail('标签编号必填');
    if (!form.product_code) return Toast.fail('产品代码必填');
    if (!form.name) return Toast.fail('物料名称必填');

    // Construct Full Code
    const prefix = this.getPrefix(activeTab);
    const fullProductCode = prefix + form.product_code;

    // 前缀校验 (Double Check)
    if (!this.validateSKU(fullProductCode, activeTab)) {
        const msg = activeTab === 'chemical' ? '化材代码必须以 J- 开头' : '膜材代码必须以 M- 开头';
        return Toast.fail(msg);
    }

    if (!form.batch_number || !form.location_zone) {
      return Toast.fail('请完善批号和存储区域');
    }

    // Construct Location: Zone | Detail
    let fullLocation = form.location_zone;
    if (form.location_detail) {
        fullLocation += ` | ${form.location_detail}`;
    }

    // 2. 构造参数
    let base = {
      name: form.name,
      category: activeTab,
      sub_category: form.sub_category,
      product_code: fullProductCode,
      supplier: form.supplier,
      supplier_model: form.supplier_model || '',
      package_type: form.package_type || '' // New
    };

    let specs = {};
    let inventory = {
      batch_number: form.batch_number,
      location: fullLocation, // Use constructed location
    };

    if (activeTab === 'chemical') {
      if (!form.unit || !form.net_content || !form.expiry_date) {
        return Toast.fail('请完善化材规格信息');
      }
      base.unit = form.unit;

      // Map net_content to quantity_val
      const qty = Number(form.net_content);
      inventory.quantity_val = qty;
      inventory.quantity_unit = form.unit;
      inventory.weight_kg = qty; // Legacy support, or just generic weight
      inventory.expiry_date = form.expiry_date;

    } else {
      if (!form.thickness_um || !form.width_mm || !form.length_m) {
        return Toast.fail('请完善膜材规格信息');
      }
      base.unit = 'roll';
      specs.thickness_um = Number(form.thickness_um);
      specs.standard_width_mm = Number(form.width_mm);

      inventory.quantity_val = 1;
      inventory.quantity_unit = 'roll';
      inventory.length_m = form.length_m;
    }

    this.setData({ loading: true });

    try {
      const app = getApp();
      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

      const res = await wx.cloud.callFunction({
        name: 'addMaterial',
        data: {
          base,
          specs,
          inventory,
          unique_code: form.unique_code, // Pass code
          operator_name: operator
        }
      });

      if (res.result && res.result.success) {
        this.setData({ showSuccessDialog: true });
      } else {
        throw new Error(res.result.msg || 'Unknown Error');
      }

    } catch (err) {
      console.error(err);
      Toast.fail('入库失败: ' + err.message);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 连录下一桶：只重置动态信息
  onNextOne() {
      const { form } = this.data;
      // 保留: name, supplier, location, unit, thickness, width, activeTab
      // 保留: sub_category, product_code (通常同一种物料连录，这些都不变)
      // 清空: unique_code (必须重新扫), batch_number (可能变), expiry (可能变), quantity (可能变)

      // 实际上 batch number 和 expiry 很有可能是一样的，如果是一批进货的话。
      // 用户需求："重置动态数据：标签编号、生产批号、过期日期、重量"
      // 好的，遵照需求。

      const nextForm = {
          ...form,
          unique_code: '',
          batch_number: '',
          expiry_date: '',
          net_content: '', // Reset net content logic
          length_m: '',  // length 每次都要量
          location: '', // Deprecated
          location_zone: form.location_zone, // Keep Zone
          location_detail: form.location_detail // Keep Detail
      };

      this.setData({
          form: nextForm,
          showSuccessDialog: false
      });

      wx.pageScrollTo({ scrollTop: 0 }); // 回顶方便扫码
  },

  // 返回首页
  onSuccessBack() {
    this.setData({ showSuccessDialog: false });
    wx.navigateBack();
  }
});
