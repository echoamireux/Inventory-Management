// pages/admin-logs/index.js
const INVENTORY_LOG_SEARCH_FIELDS = [
  'material_name',
  'product_code',
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
  { text: '移库', value: 'transfer' }
];

const AUDIT_ACTION_OPTIONS = [
  { text: '全部动作', value: 'all' },
  { text: '入库', value: 'inbound' },
  { text: '补料', value: 'refill' },
  { text: '领用', value: 'outbound' },
  { text: '纠错', value: 'adjust' },
  { text: '移库', value: 'transfer' },
  { text: '创建', value: 'create' },
  { text: '更新', value: 'update' },
  { text: '启用/停用', value: 'status' },
  { text: '审批', value: 'approve' },
  { text: '驳回', value: 'reject' },
  { text: '导出', value: 'export' },
  { text: '导出失败', value: 'export_failed' },
  { text: '作废', value: 'void' }
];

const AUDIT_DOMAIN_OPTIONS = [
  { text: '全部领域', value: 'all' },
  { text: '库存', value: 'inventory' },
  { text: '预打印', value: 'preprint' },
  { text: '物料主数据', value: 'material' },
  { text: '物料审批', value: 'material_request' },
  { text: '人员权限', value: 'user' },
  { text: '产品前缀', value: 'product_prefix' },
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
  create: { text: '创建', color: 'success' },
  update: { text: '更新', color: 'primary' },
  status: { text: '启停', color: 'warning' },
  approve: { text: '通过', color: 'success' },
  reject: { text: '驳回', color: 'danger' },
  export: { text: '导出', color: 'primary' },
  export_failed: { text: '失败', color: 'danger' },
  void: { text: '作废', color: 'warning' }
};

const DOMAIN_TEXT = AUDIT_DOMAIN_OPTIONS.reduce((map, item) => {
  if (item.value !== 'all') {
    map[item.value] = item.text;
  }
  return map;
}, {});

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

Page({
  data: {
    activeTab: 'inventory',
    list: [],
    searchVal: '',
    searchPlaceholder: '产品代码/物料名称/项目编码/标签编号/批号/操作人/备注',
    page: 1,
    pageSize: 20,
    loading: false,
    isEnd: false,
    requestId: 0,
    searchScopeFields: INVENTORY_LOG_SEARCH_FIELDS,

    // 筛选器
    dateFilter: 'all',
    domainFilter: 'all',
    typeFilter: 'all',
    operatorFilter: 'all',

    dateOptions: [
      { text: '全部时间', value: 'all' },
      { text: '今日', value: 'today' },
      { text: '本周', value: 'week' },
      { text: '本月', value: 'month' }
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
        ? '领域/动作/操作人/目标对象/操作编号/关键说明'
        : '产品代码/物料名称/项目编码/标签编号/批号/操作人/备注',
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
    this.setData({ dateFilter: e.detail, page: 1, isEnd: false });
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
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
      wx.stopPullDownRefresh();
    }
  },

  formatAuditLogItem(item = {}) {
    const actionMeta = ACTION_META[item.action] || { text: item.action || '操作', color: 'primary' };
    let timeStr = '';
    if (item.timestamp) {
      const d = new Date(item.timestamp);
      if (!isNaN(d.getTime())) {
        timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
    }
    const domainText = DOMAIN_TEXT[item.domain] || item.domain || '管理审计';
    const detail = item.detail || {};
    const targetLabel = item.target_label || item.target_id || item.operation_id || '';
    const displayName = [
      domainText,
      detail.material_name || detail.project_code || detail.product_code || detail.note || ''
    ].filter(Boolean).join(' / ');

    return {
      ...item,
      type: `audit_${item.action || 'operate'}`,
      operator: item.actor_name || item.actor_id || '未知',
      _typeText: actionMeta.text,
      _typeColor: actionMeta.color,
      _timeStr: timeStr,
      _displayCode: targetLabel,
      _displayName: displayName || '管理审计',
      _sign: '',
      quantity: 0,
      unit: '',
      note: detail.note || item.operation_id || item.target_type || '无备注'
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
