// pages/material-detail/index.js
const db = require('../../utils/db');
import Dialog from '@vant/weapp/dialog/dialog';

Page({
  data: {
    item: null,
    logs: [],
    loading: true,
    isAdmin: false,
    id: null
  },

  onLoad: function (options) {
    if (options.id) {
      this.setData({ id: options.id });
      this.fetchDetail(options.id);
    }

    const app = getApp();
    const user = app.globalData.user;
    if (user && user.role === 'admin') {
      this.setData({ isAdmin: true });
    }
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const itemRes = await wx.cloud.database().collection('inventory').doc(id).get();
      const item = itemRes.data;

      // Display Logic: Chemical -> Product Code; Film -> Material Name
      let displayTitle = item.material_name || '未命名';
      let displaySubtitle = item.product_code || item.unique_code || '';

      if (item.category === 'chemical' && item.product_code) {
          displayTitle = item.product_code;
          displaySubtitle = item.material_name;
      }

      item._displayTitle = displayTitle;
      item._displaySubtitle = displaySubtitle;

      item._displayQuantity = item.category === 'film'
          ? `${item.dynamic_attrs.current_length_m} m`
          : `${item.quantity.val} ${item.quantity.unit}`;

      const _ = wx.cloud.database().command;
      const logsRes = await wx.cloud.database().collection('inventory_log')
        .where({ material_id: id })
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();

      const logs = logsRes.data.map(log => {
        const unit = log.spec_change_unit || (item.category === 'film' ? 'm' : item.quantity.unit);
        let desc = '';
        if (log.type === 'outbound') {
            desc = `领用 ${Math.abs(log.quantity_change)} ${unit}`;
        } else if (log.type === 'inbound') {
            desc = `入库 ${log.quantity_change} ${unit}`;
        } else if (log.type === 'delete') {
            desc = '删除物料';
        } else {
            desc = '库存调整';
        }

        return {
          ...log,
          _timeStr: log.timestamp ? new Date(log.timestamp).toLocaleString() : '',
          _desc: desc
        };
      });

      this.setData({ item, logs });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onCopyCode() {
    if (this.data.item && this.data.item.unique_code) {
      wx.setClipboardData({
        data: this.data.item.unique_code,
        success: () => {
          wx.showToast({ title: '编码已复制' });
        }
      });
    }
  },

  onDelete() {
    Dialog.confirm({
      title: '确认删除',
      message: '确定要彻底删除该物料吗？此操作不可逆。',
      confirmButtonColor: '#FF0000'
    }).then(async () => {
        wx.showLoading({ title: '执行中...' });
        try {
            const app = getApp();
            const operator = app.globalData.user ? app.globalData.user.name : 'Admin';

            // 核心修复逻辑
            const invId = this.data.item ? this.data.item._id : this.data.id;
            const matId = this.data.item ? this.data.item.material_id : '';

            // Debug 日志
            console.warn('[DELETE DEBUG] IDs:', { invId, matId });

            if (!invId) {
                wx.hideLoading();
                Dialog.alert({ title: '错误', message: '严重错误：无法获取 Inventory ID，程序无法继续。' });
                return;
            }

            const cloudRes = await wx.cloud.callFunction({
              name: 'removeInventory',
              data: {
                material_id: matId || null,
                inventory_id: invId,
                operator_name: operator
              }
            });

            if (!cloudRes.result.success) {
                throw new Error(cloudRes.result.msg);
            }

            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });

            setTimeout(() => {
              wx.navigateBack();
            }, 1500);

        } catch (err) {
            console.error(err);
            wx.hideLoading();
            Dialog.alert({ title: '删除失败', message: '云函数报错: ' + err.message });
        }
    }).catch(() => {
        // Cancel logic
    });
  }
});
