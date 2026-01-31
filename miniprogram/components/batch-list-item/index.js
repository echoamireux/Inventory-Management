/**
 * batch-list-item 组件
 * 统一批次卡片，适用于批次选择弹窗和库存详情页
 *
 * @property {Object} item - 批次数据对象
 * @event tap - 点击事件，返回 item 数据
 */
Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    item: {
      type: Object,
      value: {}
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { item: this.data.item });
    }
  }
});
