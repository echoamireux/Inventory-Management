// pages/admin-logs/index.js
const INVENTORY_LOG_SEARCH_FIELDS = [
  'material_name',
  'product_code',
  'supplier_model',
  'supplier_model_key',
  'unique_code',
  'batch_number',
  'operator',
  'operator_name',
  'type',
  'project_code',
  'project_name',
  'withdraw_note',
  'description',
  'note'
];
const AUDIT_LOG_SEARCH_FIELDS = [
  'domain',
  'action',
  'actor_id',
  'actor_name',
  'target_type',
  'target_id',
  'target_label',
  'operation_id',
  'search_text'
];

const INVENTORY_TYPE_OPTIONS = [
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
];

const AUDIT_ACTION_OPTIONS = [
  { text: '全部动作', value: 'all' },
  { text: '入库', value: 'inbound' },
  { text: '补料', value: 'refill' },
  { text: '领用', value: 'outbound' },
  { text: '纠错', value: 'adjust' },
  { text: '移库', value: 'transfer' },
  { text: '修正幅宽', value: 'width_adjust' },
  { text: '盘点调整', value: 'stocktake_adjust' },
  { text: '库存纠错', value: 'inventory_correction' },
  { text: '创建', value: 'create' },
  { text: '更新', value: 'update' },
  { text: '启用/停用', value: 'status' },
  { text: '审批', value: 'approve' },
  { text: '驳回', value: 'reject' },
  { text: '导出', value: 'export' },
  { text: '导出失败', value: 'export_failed' },
  { text: '归档', value: 'archive' },
  { text: '恢复', value: 'restore' },
  { text: '批量创建', value: 'batch_create' },
  { text: '批量归档', value: 'batch_archive' },
  { text: '批量删除', value: 'batch_delete' },
  { text: '作废', value: 'void' }
];

const AUDIT_DOMAIN_OPTIONS = [
  { text: '全部领域', value: 'all' },
  { text: '库存', value: 'inventory' },
  { text: '预打印', value: 'preprint' },
  { text: '物料主数据', value: 'material' },
  { text: '测试料型号', value: 'test_material_identity' },
  { text: '物料审批', value: 'material_request' },
  { text: '库存纠错', value: 'inventory_correction' },
  { text: '人员权限', value: 'user' },
  { text: '产品代码前缀', value: 'product_prefix' },
  { text: '项目编码', value: 'project_code' },
  { text: '子类别', value: 'subcategory' },
  { text: '库区坐标', value: 'warehouse' }
];

const ACTION_META = {
  inbound: { text: '入库', color: 'success' },
  refill: { text: '补料', color: 'success' },
  outbound: { text: '领用', color: 'warning' },
  adjust: { text: '纠错', color: 'primary' },
  transfer: { text: '移库', color: 'primary' },
  delete: { text: '删除', color: 'danger' },
  width_adjust: { text: '修正幅宽', color: 'primary' },
  stocktake_adjust: { text: '盘点调整', color: 'primary' },
  inventory_correction: { text: '库存纠错', color: 'primary' },
  create: { text: '创建', color: 'success' },
  update: { text: '更新', color: 'primary' },
  status: { text: '启停', color: 'warning' },
  approve: { text: '通过', color: 'success' },
  reject: { text: '驳回', color: 'danger' },
  export: { text: '导出', color: 'primary' },
  export_failed: { text: '失败', color: 'danger' },
  archive: { text: '归档', color: 'warning' },
  restore: { text: '恢复', color: 'success' },
  batch_create: { text: '批量创建', color: 'success' },
  batch_archive: { text: '批量归档', color: 'warning' },
  batch_delete: { text: '批量删除', color: 'danger' },
  void: { text: '作废', color: 'warning' }
};

const DOMAIN_TEXT = AUDIT_DOMAIN_OPTIONS.reduce((map, item) => {
  if (item.value !== 'all') {
    map[item.value] = item.text;
  }
  return map;
}, {});

Object.assign(DOMAIN_TEXT, {
  test_material_identity: '测试料型号',
  product_code_prefix: '产品代码前缀',
  product_prefix: '产品代码前缀',
  material_request: '物料审批',
  inventory_correction: '库存纠错',
  inventory_correction_request: '库存纠错',
  approval: '审批',
  system: '系统'
});

