// components/popup-header/index.js
Component({
  properties: {
    // 标题文本
    title: {
      type: String,
      value: ''
    }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    }
  }
});
