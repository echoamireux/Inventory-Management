// 统一日志卡片组件
Component({
  properties: {
    item: {
      type: Object,
      value: {}
    },
    mode: {
      type: String,
      value: 'full' // compact | full
    }
  },

  observers: {
    'item': function(item) {
      // 根据类型设置颜色类
      const type = item._typeColor || item._actionColor || item.typeColor || 'success';
      let colorClass = 'tag-success';

      if (type === 'warning' || type === '#fa8c16') {
        colorClass = 'tag-warning';
      } else if (type === 'danger' || type === '#ee0a24') {
        colorClass = 'tag-danger';
      } else if (type === 'primary' || type === '#1989fa') {
        colorClass = 'tag-primary';
      } else if (type === 'success' || type === '#07c160') {
        colorClass = 'tag-success';
      }

      this.setData({ typeColorClass: colorClass });
    }
  },

  data: {
    typeColorClass: 'tag-success'
  },

  methods: {
    onLongPress() {
      this.triggerEvent('longpress', { item: this.data.item });
    }
  }
});
