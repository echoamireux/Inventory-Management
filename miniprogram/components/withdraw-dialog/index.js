// components/withdraw-dialog/index.js
const { getInventoryQuantityDisplayState } = require('../../utils/inventory-display');
const {
  listProjectCodes,
  buildProjectCodePickerColumns
} = require('../../utils/project-code-service');

const PROJECT_CODE_CLOUD_FUNCTION = 'manageProjectCode';

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
    // 'scan' or 'batch' or 'product'
    mode: {
      type: String,
      value: 'scan',
      observer: function() {
        if (this.data.item) {
          this.formatDisplay();
        }
      }
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

    projectOptions: [],
    showProjectPicker: false,
    selectedProject: null,
    withdrawNote: '',
    projectLoading: false,

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
        let inputUnitLabel = item.category === 'film' ? 'm' : (item.unit || quantity.unit || 'kg');
        let availableInputStock = 0;

        if ((this.data.mode === 'batch' || this.data.mode === 'product') && item.totalQuantity !== undefined) {
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
            selectedProject: null,
            withdrawNote: ''
        });
        this.loadProjectCodes();
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

    async loadProjectCodes() {
        if (this.data.projectLoading) return;
        this.setData({ projectLoading: true });
        try {
            const records = await listProjectCodes(false);
            this.setData({
                projectOptions: buildProjectCodePickerColumns(records)
            });
        } catch (err) {
            console.error('Load project codes failed', err);
            wx.showToast({ title: err.message || '项目编码加载失败', icon: 'none' });
        } finally {
            this.setData({ projectLoading: false });
        }
    },

    onProjectClick() {
        if (!this.data.projectOptions.length) {
            this.loadProjectCodes();
        }
        this.setData({ showProjectPicker: true });
    },

    onProjectCancel() { this.setData({ showProjectPicker: false }); },
    onProjectConfirm(e) {
        const { value } = e.detail;
        this.setData({
            selectedProject: value,
            showProjectPicker: false
        });
    },
    onWithdrawNoteInput(e) { this.setData({ withdrawNote: e.detail }); },

    async onConfirm() {
        const { withdrawAmount, selectedProject, withdrawNote, availableInputStock } = this.data;

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

        if (!selectedProject || !selectedProject.project_code) {
            wx.showToast({ title: '请选择项目编码', icon: 'none' });
            return;
        }

        // Trigger parent event
        this.triggerEvent('confirm', {
            withdraw_amount: withdrawAmount,
            project_code: selectedProject.project_code,
            project_name: selectedProject.project_name || '',
            withdraw_note: String(withdrawNote || '').trim()
        });
    }
  }
});
