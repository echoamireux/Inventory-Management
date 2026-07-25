import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const { resolveInventoryLocation, buildZoneMap, buildLocationDetailMapByZone } = require('../../utils/location-zone');
const { listZoneConfig } = require('../../utils/zone-service');
const { listSubcategoryRecords } = require('../../utils/subcategory-service');
const { buildSubcategoryMap, resolveSubcategoryDisplay } = require('../../utils/material-subcategory');
const {
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState,
  getInventorySpecDisplayState,
  resolveInventoryExpiryDisplay
} = require('../../utils/inventory-display');
const {
  ensureOperationId,
  clearOperationId
} = require('../../utils/operation-id');
// const dayjs = require('../../utils/dayjs.min.js'); // Removed unused dependency

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    isExpiring: false,
    canMoveInventory: false,
    canAdjustFilmWidth: false,
    canAdjustStocktake: false,
    showWithdrawDialog: false,
    withdrawAmount: '',
    withdrawNote: '',
    showWidthAdjustPopup: false,
    adjustWidthValue: '',
    adjustWidthReason: '',
    adjustingWidth: false,
    showStocktakeAdjustPopup: false,
    stocktakeQuantityValue: '',
    stocktakeAdjustReason: '',
    adjustingStocktake: false
  },

  onLoad(options) {
    const app = getApp();
    const user = app.globalData.user;
    if (user && user.status === 'active') {
      this.setData({ canMoveInventory: true });
    }
    if (user && ['admin', 'super_admin'].includes(user.role)) {
      this.setData({
        canAdjustFilmWidth: true,
        canAdjustStocktake: true
      });
    }

    if (options.id) {
      this.setData({ id: options.id });
      this.fetchDetail(options.id);
    } else {
        wx.showToast({ title: '参数错误', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
        const res = await wx.cloud.callFunction({
          name: 'getInventoryRecord',
          data: {
            action: 'detail',
            id
          }
        });
        const result = res.result || {};
        if (result.success && result.data) {
            let item = result.data;
            const materialRecord = result.material || await this.loadMaterialRecord(item);
            if (materialRecord) {
                item = mergeInventoryMaterialData(item, materialRecord);
                item.isArchived = materialRecord.status === 'archived';
            } else {
                item.isArchived = false;
            }

            try {
                const zoneConfig = await listZoneConfig(item.category || 'chemical', true);
                item.location = resolveInventoryLocation(
                    item,
                    buildZoneMap(zoneConfig.zones || []),
                    buildLocationDetailMapByZone(zoneConfig.details || [], { includeDisabled: true })
                );
            } catch (zoneErr) {
                console.warn('Zone lookup failed', zoneErr);
            }

            try {
                const subcategoryRecords = await listSubcategoryRecords(item.category || 'chemical', true);
                item.sub_category = resolveSubcategoryDisplay(item, buildSubcategoryMap(subcategoryRecords)) || item.sub_category || '';
            } catch (subcategoryErr) {
                console.warn('Subcategory lookup failed', subcategoryErr);
            }

            this.processData(item);
        } else {
            wx.showToast({ title: '物料不存在', icon: 'none' });
        }
    } catch (err) {
        console.error('Fetch detail failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
        this.setData({ loading: false });
    }
  },

  async loadMaterialRecord(item = {}) {
      if (!item.product_code) {
          return null;
      }

      try {
          const res = await wx.cloud.callFunction({
              name: 'manageMaterial',
              data: {
                  action: 'get',
                  data: {
                      product_code: item.product_code
                  }
              }
          });
          return res.result && res.result.success ? res.result.data : null;
      } catch (err) {
          console.warn('Material lookup by code failed', err);
      }

      return null;
  },

  processData(item) {
      // 1. Expiry Logic
      let isExpiring = false;
      const expiryState = resolveInventoryExpiryDisplay(item);
      let _expiryStr = expiryState.label;

      const expirySource = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);

      if (expiryState.hasExpiryDate && expirySource) {
          const now = new Date();
          const expiry = new Date(expirySource);
          const diffTime = expiry - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays <= 30) isExpiring = true;
          if(diffDays <= 0) _expiryStr += " (已过期)";
      }

      // 2. Display Logic (Global Redesign)
      // Test material: Title = supplier model, Sub = snapshot name, Meta = test code
      // Chemical: Title = Code, Sub = Name
      // Film: Title = Name, Sub = Code
      let _title = '';
      let _subtitle = '';
      let _headerCodeText = '';
      const name = item.internal_standard_name || item.material_name || '未命名';
      const code = item.product_code || '--';
      const supplierModel = String(item.supplier_model || '').trim();

      // Normalize data for WXML (Ensure fields exist for Template)
      item.internal_standard_name = name;
      item.product_code = code;

      if (item.is_test_material && supplierModel) {
          _title = supplierModel;
          _subtitle = name;
          _headerCodeText = `测试料代码: ${code}`;
      } else if (item.category === 'chemical') {
          _title = code;
          _subtitle = name;
      } else {
          // Film (or others)
          _title = name;
          _subtitle = code;
      }

      const quantityState = getInventoryQuantityDisplayState(item, item);
      let _qtyVal = quantityState.displayQuantity;
      let _qtyUnit = quantityState.displayUnit;

      // Override for chemical weight if dynamic exists
      if (item.category === 'chemical' && item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
          _qtyVal = item.dynamic_attrs.weight_kg;
      }

      // ... (Status Logic remains same)
      let _statusBadge = { text: '使用中', type: 'success' };
      let originalQty = item.quantity.val;
      let currentQty = _qtyVal;

      if (item.category === 'film') {
          originalQty = item.dynamic_attrs && item.dynamic_attrs.initial_length_m
            ? Number(item.dynamic_attrs.initial_length_m)
            : 0;
          currentQty = item.dynamic_attrs && item.dynamic_attrs.current_length_m !== undefined
            ? Number(item.dynamic_attrs.current_length_m)
            : 0;
      }

      if (Math.abs(currentQty - originalQty) < 0.1) {
          _statusBadge = { text: '未开封', type: 'primary' };
      }

      // 4. Strings & Localization
      const _categoryLabel = item.category === 'chemical' ? '化材' : (item.category === 'film' ? '膜材' : '未知');
      const _subcategoryLabel = item.sub_category || '-';
      const specDisplay = getInventorySpecDisplayState(item, item);

      let spec_string = '';
      if (item.category === 'chemical') {
          spec_string = `CAS: ${item.cas_number || '-'} \n备注: ${item.remarks || '无'}`;
      } else {
          spec_string = `涂层: ${item.dynamic_attrs.coating_info || '无'} \n备注: ${item.remarks || '无'}`;
      }

      // 5. Formatted Dates
      // 5. Formatted Dates (24h)
      let _createdStr = '--';
      if (item.create_time) {
          const d = new Date(item.create_time);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const h = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          _createdStr = `${y}-${m}-${day} ${h}:${min}`;
      }

      this.setData({
          item: {
              ...item,
              _title,
              _subtitle,
              _qtyVal,
              _qtyUnit,
              spec_string,
              _createdStr,
              _expiryStr,
              _statusBadge,
              _categoryLabel,
              _subcategoryLabel,
              _headerCodeText,
              _thicknessLabel: specDisplay.thicknessLabel,
              _widthLabel: specDisplay.widthLabel,
              _initialLengthLabel: specDisplay.initialLengthLabel,
              _packageTypeLabel: specDisplay.packageTypeLabel,
              _quantitySnapshotLabel: specDisplay.quantityLabel,
              // Fallbacks
              supplier: item.supplier || '-',
              supplier_model: item.supplier_model || '',
              sample_note: item.sample_note || '',
              is_test_material: !!item.is_test_material,
              product_code: code
          },
          isExpiring
      });
  },

  onCollapseChange(event) {
    this.setData({
      activeNames: event.detail,
    });
  },

  // Actions
  showOutboundPopup() {
      this.setData({
          showWithdrawDialog: true,
          withdrawAmount: '',
          withdrawNote: ''
      });
  },

  onWithdrawClose() {
      this.setData({ showWithdrawDialog: false });
  },

  async onWithdrawConfirmFn(e) {
      const {
          withdraw_amount,
          project_code,
          project_name,
          withdraw_note,
          note
      } = e.detail;
      const { item } = this.data;

      if (!withdraw_amount || Number(withdraw_amount) <= 0) {
          Toast.fail('请输入有效数量');
          return;
      }

      this.setData({ showWithdrawDialog: false });
      Toast.loading({ message: '提交中...', forbidClick: true });

      try {
          const app = getApp();
          const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

          const payload = {
              unique_code: item.unique_code,
              withdraw_amount: withdraw_amount,
              project_code,
              project_name,
              withdraw_note,
              note: project_code || note,
              operator_name: operator
          };
          const operationScope = `updateInventory:detail-withdraw:${item.unique_code || this.data.id}`;
          const res = await wx.cloud.callFunction({
              name: 'updateInventory',
              data: {
                  ...payload,
                  operation_id: ensureOperationId(operationScope, payload, 'withdraw')
              }
          });

          if (res.result && res.result.success) {
              clearOperationId(operationScope);
              getApp().globalData.inventoryChangedAt = Date.now();
              const remaining = res.result.displayRemaining !== undefined
                ? res.result.displayRemaining
                : res.result.remaining;
              const unit = res.result.displayUnit || res.result.unit || '';
              const scope = res.result.remainingScope || '';
              Toast.success(`领用成功，${scope}剩余: ${remaining !== undefined ? remaining + ' ' + unit : '--'}`);
              // Refresh details
              setTimeout(() => {
                  this.fetchDetail(this.data.id);
              }, 1000);
          } else {
              throw new Error(res.result.msg || '未知错误');
          }
      } catch (err) {
          console.error(err);
          Dialog.alert({ title: '领用失败', message: err.message });
      }
  },

  onEdit() {
      console.log('onEdit triggered', this.data.id);
      if (!this.data.id) {
          wx.showToast({ title: 'ID Missing', icon: 'none' });
          return;
      }
      wx.navigateTo({
          url: `/pages/material-edit/index?id=${this.data.id}`,
          fail: (err) => {
              console.error('Nav failed', err);
              wx.showToast({ title: '跳转失败', icon: 'none' });
          }
      });
  },

  onViewLogs() {
      const item = this.data.item || {};
      const uniqueCode = String(item.unique_code || '').trim();
      const query = uniqueCode
          ? `unique_code=${encodeURIComponent(uniqueCode)}`
          : `inventory_id=${encodeURIComponent(this.data.id || item._id || '')}`;
      wx.navigateTo({
          url: `/pages/logs/index?${query}`
      });
  },

  onShowWidthAdjustPopup() {
      const { item, canAdjustFilmWidth } = this.data;
      if (!canAdjustFilmWidth || !item || item.category !== 'film') {
          return;
      }

      const currentWidth = item.dynamic_attrs && item.dynamic_attrs.width_mm !== undefined
        ? item.dynamic_attrs.width_mm
        : '';
      this.setData({
          showWidthAdjustPopup: true,
          adjustWidthValue: currentWidth !== '' && currentWidth !== null ? String(currentWidth) : '',
          adjustWidthReason: ''
      });
  },

  onCloseWidthAdjustPopup() {
      this.setData({
          showWidthAdjustPopup: false,
          adjustWidthValue: '',
          adjustWidthReason: '',
          adjustingWidth: false
      });
  },

  onAdjustWidthValueInput(e) {
      this.setData({ adjustWidthValue: e.detail });
  },

  onAdjustWidthReasonInput(e) {
      this.setData({ adjustWidthReason: e.detail });
  },

  async onAdjustFilmWidthConfirm() {
      const { item, adjustWidthValue, adjustWidthReason, adjustingWidth } = this.data;
      if (adjustingWidth) {
          return;
      }
      const nextWidth = Number(adjustWidthValue);
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
          Toast.fail('请输入有效的幅宽');
          return;
      }

      this.setData({ adjustingWidth: true });
      Toast.loading({ message: '保存中...', forbidClick: true });

      try {
          const app = getApp();
          const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';
          const payload = {
              inventory_id: this.data.id,
              operator_name: operator,
              updates: {
                  width_mm: nextWidth,
                  adjust_reason: String(adjustWidthReason || '').trim()
              }
          };
          const operationScope = `editInventory:width:${this.data.id}`;
          const res = await wx.cloud.callFunction({
              name: 'editInventory',
              data: {
                  ...payload,
                  operation_id: ensureOperationId(operationScope, payload, 'edit')
              }
          });

          if (res.result && res.result.success) {
              clearOperationId(operationScope);
              getApp().globalData.inventoryChangedAt = Date.now();
              Toast.success('幅宽已修正');
              this.setData({
                  showWidthAdjustPopup: false,
                  adjustWidthValue: '',
                  adjustWidthReason: ''
              });
              setTimeout(() => {
                  this.fetchDetail(this.data.id);
              }, 500);
          } else {
              throw new Error((res.result && res.result.msg) || '修正失败');
          }
      } catch (err) {
          console.error(err);
          Toast.fail(err.message || '修正失败');
      } finally {
          this.setData({ adjustingWidth: false });
      }
  },

  onShowStocktakeAdjustPopup() {
      const { item, canAdjustStocktake } = this.data;
      if (!canAdjustStocktake || !item) {
          return;
      }

      const currentQuantity = item.category === 'film'
        ? (item.dynamic_attrs && item.dynamic_attrs.current_length_m !== undefined ? item.dynamic_attrs.current_length_m : '')
        : item._qtyVal;

      this.setData({
          showStocktakeAdjustPopup: true,
          stocktakeQuantityValue: currentQuantity !== '' && currentQuantity !== null ? String(currentQuantity) : '',
          stocktakeAdjustReason: ''
      });
  },

  onCloseStocktakeAdjustPopup() {
      this.setData({
          showStocktakeAdjustPopup: false,
          stocktakeQuantityValue: '',
          stocktakeAdjustReason: '',
          adjustingStocktake: false
      });
  },

  onStocktakeQuantityInput(e) {
      this.setData({ stocktakeQuantityValue: e.detail });
  },

  onStocktakeReasonInput(e) {
      this.setData({ stocktakeAdjustReason: e.detail });
  },

  async onStocktakeAdjustConfirm() {
      const { stocktakeQuantityValue, stocktakeAdjustReason, adjustingStocktake, item } = this.data;
      if (adjustingStocktake) {
          return;
      }

      const nextQuantity = Number(stocktakeQuantityValue);
      if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
          Toast.fail(item && item.category === 'film' ? '请输入有效的剩余长度' : '请输入有效的当前数量');
          return;
      }

      this.setData({ adjustingStocktake: true });
      Toast.loading({ message: '保存中...', forbidClick: true });

      try {
          const app = getApp();
          const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';
          const payload = {
              inventory_id: this.data.id,
              operator_name: operator,
              updates: {
                  stocktake_quantity: nextQuantity,
                  adjust_reason: String(stocktakeAdjustReason || '').trim()
              }
          };
          const operationScope = `editInventory:stocktake:${this.data.id}`;
          const res = await wx.cloud.callFunction({
              name: 'editInventory',
              data: {
                  ...payload,
                  operation_id: ensureOperationId(operationScope, payload, 'edit')
              }
          });

          if (res.result && res.result.success) {
              clearOperationId(operationScope);
              getApp().globalData.inventoryChangedAt = Date.now();
              Toast.success('盘点调整已保存');
              this.setData({
                  showStocktakeAdjustPopup: false,
                  stocktakeQuantityValue: '',
                  stocktakeAdjustReason: ''
              });
              setTimeout(() => {
                  this.fetchDetail(this.data.id);
              }, 500);
          } else {
              throw new Error((res.result && res.result.msg) || '盘点调整失败');
          }
      } catch (err) {
          console.error(err);
          Toast.fail(err.message || '盘点调整失败');
      } finally {
          this.setData({ adjustingStocktake: false });
      }
  },

});
