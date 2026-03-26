// pages/admin-logs/index.js
const { getCstRange } = require('../../utils/cst');
const {
  buildLogSearchWhere,
  filterLogRecords,
  sortLogRecordsDescending
} = require('../../utils/log-search');

const ADMIN_LOG_SEARCH_FIELDS = [
  'material_name',
  'product_code',
  'unique_code',
  'batch_number',
  'operator',
  'operator_name',
  'type',
  'description',
  'note'
];

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

Page({
  data: {
    list: [],
    searchVal: '',
    page: 1,
    pageSize: 20,
    loading: false,
    isEnd: false,
    requestId: 0,
    searchScopeFields: ADMIN_LOG_SEARCH_FIELDS,

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
      { text: '补料', value: 'refill' },
      { text: '领用', value: 'outbound' },
      { text: '纠错', value: 'adjust' },
      { text: '移库', value: 'transfer' },
      { text: '删除', value: 'delete' }
    ],
    operatorOptions: [
      { text: '全部操作人', value: 'all' }
    ]
  },

  onLoad: function (options) {
    // 权限校验
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.status !== 'active' || !['admin', 'super_admin'].includes(user.role)) {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限已激活管理员访问',
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
    if (!this.data.isEnd && !this.data.loading) {
      this.getList(false);
    }
  },

  onSearch(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
    this.getList(true);
  },

  onSearchChange(e) {
    this.setData({ searchVal: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.getList(true);
    }, 400);
  },

  onClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', page: 1, isEnd: false });
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
    this.setData({ dateFilter: e.detail, page: 1, isEnd: false });
    this.getList(true);
  },

  onTypeFilterChange(e) {
    this.setData({ typeFilter: e.detail, page: 1, isEnd: false });
    this.getList(true);
  },

  onOperatorFilterChange(e) {
    this.setData({ operatorFilter: e.detail, page: 1, isEnd: false });
    this.getList(true);
  },

  async getList(reset = false) {
    if (!reset && this.data.loading) return;

    const currentRequestId = this.data.requestId + 1;
    this.setData({
      loading: true,
      requestId: currentRequestId
    });

    try {
      const dbInstance = wx.cloud.database();
      const _ = dbInstance.command;
      const nextPage = reset ? 1 : this.data.page;
      const {
        searchVal,
        dateFilter,
        typeFilter,
        operatorFilter,
        pageSize
      } = this.data;

      const matchedRecords = await this.loadLogsByDirectDb({
        dbInstance,
        _,
        searchVal,
        dateFilter,
        typeFilter,
        operatorFilter
      });
      const total = matchedRecords.length;
      const pageList = matchedRecords.slice((nextPage - 1) * pageSize, nextPage * pageSize);

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const formatted = pageList.map(item => {
        let typeText = '操作';
        let typeColor = 'primary';

        switch(item.type) {
          case 'inbound': case 'create': typeText = '入库'; typeColor = 'success'; break;
          case 'refill': typeText = '补料'; typeColor = 'success'; break;
          case 'outbound': typeText = '领用'; typeColor = 'warning'; break;
          case 'adjust': typeText = '纠错'; typeColor = 'primary'; break;
          case 'edit': case 'update': case 'transfer': typeText = '移库'; typeColor = 'primary'; break;
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
        else if (item.type === 'refill') sign = '+';
        else if (item.type === 'adjust') sign = qty > 0 ? '+' : (qty < 0 ? '-' : '');

        return {
          ...item,
          _typeText: typeText,
          _typeColor: typeColor,
          _timeStr: timeStr,
          _displayCode: displayCode,
          _displayName: displayName,
          _sign: sign,
          quantity: Math.abs(qty),
          unit: item.spec_change_unit || item.unit || ''
        };
      });

      this.setData({
        list: reset ? formatted : this.data.list.concat(formatted),
        page: nextPage + 1,
        isEnd: nextPage * pageSize >= total
      });

    } catch (err) {
      if (this.data.requestId !== currentRequestId) {
        return;
      }
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  async loadLogsByDirectDb(params = {}) {
    const {
      dbInstance,
      _,
      searchVal,
      dateFilter,
      typeFilter,
      operatorFilter
    } = params;
    const collection = dbInstance.collection('inventory_log');
    const where = buildLogSearchWhere({
      db: dbInstance,
      _,
      searchVal,
      dateFilter,
      typeFilter,
      operatorFilter,
      getCstRange
    });

    const batchSize = 100;
    let skip = 0;
    let allRecords = [];

    while (true) {
      const res = await collection.where(where)
        .skip(skip)
        .limit(batchSize)
        .get();
      const batch = res.data || [];
      allRecords = allRecords.concat(batch);
      if (batch.length < batchSize) {
        break;
      }
      skip += batchSize;
    }

    return sortLogRecordsDescending(filterLogRecords(allRecords, {
      searchVal,
      dateFilter,
      typeFilter,
      operatorFilter,
      getCstRange
    }));
  },

  // 发起库存纠错申请
  async onRequestCorrection(e) {
    const item = (e && e.detail && e.detail.item) || {};
    if (!item._id) {
      wx.showToast({ title: '无法获取日志信息', icon: 'none' });
      return;
    }

    const res = await new Promise(resolve => {
      wx.showModal({
        title: '发起纠错申请',
        content: '请确认要对该入库记录发起数量纠错申请？',
        confirmText: '继续',
        success: resolve
      });
    });
    if (!res.confirm) return;

    const quantityRes = await new Promise(resolve => {
      wx.showModal({
        title: '输入申请数量',
        editable: true,
        placeholderText: '请输入正确的数量',
        success: resolve
      });
    });
    if (!quantityRes.confirm || !quantityRes.content) return;

    const requestedQuantity = Number(quantityRes.content);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      wx.showToast({ title: '请输入有效的数量', icon: 'none' });
      return;
    }

    const reasonRes = await new Promise(resolve => {
      wx.showModal({
        title: '纠错原因',
        editable: true,
        placeholderText: '请输入纠错原因',
        success: resolve
      });
    });

    wx.showLoading({ title: '提交中...' });
    try {
      const result = await wx.cloud.callFunction({
        name: 'submitInventoryCorrectionRequest',
        data: {
          source_log_id: item._id,
          requested_quantity: requestedQuantity,
          reason: (reasonRes.confirm && reasonRes.content) || ''
        }
      });
      wx.hideLoading();
      if (result.result && result.result.success) {
        wx.showToast({ title: '申请已提交', icon: 'success' });
      } else {
        wx.showToast({ title: (result.result && result.result.msg) || '提交失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('submitInventoryCorrectionRequest error:', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

});
