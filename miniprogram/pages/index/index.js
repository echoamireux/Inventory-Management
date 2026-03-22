// pages/index/index.js
import Dialog from "@vant/weapp/dialog/dialog";
import Toast from "@vant/weapp/toast/toast";
const db = require("../../utils/db");
const alertConfig = require("../../utils/alert-config");
const {
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState
} = require('../../utils/inventory-display');
const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('../../utils/label-code');

function resolveSearchValue(detail) {
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value;
  }
  return typeof detail === 'string' ? detail : '';
}

Page({
  data: {
    stats: {
      totalMaterials: 0,
      lowStock: 0,
      todayIn: 0,
      todayOut: 0,
    },

    // 领料弹窗
    showWithdrawDialog: false,
    withdrawItem: null,
    withdrawAmount: "",

    // 用途选择相关
    usageOptions: ["研发实验室", "设备调试", "客户打样", "其他损耗"],
    showUsagePicker: false,
    selectedUsage: "", // 当前选中的用途
    usageDetail: "", // “其他损耗”时的补充说明

    // 选择物料弹窗
    showSelectPopup: false,
    selectSearchVal: "",
    selectList: [],
    allMaterials: [], // 缓存
    selectActiveTab: "chemical", // Default Tab
    selectPage: 1,
    selectPageSize: 20,
    selectLoading: false,
    selectIsEnd: false,
    selectRequestId: 0,
    selectTotal: 0,

    // 批次选择弹窗
    showBatchPopup: false,
    batchList: [],
    selectedAggItem: null,

    isSmartBatchMode: false,
    recommendedCode: "",
    alertConfig: alertConfig,

    isAdmin: false,
    isUserReady: false, // Access Control
  },

  onLoad: function (options) {
    const app = getApp();

    // Check if user data is already ready
    if (app.globalData.user) {
      this.setData({ isUserReady: true });
      this.checkAdminStatus();
    } else {
      // Wait for callback
      app.userReadyCallback = (user) => {
        this.setData({ isUserReady: true });
        this.checkAdminStatus();
      };
    }

    // onLoad 不再直接调用 refreshStats，改由 onShow 统一管理，或者保留以防万一
    this.refreshStats();
  },

  checkAdminStatus() {
    const app = getApp();
    if (app.globalData.user) {
      const role = app.globalData.user.role;
      this.setData({
        isAdmin: role === "admin" || role === "super_admin",
        isSuperAdmin: role === "super_admin"
      });
    }
  },

  onShow: function () {
    // 每次显示页面时（包括从其他页面返回）自动刷新数据
    this.refreshStats();
  },

  onPullDownRefresh() {
    this.refreshStats();
  },

  onStatTotal() {
    wx.navigateTo({ url: "/pages/inventory/index" });
  },

  onStatWarning() {
    wx.setStorageSync("filterAction", "expiry");
    wx.navigateTo({ url: "/pages/inventory/index" });
  },

  onStatTodayIn() {
    wx.navigateTo({ url: "/pages/logs/index?filter=today_in" });
  },

  onStatTodayOut() {
    wx.navigateTo({ url: "/pages/logs/index?filter=today_out" });
  },

  onSearch(e) {
    const val = resolveSearchValue(e && e.detail);
    if (val) {
      wx.navigateTo({
        url: `/pages/inventory/index?search=${encodeURIComponent(val)}`,
      });
    }
  },

  onJumpToInventory() {
    wx.navigateTo({
      url: "/pages/inventory/index",
    });
  },

  // 刷新统计 (Cloud Function Version)
  async refreshStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: "getDashboardStats",
      });

      if (res.result && res.result.success) {
        this.setData({
          stats: {
            totalMaterials: res.result.totalMaterials,
            lowStock: res.result.lowStock,
            todayIn: res.result.todayIn,
            todayOut: res.result.todayOut,
          },
        });
      } else {
        console.error("Stats Fetch Failed:", res);
      }
    } catch (err) {
      console.error("Stats Cloud Error", err);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  // Modified to handle Batch Aggregated Selection
  onSelectBatchItem(e) {
    // 从 dataset.batch 获取批次聚合数据
    const batch = (e.detail && e.detail.item) || e.currentTarget.dataset.batch;
    if (!batch) return;

    this.setData({
      showBatchPopup: false,
      showSelectPopup: false,
    });

    this.handleBatchWithdraw(batch);
  },

  // 处理批次级领用
  async handleBatchWithdraw(batch) {
    const totalQty = batch.totalQuantity;
    const unit = batch.unit || 'kg';
    const selectedAggItem = this.data.selectedAggItem || {};
    const category = selectedAggItem.category || this.data.selectActiveTab;

    let currentStockDesc = `${totalQty} ${unit} (批次总计)`;
    let inputLabel = `领用量 (${unit})`;

    if (category === 'film') {
      currentStockDesc = `${totalQty} ${unit} (批次总计)`;
      inputLabel = "领用长度 (米)";
    }

    const recommendedCode = String(batch.recommendedCode || '').trim();

    this.setData({
        withdrawItem: {
        product_code: batch.product_code,
        material_name: batch.material_name,
        batch_number: batch.batch_number,
        category: category,
        currentStockDesc,
        inputLabel,
        quantity: { val: totalQty, unit },
        location: batch.location,
        unique_code: recommendedCode,
        isArchived: batch.isArchived || selectedAggItem.isArchived || false
      },
      withdrawAmount: "",
      selectedUsage: "",
      usageDetail: "",
      recommendedCode,
      showUsagePicker: false,
      showWithdrawDialog: true,
      isSmartBatchMode: true,
    });
  },

  // === 扫码领料核心逻辑 ===
  async onScanWithdraw() {
    this.setData({ isSmartBatchMode: false }); // Reset mode
    try {
      const res = await wx.scanCode();
      const code = res.result;
      this.handleScanResult(code);
    } catch (err) {
      console.log("扫码取消");
    }
  },

  // 用于手动输入测试
  async onManualInput() {
    this.setData({ isSmartBatchMode: false }); // Reset mode
    wx.showModal({
      title: "手动输入(测试用)",
      editable: true,
      placeholderText: "请输入标签编号",
      success: (res) => {
        if (res.confirm && res.content) {
          this.handleScanResult(res.content);
        }
      },
    });
  },

  async handleScanResult(code) {
    const normalizedLabelCode = normalizeLabelCodeInput(code);
    if (!isValidLabelCode(normalizedLabelCode)) {
      await Dialog.alert({
        title: "标签编号错误",
        message: "标签编号格式不正确，应为 L + 6位数字",
        messageAlign: "left"
      });
      return;
    }

    Toast.loading({ message: "查询中...", forbidClick: true });

    try {
      // 1. 查询库存
      const list = await db.inventory.getList({ unique_code: normalizedLabelCode }, 1, 1);
      Toast.clear();

      if (!list || list.length === 0) {
        // 分支 A: 标签不存在 -> 提示入库
        Dialog.confirm({
          title: "标签未录入",
          message: `标签 ${normalizedLabelCode} 尚未绑定物料，是否立即入库？`,
          confirmButtonText: "去入库",
          confirmButtonColor: "#2C68FF"
        }).then(() => {
            wx.navigateTo({ url: `/pages/material-add/index?id=${normalizedLabelCode}` });
        }).catch(() => {
            // Cancel
        });
        return;
      }

      const item = list[0];

      // 2. 查询主数据，统一库存显示真值
      let materialRecord = null;
      if (item.product_code) {
        try {
          const matRes = await wx.cloud.database().collection('materials')
            .where({ product_code: item.product_code })
            .field({
              _id: true,
              product_code: true,
              status: true,
              default_unit: true,
              package_type: true,
              specs: true,
              subcategory_key: true,
              sub_category: true,
              material_name: true
            })
            .limit(1)
            .get();
          if (matRes.data && matRes.data.length > 0) {
            materialRecord = matRes.data[0];
          }
        } catch (e) {
          console.warn('Material lookup failed', e);
        }
      }
      const mergedItem = mergeInventoryMaterialData(item, materialRecord || {});
      const quantityState = getInventoryQuantityDisplayState(mergedItem, materialRecord || {});
      const isArchived = !!(materialRecord && materialRecord.status === 'archived');

      // 3. 准备弹窗数据
      const currentStockDesc = mergedItem.category === 'film'
        ? `${quantityState.displayQuantity} ${quantityState.displayUnit} (基础长度 ${quantityState.baseLengthM} 米)`
        : `${quantityState.displayQuantity} ${quantityState.displayUnit}`;
      const inputLabel = mergedItem.category === 'film'
        ? '领用长度 (米)'
        : `领用重量 (${quantityState.displayUnit})`;

      this.setData({
        withdrawItem: { ...mergedItem, currentStockDesc, inputLabel, isArchived },
        withdrawAmount: "",
        selectedUsage: "", // Reset usage
        usageDetail: "", // Reset detail
        showUsagePicker: false,
        showWithdrawDialog: true,
        isSmartBatchMode: false, // Explicitly single item mode
      });
    } catch (err) {
      Toast.clear();
      console.error(err);
      Toast.fail("查询失败");
    }
  },

  onAmountInput(e) {
    this.setData({ withdrawAmount: e.detail });
  },

  // 用途选择处理
  onUsageClick() {
    this.setData({ showUsagePicker: true });
  },
  onUsageCancel() {
    this.setData({ showUsagePicker: false });
  },
  onUsageConfirm(e) {
    const { value } = e.detail;
    this.setData({
      selectedUsage: value,
      showUsagePicker: false,
      usageDetail: "", // Reset detail when changing type
    });
  },
  onUsageDetailInput(e) {
    this.setData({ usageDetail: e.detail });
  },

  onWithdrawClose() {
    this.setData({ showWithdrawDialog: false });
  },

  async onWithdrawConfirmFn(e) {
    const { withdraw_amount, note } = e.detail;
    const { withdrawItem, isSmartBatchMode } = this.data;

    this.setData({ showWithdrawDialog: false }); // 先关闭，后续用 Loading
    Toast.loading({ message: "处理中...", forbidClick: true });

    try {
      const app = getApp();
      const operator = app.globalData.user
        ? app.globalData.user.name
        : "Unknown";

      const payload = {
        withdraw_amount, // From event
        note, // From event
        operator_name: operator,
      };

      // Smart Mode vs Single Item Mode
      if (isSmartBatchMode) {
        payload.product_code = withdrawItem.product_code;
        payload.batch_no = withdrawItem.batch_number;
      } else {
        payload.unique_code = withdrawItem.unique_code;
      }

      const res = await wx.cloud.callFunction({
        name: "updateInventory",
        data: payload,
      });

      if (res.result && res.result.success) {
        getApp().globalData.inventoryChangedAt = Date.now();
        // 统一反馈格式
        const remaining = res.result.displayRemaining !== undefined
          ? res.result.displayRemaining
          : res.result.remaining;
        const unit = res.result.displayUnit || res.result.unit || '';
        if (remaining !== undefined) {
          Toast.success(`领用成功，剩余: ${remaining} ${unit}`);
        } else {
          Toast.success("领用成功");
        }
        this.refreshStats(); // 刷新数据
      } else {
        throw new Error(res.result.msg || "Error");
      }
    } catch (err) {
      console.error(err);
      Dialog.alert({ title: "领用失败", message: err.message });
    }
  },
  // === 选择物料弹窗逻辑 (Aggregated) ===
  async onShowMaterialSelect() {
    if (this.selectSearchTimer) {
      clearTimeout(this.selectSearchTimer);
    }
    this.setData(
      {
        showSelectPopup: true,
        selectSearchVal: "",
        selectList: [],
        selectPage: 1,
        selectIsEnd: false,
        selectLoading: false,
        selectTotal: 0,
        selectActiveTab: this.data.selectActiveTab || "chemical", // Default
      },
      () => {
        // Fix tab underline position
        setTimeout(() => {
          const tabs = this.selectComponent("#tabs");
          if (tabs) tabs.resize();
        }, 200);
      },
    );
    this.loadAggregatedMaterials(true);
  },

  onCloseSelectPopup() {
    if (this.selectSearchTimer) {
      clearTimeout(this.selectSearchTimer);
    }
    this.setData({ showSelectPopup: false });
  },

  onSelectTabChange(e) {
    if (this.selectSearchTimer) {
      clearTimeout(this.selectSearchTimer);
    }
    this.setData({
      selectActiveTab: e.detail.name,
      selectPage: 1,
      selectIsEnd: false
    });
    this.loadAggregatedMaterials(true);
  },

  async loadAggregatedMaterials(reset = true) {
    if (!reset && (this.data.selectLoading || this.data.selectIsEnd)) {
      return;
    }

    const currentRequestId = this.data.selectRequestId + 1;
    const nextPage = reset ? 1 : this.data.selectPage;
    this.setData({
      selectLoading: true,
      selectRequestId: currentRequestId
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "getInventoryGrouped",
        data: {
          searchVal: this.data.selectSearchVal,
          category: this.data.selectActiveTab,
          page: nextPage,
          pageSize: this.data.selectPageSize
        },
      });

      if (res.result.success) {
        if (this.data.selectRequestId !== currentRequestId) {
          return;
        }
        const result = res.result || {};
        const newList = result.list || [];
        const mergedList = reset ? newList : this.data.selectList.concat(newList);
        this.setData({
          allMaterials: mergedList,
          selectList: mergedList,
          selectPage: nextPage + 1,
          selectPageSize: Number(result.pageSize) || this.data.selectPageSize,
          selectTotal: Number(result.total) || mergedList.length,
          selectIsEnd: Boolean(result.isEnd)
        });
      }
    } catch (err) {
      if (this.data.selectRequestId !== currentRequestId) {
        return;
      }
      console.error(err);
      Toast.fail("加载失败");
    } finally {
      if (this.data.selectRequestId === currentRequestId) {
        this.setData({ selectLoading: false });
      }
    }
  },

  onSelectSearch(e) {
    const val = resolveSearchValue(e && e.detail);
    if (this.selectSearchTimer) clearTimeout(this.selectSearchTimer);
    this.setData({
      selectSearchVal: val,
      selectPage: 1,
      selectIsEnd: false
    });
    this.loadAggregatedMaterials(true);
  },

  onSelectSearchChange(e) {
    const val = resolveSearchValue(e && e.detail);
    this.setData({
      selectSearchVal: val,
      selectPage: 1,
      selectIsEnd: false
    });

    if (this.selectSearchTimer) clearTimeout(this.selectSearchTimer);
    this.selectSearchTimer = setTimeout(() => {
      this.loadAggregatedMaterials(true);
    }, 500);
  },

  onSelectSearchClear() {
    if (this.selectSearchTimer) {
      clearTimeout(this.selectSearchTimer);
    }
    this.setData({
      selectSearchVal: "",
      selectPage: 1,
      selectIsEnd: false
    });
    this.loadAggregatedMaterials(true);
  },

  onSelectPopupReachBottom() {
    if (this.data.selectLoading || this.data.selectIsEnd) {
      return;
    }
    this.loadAggregatedMaterials(false);
  },

  // === 批次选择逻辑 ===
  async onSelectAggregatedItem(e) {
    // 支持两种模式：1. dataset.item  2. 组件返回的 e.detail.item
    const item = (e.detail && e.detail.item) || e.currentTarget.dataset.item;
    this.setData({ selectedAggItem: item });

    wx.showLoading({ title: "加载批次..." });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getInventoryBatches',
        data: {
          productCode: item.product_code,
          materialName: item.material_name,
          category: item.category || this.data.selectActiveTab,
          page: 1,
          pageSize: 200
        }
      });

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载批次失败');
      }

      const batches = (res.result.list || []).map(batch => ({
        ...batch,
        sub_category: batch.sub_category || item.sub_category || '',
        subcategory_key: batch.subcategory_key || item.subcategory_key || '',
        isArchived: batch.isArchived || item.isArchived || false
      }));

      this.setData({
        batchList: batches,
        showBatchPopup: true,
      });
    } catch (err) {
      console.error(err);
      Toast.fail("加载批次失败");
    } finally {
      wx.hideLoading();
    }
  },
  onUnload() {
    if (this.selectSearchTimer) {
      clearTimeout(this.selectSearchTimer);
    }
  },

  onCloseBatchPopup() {
    this.setData({ showBatchPopup: false });
  },
});
