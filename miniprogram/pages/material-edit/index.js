// pages/material-edit/index.js
const {
  buildLocationZoneActions,
  buildZoneMap,
  buildLocationDetailMapByZone,
  buildLocationDetailActions,
  hasManagedLocationDetails,
  buildLocationPayload,
  extractLocationSelection
} = require('../../utils/location-zone');
const { getMovePageAccessState, canManageZones } = require('../../utils/move-page-access');
const { listZoneConfig } = require('../../utils/zone-service');
const {
  ensureOperationId,
  clearOperationId
} = require('../../utils/operation-id');

Page({
  data: {
    id: '',
    form: {
      zone_key: '',
      location_zone: '',
      location_detail_key: '',
      location_detail: '',
      requires_location_detail: false,
      batch_number: '',
      material_name: '',
      product_code: '',
      unique_code: '',
      category: 'chemical'
    },
    loading: false,
    canManageZones: false,
    zoneRecords: [],
    detailRecords: [],
    showLocationSheet: false,
    showLocationDetailSheet: false,
    locationDetailActions: [],
    locationZoneActions: []
  },

  onLoad(options) {
    const inventoryId = options && options.id;
    if (!inventoryId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({ id: inventoryId });

    const initializePage = (user) => {
      const accessState = getMovePageAccessState(user);
      if (accessState === 'wait') {
        return;
      }
      if (accessState === 'deny') {
        wx.showModal({
          title: '无权限',
          content: '仅已激活用户可执行移库',
          showCancel: false,
          success: () => {
            wx.navigateBack();
          }
        });
        return;
      }

      this.setData({ canManageZones: canManageZones(user) });
      this.fetchDetail(inventoryId);
    };

    const app = getApp();
    if (app.globalData.user) {
      initializePage(app.globalData.user);
    } else {
      const previousCallback = app.userReadyCallback;
      app.userReadyCallback = (user) => {
        if (typeof previousCallback === 'function') {
          previousCallback(user);
        }
        initializePage(user);
      };
    }
    this._pageInitialized = true;
  },

  onShow() {
    if (this._pageInitialized && this.data.form.category) {
      this.loadZones(this.data.form.category);
    }
  },

  async fetchDetail(id) {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getInventoryRecord',
        data: {
          action: 'detail',
          id
        }
      });
      const result = res.result || {};
      if (!result.success || !result.data) {
        throw new Error(result.msg || '库存记录不存在');
      }
      const item = result.data;
      const category = item.category || 'chemical';

      await this.loadZones(category, item, {
        batch_number: item.batch_number,
        material_name: item.material_name,
        product_code: item.product_code,
        unique_code: item.unique_code,
        category
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadZones(category = 'chemical', inventoryItem = null, baseForm = null) {
    try {
      const zoneConfig = await listZoneConfig(category, false);
      const zoneRecords = zoneConfig.zones || [];
      const detailRecords = zoneConfig.details || [];
      const zoneMap = buildZoneMap(zoneRecords);
      const detailMapByZone = buildLocationDetailMapByZone(detailRecords);
      const selection = extractLocationSelection(inventoryItem || this.data.form, zoneMap, detailMapByZone);
      const locationDetailActions = buildLocationDetailActions(selection.zone_key, detailMapByZone);

      this.setData({
        zoneRecords,
        detailRecords,
        locationZoneActions: buildLocationZoneActions(zoneRecords, this.data.canManageZones),
        locationDetailActions,
        form: {
          ...(baseForm || this.data.form),
          zone_key: selection.zone_key,
          location_zone: selection.location_zone,
          location_detail_key: selection.location_detail_key,
          location_detail: selection.location_detail,
          requires_location_detail: hasManagedLocationDetails(selection.zone_key, detailMapByZone),
          category
        }
      });
    } catch (err) {
      console.error('Load zones failed', err);
      this.setData({
        zoneRecords: [],
        detailRecords: [],
        locationDetailActions: [],
        locationZoneActions: buildLocationZoneActions([], this.data.canManageZones)
      });
      wx.showToast({ title: err.message || '加载库区失败', icon: 'none' });
    }
  },

  showLocationSheet() {
    this.setData({ showLocationSheet: true });
  },

  onLocationClose() {
    this.setData({ showLocationSheet: false });
  },

  onLocationSelect(e) {
    const zoneName = e.detail.name;
    const zoneRecord = this.data.zoneRecords.find(item => item.name === zoneName);
    const zoneKey = zoneRecord ? zoneRecord.zone_key : '';
    const detailMapByZone = buildLocationDetailMapByZone(this.data.detailRecords);
    const locationDetailActions = buildLocationDetailActions(zoneKey, detailMapByZone);
    this.setData({
      'form.zone_key': zoneKey,
      'form.location_zone': zoneName,
      'form.location_detail_key': '',
      'form.location_detail': '',
      'form.requires_location_detail': hasManagedLocationDetails(zoneKey, detailMapByZone),
      locationDetailActions,
      showLocationSheet: false
    });
  },

  showLocationDetailSheet() {
    if (!this.data.form.requires_location_detail) {
      return;
    }
    this.setData({ showLocationDetailSheet: true });
  },

  onLocationDetailClose() {
    this.setData({ showLocationDetailSheet: false });
  },

  onLocationDetailSelect(e) {
    const item = e.detail || {};
    this.setData({
      'form.location_detail_key': item.detail_key || '',
      'form.location_detail': item.name || '',
      showLocationDetailSheet: false
    });
  },

  onManageZones() {
    if (!this.data.canManageZones) {
      return;
    }

    wx.navigateTo({
      url: `/pages/admin/zone-manage/index?category=${this.data.form.category || 'chemical'}`
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail });
  },

  async onSubmit() {
    const { form, id, zoneRecords } = this.data;
    if (!form.location_zone || !form.zone_key) {
      return wx.showToast({ title: '请选择存储区域', icon: 'none' });
    }
    if (form.requires_location_detail && !form.location_detail_key) {
      return wx.showToast({ title: '请选择详细坐标', icon: 'none' });
    }

    const locationPayload = buildLocationPayload(
      form.zone_key,
      form.location_detail,
      buildZoneMap(zoneRecords),
      buildLocationDetailMapByZone(this.data.detailRecords),
      form.location_detail_key
    );
    const updates = {
      zone_key: locationPayload.zone_key,
      location_detail_key: locationPayload.location_detail_key || '',
      location_detail: locationPayload.location_detail
    };

    this.setData({ loading: true });
    try {
      const app = getApp();
      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

      const payload = {
        inventory_id: id,
        updates,
        operator_name: operator
      };
      const operationScope = `editInventory:move:${id}`;
      const res = await wx.cloud.callFunction({
        name: 'editInventory',
        data: {
          ...payload,
          operation_id: ensureOperationId(operationScope, payload, 'move')
        }
      });

      if (res.result.success) {
        clearOperationId(operationScope);
        wx.showToast({ title: '修改成功', icon: 'success' });
        setTimeout(() => {
          const pages = getCurrentPages();
          const prevPage = pages[pages.length - 2];
          if (prevPage && prevPage.fetchDetail) {
            prevPage.fetchDetail(id);
          }
          wx.navigateBack();
        }, 1500);
      } else {
        throw new Error(res.result.msg);
      }
    } catch (err) {
      wx.showToast({ title: `修改失败: ${err.message}`, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
