// pages/inventory/detail-list.js
const db = wx.cloud.database();
const _ = db.command;
const { resolveInventoryLocation, buildZoneMap } = require('../../utils/location-zone');
const { listZoneRecords } = require('../../utils/zone-service');
const { listSubcategoryRecords } = require('../../utils/subcategory-service');
const { buildSubcategoryMap, resolveSubcategoryDisplay } = require('../../utils/material-subcategory');
const {
  buildMaterialMap,
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState,
  resolveInventoryExpiryDisplay
} = require('../../utils/inventory-display');

Page({
  data: {
    list: [],
    loading: false,
    hasLoadedOnce: false,
    queryCode: '',
    queryName: '',
    category: '',
    lastSeenInventoryChangeAt: 0,
    page: 1,
    pageSize: 20,
    total: 0,
    isEnd: false
  },

  onLoad(options) {
    const { code, name, category } = options;
    const decodedName = decodeURIComponent(name || '');
    const decodedCode = decodeURIComponent(code || '');
    const cat = category || '';

    this.setData({
        queryCode: decodedCode,
        queryName: decodedName,
        category: cat
    });

    let title = decodedCode || decodedName || '库存详情';

    wx.setNavigationBarTitle({
        title: title
    });
  },

  onShow() {
      const app = getApp();
      const inventoryChangedAt = (app.globalData && app.globalData.inventoryChangedAt) || 0;

      if (!this.data.hasLoadedOnce) {
          this.getList(true);
          return;
      }

      if (inventoryChangedAt && inventoryChangedAt !== this.data.lastSeenInventoryChangeAt) {
          this.getList(true);
      }
  },

  onPullDownRefresh() {
      this.getList(true);
  },

  onReachBottom() {
      if (this.data.loading || this.data.isEnd) {
          return;
      }
      this.getList(false);
  },

  async getList(reset = true) {
      if (this.data.loading) {
          wx.stopPullDownRefresh();
          return;
      }
      const nextPage = reset ? 1 : this.data.page;
      this.setData({ loading: true });
      try {
          const { queryCode, queryName, category, pageSize, list } = this.data;
          let where = { status: 'in_stock' };

          if (queryCode) {
              where.product_code = queryCode;
          } else if (queryName) {
              where.material_name = queryName;
          }

          if (category) where.category = category;

          const totalRes = await db.collection('inventory')
              .where(where)
              .count();
          const res = await db.collection('inventory')
              .where(where)
              .orderBy('expiry_date', 'asc') // FEFO
              .skip((nextPage - 1) * pageSize)
              .limit(pageSize)
              .get();
          const zoneRecords = await listZoneRecords(category || 'chemical', true);
          const zoneMap = buildZoneMap(zoneRecords);
          let subcategoryMap = new Map();
          let materialMap = new Map();
          try {
              const subcategoryRecords = await listSubcategoryRecords(category || 'chemical', true);
              subcategoryMap = buildSubcategoryMap(subcategoryRecords);
          } catch (subcategoryErr) {
              console.warn('加载子类别映射失败', subcategoryErr);
          }

          const productCodes = [...new Set((res.data || []).map(item => item.product_code).filter(Boolean))];
          if (productCodes.length > 0) {
              const materialRes = await db.collection('materials')
                  .where({ product_code: _.in(productCodes) })
                  .field({
                    _id: true,
                    product_code: true,
                    material_name: true,
                    status: true,
                    default_unit: true,
                    package_type: true,
                    supplier: true,
                    supplier_model: true,
                    specs: true,
                    subcategory_key: true,
                    sub_category: true
                  })
                  .get();
              materialMap = buildMaterialMap(materialRes.data || []);
          }

          const pageList = res.data.map(item => {
              const materialRecord = materialMap.get(item.product_code) || {};
              const mergedItem = mergeInventoryMaterialData(item, materialRecord);
              const quantityState = getInventoryQuantityDisplayState(mergedItem, materialRecord);
              const expiryState = resolveInventoryExpiryDisplay(mergedItem);

              // Format for UI
              return {
                  ...mergedItem,
                  sub_category: resolveSubcategoryDisplay(mergedItem, subcategoryMap) || mergedItem.sub_category || '',
                  location: resolveInventoryLocation(mergedItem, zoneMap),
                  expiry: expiryState.label,
                  _qtyStr: `${quantityState.displayQuantity} ${quantityState.displayUnit}`,
                  totalBaseLengthM: quantityState.baseLengthM,
                  isExpiring: this.checkExpiring(mergedItem.expiry_date),
                  isArchived: materialRecord.status === 'archived'
              };
          });
          const mergedList = reset ? pageList : list.concat(pageList);
          const total = Number(totalRes.total) || mergedList.length;

          this.setData({
              list: mergedList,
              total,
              page: nextPage + 1,
              isEnd: mergedList.length >= total,
              hasLoadedOnce: true,
              lastSeenInventoryChangeAt: (getApp().globalData && getApp().globalData.inventoryChangedAt) || 0
          });

      } catch (err) {
          console.error(err);
          wx.showToast({ title: '加载失败', icon: 'none' });
      } finally {
          this.setData({ loading: false });
          wx.stopPullDownRefresh();
      }
  },

  checkExpiring(dateStr) {
      if (!dateStr) return false;
      const now = new Date();
      const target = new Date(dateStr);
      return (target - now) < (30 * 24 * 60 * 60 * 1000);
  },

  // 复用长按删除逻辑
  onLongPress(e) {
      // similar logic to index.js
      // omit for brevity unless requested, or import from utils
  },

  goToDetail(e) {
      // 支持两种模式：组件返回 item 或 dataset
      const id = (e.detail && e.detail.item && e.detail.item._id) || e.currentTarget.dataset.id;
      if (!id) return;
      wx.navigateTo({
          url: `/pages/inventory-detail/index?id=${id}`
      });
  }
});
