// pages/admin-logs/index.js
import Dialog from '@vant/weapp/dialog/dialog';
import Toast from '@vant/weapp/toast/toast';
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
      { text: '移库', value: 'transfer' },
      { text: '删除', value: 'delete' }
    ],
    operatorOptions: [
      { text: '全部操作人', value: 'all' }
    ],
    // 多选模式
    isSelectMode: false,
    selectedIds: [],
    // ActionSheet 状态
    showActionSheet: false,
    actionSheetActions: [
      { name: '删除此条日志', color: '#ee0a24' },
      { name: '进入多选模式' }
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

  // 长按事件
  onLongPressItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({
      showActionSheet: true,
      currentLogId: id
    });
  },

  onActionSheetClose() {
    this.setData({ showActionSheet: false });
  },

  onActionSheetSelect(e) {
    const { name } = e.detail;
    if (name === '删除此条日志') {
      this.confirmDeleteLog();
    } else if (name === '进入多选模式') {
      // 进入多选模式，并预选当前项
      const currentId = this.data.currentLogId;
      const list = this.data.list.map(item => ({
        ...item,
        _selected: item._id === currentId
      }));
      this.setData({
        showActionSheet: false,
        isSelectMode: true,
        selectedIds: [currentId],
        list
      });
    }
  },

  confirmDeleteLog() {
    const id = this.data.currentLogId;
    if (!id) return;

    Dialog.confirm({
      title: '确认删除',
      message: '确定要删除这条日志吗？这可能会影响审计溯源。',
      confirmButtonColor: '#ee0a24'
    }).then(async () => {
      // 用户点击确认
      Toast.loading({ message: '删除中...', forbidClick: true });
      try {
        const callRes = await wx.cloud.callFunction({
          name: 'removeLog',
          data: { log_id: id }
        });
        if (callRes.result.success) {
          Toast.success('已删除');
          this.setData({ showActionSheet: false });
          this.getList(true);
        } else {
          throw new Error(callRes.result.msg);
        }
      } catch (err) {
        Toast.fail('删除失败: ' + err.message);
      }
    }).catch(() => {
      // 用户点击取消
    });
  },

  // === 多选模式 ===
  exitSelectMode() {
    const list = this.data.list.map(item => ({
      ...item,
      _selected: false
    }));
    this.setData({
      isSelectMode: false,
      selectedIds: [],
      list
    });
  },

  // 更新选中状态到 list
  updateSelectionState(selectedIds) {
    const list = this.data.list.map(item => ({
      ...item,
      _selected: selectedIds.indexOf(item._id) !== -1
    }));
    this.setData({ selectedIds, list });
  },

  onSelectItem(e) {
    const id = e.currentTarget.dataset.id;
    let { selectedIds } = this.data;

    if (selectedIds.indexOf(id) !== -1) {
      selectedIds = selectedIds.filter(i => i !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }

    this.updateSelectionState(selectedIds);
  },

  onSelectAll() {
    const { list, selectedIds } = this.data;
    const allIds = list.map(item => item._id);

    if (selectedIds.length === allIds.length) {
      this.updateSelectionState([]);
    } else {
      this.updateSelectionState(allIds);
    }
  },

  async onBatchDelete() {
    const { selectedIds } = this.data;
    if (selectedIds.length === 0) {
      Toast.fail('请先选择日志');
      return;
    }

    Dialog.confirm({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedIds.length} 条日志吗？\n此操作不可撤销。`,
      confirmButtonColor: '#ee0a24'
    }).then(async () => {
      Toast.loading({ message: '删除中...', forbidClick: true });

      try {
        // 批量删除优化：一次调用删除所有选中项
        const res = await wx.cloud.callFunction({
          name: 'batchRemoveLog',
          data: { log_ids: selectedIds }
        });

        if (res.result.success) {
          Toast.success(`已删除 ${selectedIds.length} 条`);
          this.exitSelectMode();
          this.getList(true);
        } else {
          throw new Error(res.result.msg || '删除失败');
        }
      } catch (err) {
        console.error(err);
        Toast.fail('删除失败: ' + (err.message || '未知错误'));
      }
    }).catch(() => {});
  }
});
