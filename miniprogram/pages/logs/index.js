// pages/logs/index.js
const { sortLogRecordsDescending } = require('../../utils/log-search');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

const DATE_FILTER_VALUES = ['all', 'today', 'week', 'month', 'custom'];
const TYPE_FILTER_VALUES = [
  'all',
  'inbound',
  'refill',
  'outbound',
  'adjust',
  'width_adjust',
  'stocktake_adjust',
  'inventory_correction',
  'transfer',
  'delete'
];
const TYPE_TITLE_MAP = {
  all: '操作日志',
  inbound: '入库记录',
  refill: '补料记录',
  outbound: '领用记录',
  adjust: '纠错记录',
  width_adjust: '修正幅宽记录',
  stocktake_adjust: '盘点调整记录',
  inventory_correction: '库存纠错记录',
  transfer: '移库记录',
  delete: '删除记录'
};

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getTodayTimestamp() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildCalendarDefaultDate(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (start && end) {
    return [start.getTime(), end.getTime()];
  }
  const today = getTodayTimestamp();
  return [today, today];
}

function normalizeOption(value, allowedValues, fallback = 'all') {
  const normalized = String(value || '').trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function resolveLogNavigationTitle(queryCode, typeFilter) {
  const normalizedQueryCode = String(queryCode || '').trim();
  if (normalizedQueryCode) {
    return `${normalizedQueryCode} - 操作日志`;
  }
  return TYPE_TITLE_MAP[normalizeOption(typeFilter, TYPE_FILTER_VALUES)] || '操作日志';
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function looksLikeInternalId(value) {
  const text = normalizeText(value);
  return /^o[A-Za-z0-9_-]{20,}$/.test(text) || /^[A-Za-z0-9_-]{28,}$/.test(text);
}

function resolveOperatorDisplayName(primaryName, fallbackId) {
  const primary = normalizeText(primaryName);
  if (primary && !/^system$/i.test(primary) && !looksLikeInternalId(primary)) {
    return primary;
  }
  const fallback = normalizeText(fallbackId);
  if (fallback && !looksLikeInternalId(fallback)) {
    return fallback;
  }
  return primary && /^system$/i.test(primary) ? '系统' : '未记录姓名';
}

function normalizeDateState(options = {}, fallbackDateFilter = 'all') {
  let dateFilter = normalizeOption(options.dateFilter || options.date_filter || fallbackDateFilter, DATE_FILTER_VALUES);
  let startDate = String(options.startDate || options.start_date || '').trim();
  let endDate = String(options.endDate || options.end_date || '').trim();
  if (dateFilter !== 'custom') {
    startDate = '';
    endDate = '';
  } else if (!startDate || !endDate) {
    dateFilter = 'all';
    startDate = '';
    endDate = '';
  }

  return {
    dateFilter,
    startDate,
    endDate,
    dateRangeText: startDate && endDate ? `${startDate} 至 ${endDate}` : '',
    calendarDefaultDate: buildCalendarDefaultDate(startDate, endDate)
  };
}

Page({
  data: {
    logList: [],
    loading: false,
    isEnd: false,
    page: 1,
    pageSize: 50,
    requestId: 0,
    queryCode: '',
    searchVal: '',  // 搜索关键词

    // 筛选器
    dateFilter: 'all',
    startDate: '',
    endDate: '',
    dateRangeText: '',
    showDateCalendar: false,
    minDate: new Date(2020, 0, 1).getTime(),
    maxDate: getTodayTimestamp(),
    calendarDefaultDate: buildCalendarDefaultDate('', ''),
    typeFilter: 'all',
    operatorFilter: 'all',
    dateOptions: [
      { text: '全部时间', value: 'all' },
      { text: '今日', value: 'today' },
      { text: '本周', value: 'week' },
      { text: '本月', value: 'month' },
      { text: '自定义', value: 'custom' }
    ],
    typeOptions: [
      { text: '全部类型', value: 'all' },
      { text: '入库', value: 'inbound' },
      { text: '补料', value: 'refill' },
      { text: '领用', value: 'outbound' },
      { text: '纠错', value: 'adjust' },
      { text: '修正幅宽', value: 'width_adjust' },
      { text: '盘点调整', value: 'stocktake_adjust' },
      { text: '库存纠错', value: 'inventory_correction' },
      { text: '移库', value: 'transfer' },
      { text: '删除', value: 'delete' }
    ],
    operatorOptions: [
      { text: '全部操作人', value: 'all' }
    ]
  },

  onLoad(options) {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || user.status !== 'active') {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限已激活用户访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    let queryCode = '';
    let initialDateFilter = normalizeOption(options.dateFilter || options.date_filter, DATE_FILTER_VALUES);
    let initialTypeFilter = normalizeOption(options.typeFilter || options.type_filter, TYPE_FILTER_VALUES);
    // Support filtering by unique_code, id, or global filters
    if (options.unique_code) {
        queryCode = options.unique_code;
    } else if (options.filter === 'today_in' || options.filter === 'today_out') {
        // 兼容旧入口：旧版本把“今日入库/出库”藏在 queryCode 中，
        // 新版本改为页面可见的类型 + 时间筛选，避免“全部时间”但实际只查今日。
        initialDateFilter = 'today';
        initialTypeFilter = options.filter === 'today_in' ? 'inbound' : 'outbound';
    }

    wx.setNavigationBarTitle({ title: resolveLogNavigationTitle(queryCode, initialTypeFilter) });
    this.setData({
      queryCode,
      typeFilter: initialTypeFilter,
      ...normalizeDateState(options, initialDateFilter)
    });

    this.loadOperators();
    this.getLogs(true);
  },

  onPullDownRefresh() {
      this.getLogs(true);
  },

  onReachBottom() {
    if (!this.data.isEnd && !this.data.loading) {
      this.getLogs(false);
    }
  },

  // 筛选器变更
  onDateFilterChange(e) {
    const nextFilter = normalizeOption(e.detail, DATE_FILTER_VALUES);
    if (nextFilter === 'custom') {
      this.setData({
        dateFilter: 'custom',
        showDateCalendar: true,
        maxDate: getTodayTimestamp(),
        calendarDefaultDate: buildCalendarDefaultDate(this.data.startDate, this.data.endDate),
        page: 1,
        isEnd: false
      });
      return;
    }

    this.setData({
      dateFilter: nextFilter,
      startDate: '',
      endDate: '',
      dateRangeText: '',
      showDateCalendar: false,
      calendarDefaultDate: buildCalendarDefaultDate('', ''),
      page: 1,
      isEnd: false
    });
    this.getLogs(true);
  },

  onShowDateCalendar() {
    this.setData({
      dateFilter: 'custom',
      showDateCalendar: true,
      maxDate: getTodayTimestamp(),
      calendarDefaultDate: buildCalendarDefaultDate(this.data.startDate, this.data.endDate)
    });
  },

  onDateCalendarClose() {
    const hasRange = !!(this.data.startDate && this.data.endDate);
    this.setData({
      showDateCalendar: false,
      ...(hasRange ? {} : { dateFilter: 'all' })
    });
  },

  onDateCalendarConfirm(e) {
    const range = e && e.detail;
    if (!Array.isArray(range) || range.length !== 2) {
      wx.showToast({ title: '请选择完整日期范围', icon: 'none' });
      return;
    }
    const startDate = formatDate(range[0]);
    const endDate = formatDate(range[1]);
    if (!startDate || !endDate) {
      wx.showToast({ title: '日期范围无效', icon: 'none' });
      return;
    }
    this.setData({
      dateFilter: 'custom',
      startDate,
      endDate,
      dateRangeText: `${startDate} 至 ${endDate}`,
      calendarDefaultDate: buildCalendarDefaultDate(startDate, endDate),
      showDateCalendar: false,
      page: 1,
      isEnd: false
    });
    this.getLogs(true);
  },

  onTypeFilterChange(e) {
    const typeFilter = normalizeOption(e.detail, TYPE_FILTER_VALUES);
    wx.setNavigationBarTitle({ title: resolveLogNavigationTitle(this.data.queryCode, typeFilter) });
    this.setData({ typeFilter, page: 1, isEnd: false });
    this.getLogs(true);
  },

  onOperatorFilterChange(e) {
    this.setData({ operatorFilter: e.detail, page: 1, isEnd: false });
    this.getLogs(true);
  },

  // 搜索功能
  onSearch(e) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
    this.getLogs(true);
  },

  onSearchChange(e) {
    this.setData({ searchVal: resolveSearchValue(e && e.detail), page: 1, isEnd: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.getLogs(true);
    }, 400);
  },

  onClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ searchVal: '', page: 1, isEnd: false });
    this.getLogs(true);
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

  async getLogs(reset = false) {
      if (!reset && this.data.loading) {
        return;
      }

      const currentRequestId = this.data.requestId + 1;
      this.setData({
        loading: true,
        requestId: currentRequestId
      });
      const nextPage = reset ? 1 : this.data.page;
      const pageSize = this.data.pageSize;
      try {
          const {
            queryCode,
            searchVal,
            dateFilter,
            startDate,
            endDate,
            typeFilter,
            operatorFilter
          } = this.data;

          let rawList = [];
          let total = 0;

          const res = await wx.cloud.callFunction({
              name: 'getLogs',
              data: {
                  queryCode: queryCode,
                  searchVal: searchVal,
                  dateFilter: dateFilter,
                  startDate: dateFilter === 'custom' ? startDate : '',
                  endDate: dateFilter === 'custom' ? endDate : '',
                  typeFilter: typeFilter,
                  operatorFilter: operatorFilter,
                  page: nextPage,
                  limit: pageSize
              }
          });
          if (res.result && res.result.success) {
              rawList = Array.isArray(res.result.list) ? res.result.list : [];
              total = Number(res.result.total) || rawList.length;
          } else {
              throw new Error((res.result && res.result.msg) || '加载日志失败');
          }

          if (this.data.requestId !== currentRequestId) {
            return;
          }

          // Sort in memory to handle mixed fields
          rawList = sortLogRecordsDescending(rawList);

          // Define Action Map
          const actionMap = {
             'inbound': { text: '入库', color: '#07c160', sign: '+' },
             'refill': { text: '补料', color: '#07c160', sign: '+' },
             'outbound': { text: '领用', color: '#ee0a24', sign: '-' },
             'adjust': { text: '纠错', color: '#1989fa', sign: '' },
             'width_adjust': { text: '修正幅宽', color: '#1989fa', sign: '' },
             'stocktake_adjust': { text: '盘点调整', color: '#1989fa', sign: '' },
             'inventory_correction': { text: '库存纠错', color: '#1989fa', sign: '' },
             'delete': { text: '删除物料', color: '#ee0a24', sign: '' },
             'transfer': { text: '移库', color: '#1989fa', sign: '' } // 实际移库类型
          };

          const mappedList = rawList.map(item => {
              // 1. Standardize type
              const type = item.type ? item.type.toLowerCase() : 'unknown';
              const action = item.action ? String(item.action).trim() : '';

              // 2. Get Config
              const config = actionMap[action] || actionMap[type] || { text: '未知操作', color: '#969799', sign: '' };

              let actionText = config.text;
              const actionColor = config.color;
              let sign = config.sign;

              // 3. Handle Quantity
              let qty = item.quantity_change;
              if (qty && typeof qty === 'object' && qty.val) {
                  qty = qty.val;
              }
              qty = Number(qty) || 0;
              if (type === 'adjust') {
                  sign = qty > 0 ? '+' : (qty < 0 ? '-' : '');
              }
              const absQty = Math.abs(qty); // Show absolute value in UI

              // 4. Fallback for Unit & Time
              const unit = item.unit || item.spec_change_unit || '-';

              const timeRaw = item.timestamp || item.create_time;
              const d = new Date(timeRaw);
              const timeStr = !isNaN(d.getTime())
                  ? `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                  : '--';

              // 5. Display Name Logic - 物料名称始终显示 material_name
              let displayName = item.material_name || '未命名';
              let displayCode = item.product_code || '';

              // 类型颜色映射（组件可识别的格式）
              let typeColor = 'success';
              if (type === 'outbound') typeColor = 'warning';
              else if (type === 'delete') typeColor = 'danger';
              else if (type === 'transfer' || type === 'adjust') typeColor = 'primary';

              return {
                  ...item,
                  // 同时提供两种字段名，确保组件兼容
                  _typeText: actionText,
                  _actionText: actionText,
                  _typeColor: typeColor,
                  _actionColor: actionColor,
                  _sign: sign,
                  _timeStr: timeStr,
                  _displayName: displayName,
                  _displayCode: displayCode,
                  quantity: absQty,
                  unit: unit,
                  operator: resolveOperatorDisplayName(item.operator || item.operator_name, item.operator_id || item._openid),
                  note: item.description || item.note || ''
              };
          });

          this.setData({
            logList: reset ? mappedList : this.data.logList.concat(mappedList),
            page: nextPage + 1,
            isEnd: nextPage * pageSize >= total
          });

      } catch (err) {
          if (this.data.requestId !== currentRequestId) {
            return;
          }
          console.error(err);
          wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      } finally {
          if (this.data.requestId === currentRequestId) {
            this.setData({ loading: false });
          }
          wx.stopPullDownRefresh();
      }
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

    // 获取申请数量和原因
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
      const {
        ensureOperationId,
        clearOperationId
      } = require('../../utils/operation-id');
      const operationScope = 'submitInventoryCorrectionRequest:logs';
      const operationPayload = {
        source_log_id: item._id,
        requested_quantity: requestedQuantity,
        reason: (reasonRes.confirm && reasonRes.content) || ''
      };
      const result = await wx.cloud.callFunction({
        name: 'submitInventoryCorrectionRequest',
        data: {
          ...operationPayload,
          operation_id: ensureOperationId(operationScope, operationPayload, 'corr')
        }
      });
      wx.hideLoading();
      if (result.result && result.result.success) {
        clearOperationId(operationScope);
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
