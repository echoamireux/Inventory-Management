/**
 * material-list-item 组件
 * 统一物料列表项，适用于弹窗、列表页、详情页
 *
 * @property {Object} item - 物料数据对象
 * @property {Boolean} showCategory - 是否显示分类标签
 * @property {Boolean} showArrow - 是否显示右侧箭头
 *
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
    },
    showCategory: {
      type: Boolean,
      value: false
    },
    showArrow: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { item: this.data.item });
    }
  }
});
