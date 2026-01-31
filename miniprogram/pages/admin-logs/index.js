// pages/admin-logs/index.js
const db = require('../../utils/db');

Page({
  data: {
    list: [],
    searchVal: '',
    page: 1,
    loading: false,
    isEnd: false,

    // 筛选器
    dateFilter: 'all',
    typeFilter: 'all',
    operatorFilter: 'all',

    dateOptions: [
      { text: '全部时间', value: 'all' },
      { text: '今日', value: 'today' },
      { text: '本周', value: 'week' },
      { text: '本月', value: 'month' }
    ],
    typeOptions: [
      { text: '全部类型', value: 'all' },
      { text: '入库', value: 'inbound' },
      { text: '领用', value: 'outbound' },
      { text: '移库', value: 'edit' },
      { text: '删除', value: 'delete' }
    ],
    operatorOptions: [
      { text: '全部操作人', value: 'all' }
    ],
    // ActionSheet 状态
    showActionSheet: false,
    actionSheetActions: [
      { name: '删除此条日志', color: '#ee0a24' }
    ],
    currentLogId: '',
  },

  onLoad: function (options) {
    // 权限校验
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.role !== 'admin') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    // 加载操作人列表
    this.loadOperators();
    this.getList(true);
  },

  onPullDownRefresh() {
    this.getList(true);
  },

  onReachBottom() {
    if (!this.isEnd && !this.data.loading) {
      this.getList(false);
    }
  },

  onSearch(e) {
    this.setData({ searchVal: e.detail });
    this.getList(true);
  },

  onSearchChange(e) {
    this.setData({ searchVal: e.detail });
  },

  onClear() {
    this.setData({ searchVal: '' });
    this.getList(true);
  },

  // 加载操作人列表
  async loadOperators() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOperators'
      });
      if (res.result && res.result.list) {
        const operatorOptions = [
          { text: '全部操作人', value: 'all' },
          ...res.result.list.map(op => ({ text: op, value: op }))
        ];
        this.setData({ operatorOptions });
      }
    } catch (err) {
      console.warn('加载操作人列表失败:', err);
    }
  },

  // 筛选器变更
  onDateFilterChange(e) {
    this.setData({ dateFilter: e.detail });
    this.getList(true);
  },

  onTypeFilterChange(e) {
    this.setData({ typeFilter: e.detail });
    this.getList(true);
  },

  onOperatorFilterChange(e) {
    this.setData({ operatorFilter: e.detail });
    this.getList(true);
  },

  async getList(reset = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });
    if (reset) {
      this.setData({ page: 1, list: [], isEnd: false });
    }

    try {
      const dbInstance = wx.cloud.database();
      const _ = dbInstance.command;

      let conditions = [];

      // 搜索条件
      if (this.data.searchVal) {
        const regex = dbInstance.RegExp({
          regexp: this.data.searchVal,
          options: 'i',
        });
        conditions.push(_.or([
          { material_name: regex },
          { operator: regex },
          { product_code: regex }
        ]));
      }

      // 日期筛选
      const { dateFilter } = this.data;
      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate;

        if (dateFilter === 'today') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (dateFilter === 'week') {
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        } else if (dateFilter === 'month') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        if (startDate) {
          conditions.push({ timestamp: _.gte(startDate) });
        }
      }

      // 类型筛选
      const { typeFilter } = this.data;
      if (typeFilter !== 'all') {
        if (typeFilter === 'inbound') {
          conditions.push({ type: _.in(['inbound', 'create']) });
        } else {
          conditions.push({ type: typeFilter });
        }
      }

      // 操作人筛选
      const { operatorFilter } = this.data;
      if (operatorFilter !== 'all') {
        conditions.push(_.or([
          { operator: operatorFilter },
          { operator_name: operatorFilter }
        ]));
      }

      // 组合条件
      let where = conditions.length > 0 ? _.and(conditions) : {};

      const res = await db.logs.getList(where, this.data.page, 20, 'timestamp', 'desc');

      const formatted = res.map(item => {
        let typeText = '操作';
        let typeColor = 'primary';

        switch(item.type) {
          case 'inbound': case 'create': typeText = '入库'; typeColor = 'success'; break;
          case 'outbound': typeText = '领用'; typeColor = 'warning'; break;
          case 'edit': case 'update': typeText = '移库'; typeColor = 'primary'; break;
          case 'delete': typeText = '删除'; typeColor = 'danger'; break;
        }

        // 24h 时间格式
        let timeStr = '';
        if (item.timestamp) {
          const d = new Date(item.timestamp);
          if (!isNaN(d.getTime())) {
            timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          }
        }

        // 统一物料标识
        let displayCode = item.product_code || '';
        let displayName = item.material_name || '未命名';

        // 数量处理
        let qty = item.quantity_change;
        if (qty && typeof qty === 'object' && qty.val) {
          qty = qty.val;
        }
        qty = Number(qty) || 0;

        let sign = '';
        if (item.type === 'inbound' || item.type === 'create') sign = '+';
        else if (item.type === 'outbound') sign = '-';

        return {
          ...item,
          _typeText: typeText,
          _typeColor: typeColor,
          _timeStr: timeStr,
          _displayCode: displayCode,
          _displayName: displayName,
          _sign: sign,
          quantity: Math.abs(qty),
          unit: item.unit || ''
        };
      });

      this.setData({
        list: reset ? formatted : this.data.list.concat(formatted),
        page: this.data.page + 1,
        isEnd: res.length < 20
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  // 组件长按事件
  onLongPressItem(e) {
    const item = e.detail && e.detail.item;
    if (!item) return;
    this.setData({
      showActionSheet: true,
      currentLogId: item._id
    });
  },

  onActionSheetClose() {
    this.setData({ showActionSheet: false });
  },

  onActionSheetSelect(e) {
    const { name } = e.detail;
    if (name === '删除此条日志') {
      this.confirmDeleteLog();
    }
  },

  confirmDeleteLog() {
    const id = this.data.currentLogId;
    if (!id) return;

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条日志吗？这可能会影响审计溯源。',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const callRes = await wx.cloud.callFunction({
              name: 'removeLog',
              data: { log_id: id }
            });
            if (callRes.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.setData({ showActionSheet: false }); // Ensure close
              this.getList(true);
            } else {
              throw new Error(callRes.result.msg);
            }
          } catch (err) {
            wx.showToast({ title: '删除失败: ' + err.message, icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  }
});
