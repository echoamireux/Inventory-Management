// components/item-card/index.js
Component({
  properties: {
    // 物料数据对象
    item: {
      type: Object,
      value: {}
    },
    // 是否显示标签（批次数、临期等）
    showTags: {
      type: Boolean,
      value: true
    },
    // 自定义 hover 样式类
    hoverClass: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { item: this.data.item });
    }
  }
});
