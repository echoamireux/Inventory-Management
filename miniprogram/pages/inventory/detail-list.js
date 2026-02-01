// pages/inventory/detail-list.js
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    list: [],
    loading: false,
    queryCode: '',
    queryName: ''
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

    let title = decodedName;
    if (cat === 'chemical' && decodedCode) {
        title = decodedCode;
    }

    wx.setNavigationBarTitle({
        title: title || '库存详情'
    });

    this.getList();
  },

  async getList() {
      this.setData({ loading: true });
      try {
          const { queryCode, queryName, category } = this.data;
          let where = { status: 'in_stock' };

          if (queryCode) {
              where.product_code = queryCode;
          } else if (queryName) {
              where.material_name = queryName;
          }

          if (category) where.category = category;

          // Fetch all items for this group
          const res = await db.collection('inventory')
              .where(where)
              .orderBy('expiry_date', 'asc') // FEFO
              .limit(100)
              .get();

          const list = res.data.map(item => {
              // Format expiry date
              let expiryStr = '长期有效';
              if (item.expiry_date) {
                  const d = new Date(item.expiry_date);
                  if (!isNaN(d.getTime())) {
                      expiryStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  }
              }

              // Format for UI
              return {
                  ...item,
                  expiry: expiryStr,
                  _qtyStr: item.category === 'film'
                    ? `${item.dynamic_attrs.current_length_m} m`
                    : `${item.quantity.val} ${item.quantity.unit}`,
                  isExpiring: this.checkExpiring(item.expiry_date)
              };
          });

          // 检查物料归档状态
          const productCodes = [...new Set(list.map(item => item.product_code).filter(Boolean))];
          if (productCodes.length > 0) {
              const matRes = await db.collection('materials')
                  .where({ product_code: _.in(productCodes) })
                  .field({ product_code: true, status: true })
                  .get();

              const archivedSet = new Set(
                  matRes.data
                      .filter(m => m.status === 'archived')
                      .map(m => m.product_code)
              );

              list.forEach(item => {
                  item.isArchived = archivedSet.has(item.product_code);
              });
          }

          this.setData({ list });

      } catch (err) {
          console.error(err);
      } finally {
          this.setData({ loading: false });
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
