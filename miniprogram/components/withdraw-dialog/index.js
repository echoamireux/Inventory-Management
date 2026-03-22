// components/withdraw-dialog/index.js
const { getInventoryQuantityDisplayState } = require('../../utils/inventory-display');

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
    displayStockUnit: '',
    inputUnitLabel: '',
    availableInputStock: 0,
  },

  methods: {
    formatDisplay() {
        const item = this.data.item;
        if (!item) return;

        const quantity = item.quantity || {};
        let displayStock = '0';
        let displayStockUnit = quantity.unit || 'kg';
        let inputUnitLabel = item.category === 'film' ? 'm' : (quantity.unit || 'kg');
        let availableInputStock = 0;

        if (this.data.mode === 'batch' && item.totalQuantity !== undefined) {
            displayStock = String(Number(item.totalQuantity) || 0);
            displayStockUnit = item.unit || quantity.unit || (item.category === 'film' ? 'm' : 'kg');
            availableInputStock = Number(item.totalBaseLengthM) || Number(item.totalQuantity) || 0;
        } else {
            const quantityState = getInventoryQuantityDisplayState(item, item);
            displayStock = String(quantityState.displayQuantity);
            displayStockUnit = quantityState.displayUnit || quantity.unit || 'kg';
            availableInputStock = item.category === 'film'
              ? Number(quantityState.baseLengthM) || 0
              : Number(quantityState.availableInputStock) || 0;
        }

        this.setData({
            displayStock,
            displayStockUnit,
            inputUnitLabel,
            availableInputStock,
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
        const { withdrawAmount, selectedUsage, usageDetail, availableInputStock } = this.data;

        if (!withdrawAmount || Number(withdrawAmount) <= 0) {
            wx.showToast({ title: '请输入数量', icon: 'none' });
            return;
        }

        // Overdraft Check
        const stockNum = Number(availableInputStock);
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
