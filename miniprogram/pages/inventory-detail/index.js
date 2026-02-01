import Toast from '@vant/weapp/toast/toast';
import Dialog from '@vant/weapp/dialog/dialog';
const db = wx.cloud.database();
// const dayjs = require('../../utils/dayjs.min.js'); // Removed unused dependency

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    isExpiring: false,
    showWithdrawDialog: false,
    withdrawAmount: '',
    withdrawNote: ''
  },

  onLoad(options) {
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
        const res = await db.collection('inventory').doc(id).get();
        if (res.data) {
            let item = res.data;
            // Fetch material info (Supplier, Model, Specs)
            if (item.material_id) {
                try {
                    const matRes = await db.collection('materials').doc(item.material_id).get();
                    if (matRes.data) {
                        // Merge: Material Info (Base) < Inventory Info (Specific)
                        // Ensure we don't overwrite inventory _id
                        const invId = item._id;
                        item = { ...matRes.data, ...item, _id: invId };
                    }
                } catch(e) { console.warn('Material info not found', e); }
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

  processData(item) {
      // 1. Expiry Logic
      let isExpiring = false;
      let _expiryStr = '长期有效';

      if (item.expiry_date) {
          const now = new Date();
          const expiry = new Date(item.expiry_date);
          const diffTime = expiry - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays <= 30) isExpiring = true;

          _expiryStr = `${expiry.getFullYear()}-${String(expiry.getMonth()+1).padStart(2,'0')}-${String(expiry.getDate()).padStart(2,'0')}`;
          if(diffDays <= 0) _expiryStr += " (已过期)";
      } else if (item.category === 'chemical') {
          _expiryStr = '--';
      }

      // 2. Display Logic (Global Redesign)
      // Chemical: Title = Code, Sub = Name
      // Film: Title = Name, Sub = Code
      let _title = '';
      let _subtitle = '';
      const name = item.internal_standard_name || item.material_name || '未命名';
      const code = item.product_code || '--';

      // Normalize data for WXML (Ensure fields exist for Template)
      item.internal_standard_name = name;
      item.product_code = code;

      if (item.category === 'chemical') {
          _title = code;
          _subtitle = name;
      } else {
          // Film (or others)
          _title = name;
          _subtitle = code;
      }

      // ... (Quantity Logic remains same)
      let _qtyVal = item.remaining; // Default
      let _qtyUnit = 'kg';

      if (item.category === 'film') {
          _qtyVal = (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
          _qtyUnit = 'm';
      } else {
           _qtyVal = item.quantity.val;
           _qtyUnit = item.quantity.unit || 'kg';
      }

      // Override for chemical weight if dynamic exists
      if (item.category === 'chemical' && item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined) {
          _qtyVal = item.dynamic_attrs.weight_kg;
      }

      // ... (Status Logic remains same)
      let _statusBadge = { text: '使用中', type: 'success' };
      let originalQty = item.quantity.val;

      if (item.category === 'film') {
          originalQty = item.inventory ? item.inventory.length_m : 0;
      }

      if (Math.abs(_qtyVal - originalQty) < 0.1) {
          _statusBadge = { text: '未开封', type: 'primary' };
      }

      // 4. Strings & Localization
      let _categoryStr = item.category === 'chemical' ? '化材' : (item.category === 'film' ? '膜材' : '未知');
      if (item.sub_category) {
          _categoryStr += ` (${item.sub_category})`;
      }

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
              _categoryStr,
              // Fallbacks
              supplier: item.supplier || '-',
              supplier_model: item.supplier_model || '-',
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
      const { withdraw_amount, note } = e.detail;
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

          const res = await wx.cloud.callFunction({
              name: 'updateInventory',
              data: {
                  unique_code: item.unique_code,
                  withdraw_amount: withdraw_amount,
                  note: note,
                  operator_name: operator
              }
          });

          if (res.result && res.result.success) {
              const remaining = res.result.remaining;
              const unit = res.result.unit || '';
              Toast.success(`领用成功，剩余: ${remaining !== undefined ? remaining + ' ' + unit : '--'}`);
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
      // Filter logs by unique_code or inventory ID
      wx.navigateTo({
          url: `/pages/logs/index?unique_code=${this.data.item.unique_code}`
      });
  },

  onDelete() {
      const { item } = this.data;
      wx.showModal({
          title: '删除警告',
          content: `确定要删除 "${item.material_name}" 吗？此操作无法撤销。`,
          confirmColor: '#ee0a24',
          success: async (res) => {
              if (res.confirm) {
                  wx.showLoading({ title: '删除中...' });
                  try {
                      const app = getApp();
                      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

                      const cloudRes = await wx.cloud.callFunction({
                          name: 'removeInventory',
                          data: {
                              inventory_id: item._id,
                              operator_name: operator
                          }
                      });

                      if (cloudRes.result.success) {
                          wx.showToast({ title: '已删除' });
                          setTimeout(() => {
                              wx.navigateBack();
                          }, 1500);
                      } else {
                          throw new Error(cloudRes.result.msg);
                      }
                  } catch (err) {
                      console.error(err);
                      wx.showToast({ title: '删除失败', icon: 'none' });
                  } finally {
                      wx.hideLoading();
                  }
              }
          }
      });
  }
});
