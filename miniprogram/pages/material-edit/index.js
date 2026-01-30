// pages/material-edit/index.js
const db = require('../../utils/db');

// DEFAULTS: Strictly matched with User Expectations + Logic from Material-Add
// Chemical Defaults (Matches screenshot: Lab 1-3, Material Room, plus common storage types)
// Define Zone Defaults (Synced with material-add)
const CHEMICAL_ZONES = ['实验室1', '实验室2', '实验室3', '物料间'];

// Film Defaults (Matches Material-Add: R&D Warehouse 1-2, Line, plus common)
const FILM_ZONES = [
    '实验线',
    '膜材立库',
    '分切机台',
    '暂存区',
    '其他'
];

Page({
  data: {
    id: '', // Inventory ID
    form: {
        location_zone: '',
        location_detail: '',
        batch_number: '',
        material_name: '',
        product_code: '',
        unique_code: '',
        category: 'chemical' // Default
    },
    loading: false,

    showLocationSheet: false,
    locationZoneActions: []
  },

  onLoad(options) {
      if (options.id) {
          this.setData({ id: options.id });
          this.fetchDetail(options.id);
      }
  },

  async fetchDetail(id) {
      wx.showLoading({ title: '加载中...' });
      try {
          const res = await wx.cloud.database().collection('inventory').doc(id).get();
          const item = res.data;

          // Parse Location
          let zone = item.location;
          let detail = '';
          if (item.location && item.location.includes('|')) {
              const parts = item.location.split('|');
              zone = parts[0].trim();
              detail = parts[1] ? parts[1].trim() : '';
          }

          // Determine Material Name
          const name = item.material_name;
          const cat = item.category || 'chemical';

          this.setData({
              form: {
                  location_zone: zone,
                  location_detail: detail,
                  batch_number: item.batch_number,
                  material_name: name,
                  product_code: item.product_code,
                  unique_code: item.unique_code,
                  category: cat
              }
          });

          // Load Zones based on Category
          this.loadZones(cat);

      } catch (err) {
          console.error(err);
          wx.showToast({ title: '加载失败', icon: 'none' });
      } finally {
          wx.hideLoading();
      }
  },

  async loadZones(category = 'chemical') {
      const db = wx.cloud.database();
      // Select defaults based on category
      const defaults = category === 'film' ? FILM_ZONES : CHEMICAL_ZONES;

      try {
          const res = await db.collection('warehouse_zones').orderBy('order', 'asc').get();
          const customZones = res.data.map(z => z.name);

          // Merge: Defaults + Custom, Dedup
          const all = Array.from(new Set([...defaults, ...customZones]));

          const actions = all.map(z => ({ name: z }));
          actions.push({ name: '+ 新建区域...', color: '#1989fa' });

          this.setData({ locationZoneActions: actions });

      } catch (err) {
          console.error('Load zones failed', err);
          // Fallback
          const actions = defaults.map(z => ({ name: z }));
          actions.push({ name: '+ 新建区域...', color: '#1989fa' });
          this.setData({ locationZoneActions: actions });
      }
  },

  showLocationSheet() { this.setData({ showLocationSheet: true }); },
  onLocationClose() { this.setData({ showLocationSheet: false }); },

  onLocationSelect(e) {
      const zone = e.detail.name;
      if (zone === '+ 新建区域...') {
          this.setData({ showLocationSheet: false });
          wx.showModal({
              title: '新建存储区域',
              editable: true,
              placeholderText: '请输入区域名称',
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
                              // Reload zones
                              await this.loadZones(this.data.form.category);
                              // Select it
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

  onInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({ [`form.${field}`]: e.detail });
  },

  async onSubmit() {
      const { form, id } = this.data;
      if (!form.location_zone) {
          return wx.showToast({ title: '请选择存储区域', icon: 'none' });
      }

      let fullLocation = form.location_zone;
      if (form.location_detail) {
          fullLocation += ` | ${form.location_detail}`;
      }

      this.setData({ loading: true });
      try {
          const app = getApp();
          const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

          const res = await wx.cloud.callFunction({
              name: 'editInventory',
              data: {
                  inventory_id: id,
                  updates: {
                      location: fullLocation,
                      batch_number: form.batch_number
                  },
                  operator_name: operator
              }
          });

          if (res.result.success) {
              wx.showToast({ title: '修改成功', icon: 'success' });
              setTimeout(() => {
                  // Refresh previous page
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
          wx.showToast({ title: '修改失败: ' + err.message, icon: 'none' });
      } finally {
          this.setData({ loading: false });
      }
  }
});
