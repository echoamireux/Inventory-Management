// pages/stock-in-out/index.js
import Toast from '@vant/weapp/toast/toast';
const db = require('../../utils/db');

Page({
  data: {
    step: 1, // 1: 扫描/输入码, 2: 确认信息并操作
    mode: 'scan', // scan | manual
    inputCode: '',
    inventoryItem: null, // 查到的库存对象
    materialItem: null,  // 关联的物料对象

    // 操作表单
    actionType: 'outbound', // outbound | inbound
    changeValue: '',
    note: '',

    loading: false
  },

  onLoad: function (options) {},

  // 切换手动输入模式
  toggleMode() {
    this.setData({ mode: this.data.mode === 'scan' ? 'manual' : 'scan' });
  },

  // 扫码
  async onScan() {
    try {
      const res = await wx.scanCode();
      this.handleCode(res.result);
    } catch (err) {
      console.log('扫码取消或失败');
    }
  },

  // 手动查询
  onManualSearch() {
    if (!this.data.inputCode) return Toast.fail('请输入编码');
    this.handleCode(this.data.inputCode);
  },

  // 处理唯一码查询
  async handleCode(code) {
    Toast.loading({ message: '查询中...', forbidClick: true });
    try {
      // 1. 尝试在库存表查找 (是否存在)
      const invRes = await db.inventory.getList({ unique_code: code }, 1, 1);

      if (invRes && invRes.length > 0) {
        // 已存在库存 -> 进入操作模式 (出库/盘点/增补)
        this.setData({
          inventoryItem: invRes[0],
          step: 2,
          changeValue: ''
        });
      } else {
        // 不存在 -> 可能是新入库，或者是无效码
        // 这里简化逻辑：如果是新入库，应该先去 Materials 表选物料，然后生成 Inventory
        // 为了演示闭环：提示用户去“新增入库”功能 (暂未开发复杂的入库流程，这里仅演示针对已有库存的操作)
        Toast.fail('未找到该库存记录，请先进行入库登记');

        // 实际场景：如果未找到，可能是新货入库。应跳转到入库登记页，自动填入code。
      }
    } catch (err) {
      console.error(err);
      Toast.fail('查询失败');
    } finally {
      Toast.clear();
    }
  },

  // 提交出入库/变动
  async onSubmit() {
    const { actionType, changeValue, inventoryItem, note } = this.data;
    const val = Number(changeValue);

    if (!val || val <= 0) {
      return Toast.fail('请输入有效的变动数量');
    }

    const currentQty = inventoryItem.quantity.val;
    let newQty = currentQty;

    if (actionType === 'outbound') {
      if (val > currentQty) return Toast.fail('库存不足');
      newQty = currentQty - val;
    } else {
      newQty = currentQty + val;
    }

    this.setData({ loading: true });

    try {
      // 安全升级: 使用云函数进行操作，不再前端直写
      const app = getApp();
      const operator = app.globalData.user ? app.globalData.user.name : 'Unknown';

      const res = await wx.cloud.callFunction({
          name: 'updateInventory',
          data: {
              unique_code: inventoryItem.unique_code,
              quantity: val,
              type: actionType, // 'inbound' or 'outbound'
              note: note || (actionType === 'inbound' ? '快捷入库' : '快捷出库'),
              operator_name: operator
          }
      });

      if (res.result && res.result.success) {
          Toast.success('操作成功');
          // 重置
          setTimeout(() => {
              this.setData({ step: 1, inventoryItem: null, inputCode: '', changeValue: '', note: '' });
          }, 1500);
      } else {
          throw new Error(res.result.msg || '操作失败');
      }

    } catch (err) {
      console.error(err);
      Toast.fail('操作失败: ' + err.message);
    } finally {
      this.setData({ loading: false });
    }
  },

  onActionChange(e) {
    this.setData({ actionType: e.detail });
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail });
  },

  onBack() {
    this.setData({ step: 1, inventoryItem: null });
  }
});
