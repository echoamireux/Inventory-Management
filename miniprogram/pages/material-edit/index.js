// pages/material-edit/index.js
const {
  buildLocationZoneActions,
  buildZoneMap,
  buildLocationPayload,
  extractLocationSelection
} = require('../../utils/location-zone');
const { getMovePageAccessState, canManageZones } = require('../../utils/move-page-access');
const { listZoneRecords } = require('../../utils/zone-service');

Page({
  data: {
    id: '',
    form: {
      zone_key: '',
      location_zone: '',
      location_detail: '',
      batch_number: '',
      material_name: '',
      product_code: '',
      unique_code: '',
      category: 'chemical'
    },
    loading: false,
    canManageZones: false,
    zoneRecords: [],
    showLocationSheet: false,
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
      const res = await wx.cloud.database().collection('inventory').doc(id).get();
      const item = res.data;
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
      const zoneRecords = await listZoneRecords(category, false);
      const zoneMap = buildZoneMap(zoneRecords);
      const selection = extractLocationSelection(inventoryItem || this.data.form, zoneMap);

      this.setData({
        zoneRecords,
        locationZoneActions: buildLocationZoneActions(zoneRecords, this.data.canManageZones),
        form: {
          ...(baseForm || this.data.form),
          zone_key: selection.zone_key,
          location_zone: selection.location_zone,
          location_detail: selection.location_detail,
          category
        }
      });
    } catch (err) {
      console.error('Load zones failed', err);
      this.setData({
        zoneRecords: [],
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
    this.setData({
      'form.zone_key': zoneRecord ? zoneRecord.zone_key : '',
      'form.location_zone': zoneName,
      showLocationSheet: false
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

    const locationPayload = buildLocationPayload(
      form.zone_key,
      form.location_detail,
      buildZoneMap(zoneRecords)
    );
    const updates = {
      zone_key: locationPayload.zone_key,
      location_detail: locationPayload.location_detail
    };

    this.setData({ loading: true });
    try {
      const app = getApp();
      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

      const res = await wx.cloud.callFunction({
        name: 'editInventory',
        data: {
          inventory_id: id,
          updates,
          operator_name: operator
        }
      });

      if (res.result.success) {
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
