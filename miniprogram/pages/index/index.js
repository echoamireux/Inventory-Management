// pages/index/index.js
import Dialog from "@vant/weapp/dialog/dialog";
import Toast from "@vant/weapp/toast/toast";
const db = require("../../utils/db");
const alertConfig = require("../../utils/alert-config");

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

  // Modified to handle Batch Aggregated Selection
  onSelectBatchItem(e) {
    // 从 dataset.batch 获取批次聚合数据
    const batch = e.currentTarget.dataset.batch;
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
    const category = this.data.selectedAggItem?.category || this.data.selectActiveTab;

    let currentStockDesc = `${totalQty} ${unit} (批次总计)`;
    let inputLabel = `领用量 (${unit})`;

    if (category === 'film') {
      currentStockDesc = `${totalQty} 米 (批次总计)`;
      inputLabel = "领用长度 (米)";
    }

    // 查询该批次下 FIFO 推荐的第一条库存记录
    let recommendedCode = '';
    try {
      const db = wx.cloud.database();
      const res = await db.collection('inventory')
        .where({
          batch_number: batch.batch_number,
          product_code: batch.product_code,
          status: 'in_stock'
        })
        .orderBy('expiry_date', 'asc')  // 临期优先
        .orderBy('create_time', 'asc')   // 最早入库优先
        .limit(1)
        .get();

      if (res.data.length > 0) {
        recommendedCode = res.data[0].unique_code || '';
      }
    } catch (err) {
      console.warn('获取推荐标签失败', err);
    }

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
        unique_code: recommendedCode,  // 添加推荐的 unique_code
        isArchived: batch.isArchived || this.data.selectedAggItem?.isArchived || false  // 传递归档状态
      },
      withdrawAmount: "",
      selectedUsage: "",
      usageDetail: "",
      recommendedCode: recommendedCode,
      showUsagePicker: false,
      showWithdrawDialog: true,
      isSmartBatchMode: true, // Enable Batch Mode for FIFO
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
        Dialog.confirm({
          title: "标签未录入",
          message: `标签 ${code} 尚未绑定物料，是否立即入库？`,
          confirmButtonText: "去入库",
          confirmButtonColor: "#2C68FF"
        }).then(() => {
            wx.navigateTo({ url: `/pages/material-add/index?id=${code}` });
        }).catch(() => {
            // Cancel
        });
        return;
      }

      const item = list[0];

      // 2. 检查物料归档状态
      let isArchived = false;
      if (item.product_code) {
        try {
          const matRes = await wx.cloud.database().collection('materials')
            .where({ product_code: item.product_code })
            .field({ status: true })
            .limit(1)
            .get();
          if (matRes.data && matRes.data.length > 0) {
            isArchived = matRes.data[0].status === 'archived';
          }
        } catch(e) { console.warn('Material lookup failed', e); }
      }

      // 3. 准备弹窗数据
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
        withdrawItem: { ...item, currentStockDesc, inputLabel, isArchived },
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
        // 统一反馈格式
        const remaining = res.result.remaining;
        const unit = res.result.unit || '';
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
    // 支持两种模式：1. dataset.item  2. 组件返回的 e.detail.item
    const item = (e.detail && e.detail.item) || e.currentTarget.dataset.item;
    this.setData({ selectedAggItem: item });

    wx.showLoading({ title: "加载批次..." });
    try {
      const db = wx.cloud.database();
      const $ = db.command.aggregate;

      let matchQuery = {
        status: "in_stock",
        category: this.data.selectActiveTab,
      };

      if (item.product_code) {
        matchQuery.product_code = item.product_code;
      } else {
        matchQuery.material_name = item.material_name;
      }

      // 按批次聚合，计算每个批次的总库存
      const result = await db.collection("inventory").aggregate()
        .match(matchQuery)
        .group({
          _id: "$batch_number",
          totalQuantity: $.sum("$quantity.val"),
          itemCount: $.sum(1),
          minExpiry: $.min("$expiry_date"),
          location: $.first("$location"),
          unit: $.first("$quantity.unit"),
          product_code: $.first("$product_code"),
          material_name: $.first("$material_name")
        })
        .sort({ minExpiry: 1 }) // 临期优先(FIFO)
        .end();

      // Format for display
      const now = new Date();
      const batches = result.list.map((b) => {
        let expiry = "长期有效";
        let isExpiring = false;

        if (b.minExpiry) {
          const expDate = new Date(b.minExpiry);
          if (!isNaN(expDate.getTime())) {
            expiry = b.minExpiry.split ? b.minExpiry.split("T")[0] : expDate.toISOString().split("T")[0];
            const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
            if (diffDays <= alertConfig.EXPIRY_DAYS) {
              isExpiring = true;
            }
          }
        }

        return {
          batch_number: b._id || "无批号",
          totalQuantity: parseFloat(b.totalQuantity.toFixed(2)),
          itemCount: b.itemCount,
          expiry,
          isExpiring,
          location: b.location,
          unit: b.unit,
          product_code: b.product_code,
          material_name: b.material_name,
          isArchived: item.isArchived || false  // 从聚合项传递归档状态
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
