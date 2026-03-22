/**
 * batch-list-item 组件
 * 统一批次卡片，适用于批次选择弹窗和批次查询页
 *
 * @property {Object} item - 批次数据对象
 * @event itemtap - 点击事件，返回 item 数据
 */
Component({
  options: {
    addGlobalClass: true
  },
  data: {
    display: {
      batchLabel: '批号',
      batchValue: '',
      materialName: '',
      subcategoryLabel: '',
      labelCountLabel: '',
      locationSummary: '',
      expiryBadgeText: ''
    }
  },
  properties: {
    item: {
      type: Object,
      value: {},
      observer(item) {
        const { buildBatchCardState } = require('../../utils/inventory-display');
        this.setData({
          display: buildBatchCardState(item)
        });
      }
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('itemtap', { item: this.data.item });
    }
  }
});