const TARGET_TYPE_TEXT = {
  material: '物料主数据',
  test_material_identity: '测试料型号',
  inventory: '库存记录',
  preprint_job: '预打印任务',
  product_prefix: '产品代码前缀',
  product_code_prefix: '产品代码前缀',
  project_code: '项目编码',
  subcategory: '子类别',
  warehouse: '库区坐标',
  warehouse_zone: '库区坐标',
  user: '用户',
  material_request: '物料审批',
  inventory_correction_request: '库存纠错'
};

const AUDIT_SOURCE_TEXT = {
  material_import: '物料主数据导入',
  template_import: '模板导入',
  manual: '手动维护',
  page: '页面操作'
};

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
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

function resolveActionMeta(action) {
  const normalized = normalizeText(action);
  if (ACTION_META[normalized]) {
    return ACTION_META[normalized];
  }
  return { text: '操作', color: 'primary' };
}

function resolveDomainText(domain) {
  const normalized = normalizeText(domain);
  return DOMAIN_TEXT[normalized] || (normalized ? '管理审计' : '管理审计');
}

function resolveTargetTypeText(targetType, fallbackDomainText = '') {
  const normalized = normalizeText(targetType);
  return TARGET_TYPE_TEXT[normalized] || fallbackDomainText || '审计对象';
}

function resolveAuditDetailText(item = {}, domainText = '', targetTypeText = '') {
  const detail = item.detail || {};
  const sourceText = AUDIT_SOURCE_TEXT[normalizeText(detail.source)];
  if (sourceText) {
    return `来源：${sourceText}`;
  }

  const note = normalizeText(detail.note);
  if (note) {
    const noteAction = ACTION_META[note];
    const noteDomain = DOMAIN_TEXT[note] || TARGET_TYPE_TEXT[note] || AUDIT_SOURCE_TEXT[note];
    return noteAction ? `操作：${noteAction.text}` : (noteDomain || note);
  }

  const operationId = normalizeText(item.operation_id);
  if (operationId) {
    return `操作号：${operationId}`;
  }

  return `对象：${targetTypeText || domainText || '审计对象'}`;
}

const DATE_FILTER_VALUES = ['all', 'today', 'week', 'month', 'custom'];

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

function normalizeDateFilter(value) {
  const normalized = String(value || '').trim();
  return DATE_FILTER_VALUES.includes(normalized) ? normalized : 'all';
}

