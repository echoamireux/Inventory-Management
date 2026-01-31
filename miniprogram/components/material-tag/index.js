/**
 * material-tag 组件
 * 统一标签组件，支持多种类型
 *
 * @property {String} type - 标签类型: brand(蓝), warning(橙), success(绿), gray(灰)
 * @property {String} text - 标签文字
 */
Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    type: {
      type: String,
      value: 'brand' // 默认蓝色
    },
    text: {
      type: String,
      value: ''
    }
  }
});
