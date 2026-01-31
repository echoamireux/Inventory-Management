// pages/index/index.js
import Dialog from "@vant/weapp/dialog/dialog";
import Toast from "@vant/weapp/toast/toast";
const db = require("../../utils/db");

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

    // 批次选择弹窗
    showBatchPopup: false,
    batchList: [],
    selectedAggItem: null,

    // Smart Suggestion
    isSmartBatchMode: false,
    recommendedCode: "",

    isAdmin: false,
  },

  onLoad: function (options) {
    const app = getApp();

    // Check if user data is already ready
    if (app.globalData.user) {
      this.checkAdminStatus();
    } else {
      // Wait for callback
      app.userReadyCallback = (user) => {
        this.checkAdminStatus();
      };
    }

    // onLoad 不再直接调用 refreshStats，改由 onShow 统一管理，或者保留以防万一
    this.refreshStats();
  },

  checkAdminStatus() {
    const app = getApp();
    if (app.globalData.user && app.globalData.user.role === "admin") {
      this.setData({ isAdmin: true });
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
    const val = e.detail;
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

  // Modified to handle Smart Batch Selection
  onSelectBatchItem(e) {
    const code = e.currentTarget.dataset.code;
    // Find the clicked item to get Batch No
    const item = this.data.batchList.find((b) => b.unique_code === code);
    if (!item) return;

    const selectedBatchNo = item.batch_number;

    // Filter all items with this batch number in the current list
    const batchItems = this.data.batchList.filter(
      (b) => b.batch_number === selectedBatchNo,
    );

    // Calculate Total Aggregated Stock for this Batch
    let totalQty = 0;
    let isFilm = item.category === "film";

    batchItems.forEach((b) => {
      if (isFilm) {
        totalQty += (b.dynamic_attrs && b.dynamic_attrs.current_length_m) || 0;
      } else {
        totalQty += b.quantity.val;
      }
    });

    this.setData({
      showBatchPopup: false,
      showSelectPopup: false,
    });

    this.handleSmartBatchResult(item, totalQty, batchItems);
  },

  handleSmartBatchResult(item, totalQty, batchItems = []) {
    let currentStockDesc = "";
    let inputLabel = "";

    totalQty = Number(totalQty.toFixed(3));

    if (item.category === "chemical") {
      currentStockDesc = `${totalQty} ${item.quantity.unit} (批次总计)`;
      inputLabel = `领用重量 (${item.quantity.unit})`;
    } else {
      currentStockDesc = `${totalQty} 米 (批次总计)`;
      inputLabel = "领用长度 (米)";
    }

    console.log("Smart Batch Items:", batchItems);
    // Calculate Recommendation: Oldest Item (FIFO)
    // Calculate Recommendation: Oldest Item (FIFO)
    let recommend = "";
    if (batchItems && batchItems.length > 0) {
      const sorted = [...batchItems].sort((a, b) => {
        const getTime = (d) => {
          if (!d) return 0;
          // Handle Firestore Timestamp
          if (typeof d.toDate === "function") return d.toDate().getTime();
          // Handle Date object
          if (d instanceof Date) return d.getTime();
          // Handle String or Number
          return new Date(d).getTime();
        };

        const tA = getTime(a.created_at);
        const tB = getTime(b.created_at);
        return tA - tB;
      });
      recommend = sorted[0].unique_code;
    }
    console.log("Calculated Recommendation:", recommend);

    this.setData({
      withdrawItem: {
        ...item,
        currentStockDesc,
        inputLabel,
        // Override val for display purposes
        quantity: { ...item.quantity, val: totalQty },
      },
      withdrawAmount: "",
      selectedUsage: "",
      usageDetail: "",
      recommendedCode: recommend, // Ensure this is set
      showUsagePicker: false,
      showWithdrawDialog: true,
      isSmartBatchMode: true, // Enable Smart Mode
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
      placeholderText: "请输入唯一码",
      success: (res) => {
        if (res.confirm && res.content) {
          this.handleScanResult(res.content);
        }
      },
    });
  },

  async handleScanResult(code) {
    Toast.loading({ message: "查询中...", forbidClick: true });

    try {
      // 1. 查询库存
      const list = await db.inventory.getList({ unique_code: code }, 1, 1);
      Toast.clear();

      if (!list || list.length === 0) {
        // 分支 A: 标签不存在 -> 提示入库
        wx.showModal({
          title: "标签未录入",
          content: `标签 ${code} 尚未绑定物料，是否立即入库？`,
          confirmText: "去入库",
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: `/pages/material-add/index?id=${code}` });
            }
          },
        });
        return;
      }

      const item = list[0];

      // 2. 准备弹窗数据
      let currentStockDesc = "";
      let inputLabel = "";

      if (item.category === "chemical") {
        currentStockDesc = `${item.quantity.val} ${item.quantity.unit}`;
        inputLabel = `领用重量 (${item.quantity.unit})`;
      } else {
        const len =
          (item.dynamic_attrs && item.dynamic_attrs.current_length_m) || 0;
        currentStockDesc = `${len} 米 (共 ${item.quantity.val} 卷)`;
        inputLabel = "领用长度 (米)";
      }

      this.setData({
        withdrawItem: { ...item, currentStockDesc, inputLabel },
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
        // Smart mode implies we might have fully used some items, partial used others.
        // The remaining returned is probably not useful for "Batch Total".
        // Maybe just success message.
        Toast.success("领用成功");
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
    this.setData(
      {
        showSelectPopup: true,
        selectSearchVal: "",
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
    this.loadAggregatedMaterials();
  },

  onCloseSelectPopup() {
    this.setData({ showSelectPopup: false });
  },

  onSelectTabChange(e) {
    this.setData({ selectActiveTab: e.detail.name });
    this.loadAggregatedMaterials();
  },

  async loadAggregatedMaterials() {
    wx.showLoading({ title: "加载中..." });
    try {
      const res = await wx.cloud.callFunction({
        name: "getInventoryGrouped",
        data: {
          searchVal: this.data.selectSearchVal,
          category: this.data.selectActiveTab,
        },
      });

      if (res.result.success) {
        this.setData({
          allMaterials: res.result.list,
          selectList: res.result.list,
        });
      }
    } catch (err) {
      console.error(err);
      Toast.fail("加载失败");
    } finally {
      wx.hideLoading();
    }
  },

  onSelectSearch(e) {
    const val = e.detail;
    this.setData({ selectSearchVal: val });

    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.loadAggregatedMaterials();
    }, 500);
  },

  // === 批次选择逻辑 ===
  async onSelectAggregatedItem(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({ selectedAggItem: item });

    wx.showLoading({ title: "加载批次..." });
    try {
      const db = wx.cloud.database();
      // Query actual inventory items for this group
      // Grouped by: product_code OR material_name (depending heavily on how getInventoryGrouped works)
      // Actually getInventoryGrouped groups by product_code + material_name roughly
      // Let's use product_code if available, else name?
      // The aggregated item has `product_code` and `material_name`.

      let query = {
        status: "in_stock",
        category: this.data.selectActiveTab,
      };

      if (item.product_code) {
        query.product_code = item.product_code;
      } else {
        query.material_name = item.material_name; // Fallback
      }

      const res = await db
        .collection("inventory")
        .where(query)
        .orderBy("batch_number", "asc") // FIFO preferred? or Expiry?
        .get();

      // Format for display
      const now = new Date();
      const batches = res.data.map((b) => {
        let expiry = "长期有效";
        let isExpiring = false;

        // Check root level first, then dynamic_attrs
        const rawDate =
          b.expiry_date || (b.dynamic_attrs && b.dynamic_attrs.expiry_date);

        if (rawDate) {
          let expDate = null;
          if (rawDate instanceof Date) {
            expDate = rawDate;
            expiry = rawDate.toISOString().split("T")[0];
          } else if (typeof rawDate === "string") {
            expDate = new Date(rawDate);
            expiry = rawDate.split("T")[0];
          }

          // Validate date
          if (expDate && !isNaN(expDate.getTime())) {
            const diffTime = expDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) {
              isExpiring = true;
            }
          }
        }

        return {
          ...b,
          expiry,
          isExpiring,
        };
      });

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

  onCloseBatchPopup() {
    this.setData({ showBatchPopup: false });
  },
});