Page({
  data: {
    activeTab: 'inventory',
    list: [],
    searchVal: '',
    searchPlaceholder: '库存流水：产品代码/物料名/原厂型号等',
    page: 1,
    pageSize: 20,
    loading: false,
    isEnd: false,
    requestId: 0,
    searchScopeFields: INVENTORY_LOG_SEARCH_FIELDS,

    // 筛选器
    dateFilter: 'all',
    startDate: '',
    endDate: '',
    dateRangeText: '',
    showDateCalendar: false,
    minDate: new Date(2020, 0, 1).getTime(),
    maxDate: getTodayTimestamp(),
    calendarDefaultDate: buildCalendarDefaultDate('', ''),
    domainFilter: 'all',
    typeFilter: 'all',
    operatorFilter: 'all',

    dateOptions: [
      { text: '全部时间', value: 'all' },
      { text: '今日', value: 'today' },
      { text: '本周', value: 'week' },
      { text: '本月', value: 'month' },
      { text: '自定义', value: 'custom' }
    ],
    domainOptions: AUDIT_DOMAIN_OPTIONS,
    typeOptions: INVENTORY_TYPE_OPTIONS,
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

  onTabChange(e) {
    const activeTab = (e && e.detail && e.detail.name) || 'inventory';
    this.setData({
      activeTab,
      list: [],
      page: 1,
      isEnd: false,
      domainFilter: 'all',
      typeFilter: 'all',
      operatorFilter: 'all',
      searchScopeFields: activeTab === 'audit' ? AUDIT_LOG_SEARCH_FIELDS : INVENTORY_LOG_SEARCH_FIELDS,
      searchPlaceholder: activeTab === 'audit'
        ? '审计：领域/动作/操作人/对象/操作号'
        : '库存流水：产品代码/物料名/原厂型号等',
      typeOptions: activeTab === 'audit' ? AUDIT_ACTION_OPTIONS : INVENTORY_TYPE_OPTIONS,
      operatorOptions: [{ text: '全部操作人', value: 'all' }]
    }, () => {
      this.loadOperators();
      this.getList(true);
    });
  },

  // 加载操作人列表
  async loadOperators() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOperators',
        data: {
          logScope: this.data.activeTab
        }
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
    const nextFilter = normalizeDateFilter(e.detail);
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
    this.getList(true);
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
    this.getList(true);
  },

  onDomainFilterChange(e) {
    this.setData({ domainFilter: e.detail, page: 1, isEnd: false });
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
      const nextPage = reset ? 1 : this.data.page;
      const {
        searchVal,
        dateFilter,
        startDate,
        endDate,
        domainFilter,
        typeFilter,
        operatorFilter,
        pageSize,
        activeTab
      } = this.data;

      const res = await wx.cloud.callFunction({
        name: 'getLogs',
        data: {
          logScope: activeTab,
          adminOnly: activeTab === 'audit',
          searchVal,
          dateFilter,
          startDate: dateFilter === 'custom' ? startDate : '',
          endDate: dateFilter === 'custom' ? endDate : '',
          domainFilter,
          typeFilter,
          operatorFilter,
          page: nextPage,
          limit: pageSize
        }
      });
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载审计日志失败');
      }
      const total = Number(res.result.total) || 0;
      const pageList = res.result.list || [];

      if (this.data.requestId !== currentRequestId) {
        return;
      }

      const formatted = pageList.map(item => {
        if (activeTab === 'audit') {
          return this.formatAuditLogItem(item);
        }
        let typeText = '操作';
        let typeColor = 'primary';

        const normalizedType = String(item.type || '').toLowerCase();
        switch(normalizedType) {
          case 'inbound': typeText = '入库'; typeColor = 'success'; break;
          case 'refill': typeText = '补料'; typeColor = 'success'; break;
          case 'outbound': typeText = '领用'; typeColor = 'warning'; break;
          case 'adjust': typeText = '纠错'; typeColor = 'primary'; break;
          case 'transfer': typeText = '移库'; typeColor = 'primary'; break;
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
        const actionMeta = item.action ? resolveActionMeta(item.action) : null;
        if (actionMeta && actionMeta.text !== '操作') {
          typeText = actionMeta.text;
          typeColor = actionMeta.color;
        }

        if (normalizedType === 'inbound') sign = '+';
        else if (normalizedType === 'outbound') sign = '-';
        else if (normalizedType === 'refill') sign = '+';
        else if (normalizedType === 'adjust') sign = qty > 0 ? '+' : (qty < 0 ? '-' : '');

        return {
          ...item,
          _typeText: typeText,
          _typeColor: typeColor,
          _timeStr: timeStr,
          _displayCode: displayCode,
          _displayName: displayName,
          _sign: sign,
          quantity: Math.abs(qty),
          unit: item.spec_change_unit || item.unit || '',
          operator: resolveOperatorDisplayName(item.operator || item.operator_name, item.operator_id || item._openid)
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
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  formatAuditLogItem(item = {}) {
    const actionMeta = resolveActionMeta(item.action);
    let timeStr = '';
    if (item.timestamp) {
      const d = new Date(item.timestamp);
      if (!isNaN(d.getTime())) {
        timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
    }
    const domainText = resolveDomainText(item.domain);
    const detail = item.detail || {};
    const after = item.after || {};
    const targetTypeText = resolveTargetTypeText(item.target_type, domainText);
    const rawTargetLabel = item.target_label || item.target_id || item.operation_id || '';
    const targetLabel = looksLikeInternalId(rawTargetLabel) ? '' : rawTargetLabel;
    const subjectText = normalizeText(
      detail.label_material_name
      || detail.material_name
      || after.label_material_name
      || after.material_name
      || detail.project_name
      || detail.project_code
      || detail.product_code
      || after.product_code
      || targetTypeText
    );
    const displayName = [
      domainText,
      subjectText && subjectText !== domainText ? subjectText : ''
    ].filter(Boolean).join(' / ');

    return {
      ...item,
      type: `audit_${item.action || 'operate'}`,
      operator: resolveOperatorDisplayName(item.actor_name, item.actor_id),
      _typeText: actionMeta.text,
      _typeColor: actionMeta.color,
      _timeStr: timeStr,
      _displayCode: targetLabel || domainText,
      _displayName: displayName || '管理审计',
      _sign: '',
      _hideQuantity: true,
      quantity: '',
      unit: '',
      note: resolveAuditDetailText(item, domainText, targetTypeText)
    };
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
      const {
        ensureOperationId,
        clearOperationId
      } = require('../../utils/operation-id');
      const operationScope = 'submitInventoryCorrectionRequest:admin-logs';
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
