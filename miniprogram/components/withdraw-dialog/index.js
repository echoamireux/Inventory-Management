// components/withdraw-dialog/index.js
import Toast from '@vant/weapp/toast/toast';
const db = require('../../utils/db');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    // Item Object:
    // Must contain: product_code, material_name, category, batch_number, quantity.val/unit
    // Optional: unique_code (if scan mode), isExpiring
    item: {
      type: Object,
      value: null,
      observer: function(newVal) {
          if (newVal) {
              this.formatDisplay();
          }
      }
    },
    // 'scan' or 'batch'
    mode: {
      type: String,
      value: 'scan'
    },
    // For batch mode, passed in list of sibling items to find recommendation
    // Or we can just pass the "Recommended Code" string directly as a prop to keep it simple.
    // Let's expect the parent to pass `recommendedCode`.
    recommendedCode: {
        type: String,
        value: ''
    }
  },

  data: {
    withdrawAmount: '',

    // Usage related
    usageOptions: ['研发实验室', '设备调试', '客户打样', '其他损耗'],
    showUsagePicker: false,
    selectedUsage: '',
    usageDetail: '',

    displayStock: '0',
  },

  methods: {
    formatDisplay() {
        const item = this.data.item;
        if (!item) return;

        let displayStock = '0';

        // 修复: 批次模式下 quantity.val 已是批次总量，直接使用
        // 单件扫码模式下才需要区分化材和膜材的不同库存字段
        if (item.category === 'chemical') {
            displayStock = String(item.quantity?.val ?? 0);
        } else {
            // 膜材: 单件模式用 dynamic_attrs.current_length_m，批次模式用 quantity.val
            const dynamicLength = item.dynamic_attrs?.current_length_m;
            if (dynamicLength !== undefined && dynamicLength !== null) {
                displayStock = String(dynamicLength);
            } else {
                // 批次模式下 quantity.val 是总量
                displayStock = String(item.quantity?.val ?? 0);
            }
        }

        this.setData({
            displayStock,
            withdrawAmount: '',
            selectedUsage: '',
            usageDetail: ''
        });
    },

    onAmountInput(e) {
        let val = e.detail.value;
        // Strict guard against Object
        if (val && typeof val === 'object') {
            console.error('Input Value Is Object, correcting...', val);
            val = '';
        }
        this.setData({ withdrawAmount: val });
    },

    onClose() {
        this.triggerEvent('close');
    },

    onUsageClick() {
        this.setData({ showUsagePicker: true });
    },

    onUsageCancel() { this.setData({ showUsagePicker: false }); },
    onUsageConfirm(e) {
        const { value } = e.detail;
        this.setData({
            selectedUsage: value,
            showUsagePicker: false,
            usageDetail: ''
        });
    },
    onUsageDetailInput(e) { this.setData({ usageDetail: e.detail }); },

    async onConfirm() {
        const { withdrawAmount, selectedUsage, usageDetail, item, displayStock } = this.data;

        console.log('onConfirm click:', { withdrawAmount, selectedUsage, stock: displayStock });

        if (!withdrawAmount || Number(withdrawAmount) <= 0) {
            wx.showToast({ title: '请输入数量', icon: 'none' });
            return;
        }

        // Overdraft Check
        const stockNum = Number(displayStock);
        const withdrawNum = Number(withdrawAmount);
        if (!isNaN(stockNum) && withdrawNum > stockNum) {
             wx.showToast({ title: '数量超出库存', icon: 'none' });
             return;
        }

        if (!selectedUsage) {
            wx.showToast({ title: '请选择用途', icon: 'error' });
            return;
        }

        let finalNote = selectedUsage;
        if (selectedUsage === '其他损耗') {
            if (!usageDetail) {
                wx.showToast({ title: '请填写原因', icon: 'none' });
                return;
            }
            finalNote += `: ${usageDetail}`;
        }

        // Trigger parent event
        this.triggerEvent('confirm', {
            withdraw_amount: withdrawAmount,
            note: finalNote,
        });
    }
  }
});
