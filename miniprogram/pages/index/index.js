// pages/index/index.js
import Dialog from "@vant/weapp/dialog/dialog";
import Toast from "@vant/weapp/toast/toast";
const db = require("../../utils/db");
const alertConfig = require("../../utils/alert-config");
const { summarizeFilmDisplayQuantities } = require("../../utils/film");
const { resolveInventoryLocation, buildZoneMap } = require('../../utils/location-zone');
const { listZoneRecords } = require('../../utils/zone-service');
const {
  mergeInventoryMaterialData,
  getInventoryQuantityDisplayState
} = require('../../utils/inventory-display');
const {
  normalizeLabelCodeInput,
  isValidLabelCode
} = require('../../utils/label-code');

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
        isArchived: batch.isArchived || selectedAggItem.isArchived || false
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

      const pageSize = 200;
      let skip = 0;
      let inventoryItems = [];

      while (true) {
        const res = await db.collection("inventory")
          .where(matchQuery)
          .orderBy("expiry_date", "asc")
          .orderBy("create_time", "asc")
          .skip(skip)
          .limit(pageSize)
          .get();

        inventoryItems = inventoryItems.concat(res.data || []);
        if (!res.data || res.data.length < pageSize) {
          break;
        }
        skip += pageSize;
      }
      let zoneMap = new Map();
      try {
        const zoneRecords = await listZoneRecords(item.category || this.data.selectActiveTab, true);
        zoneMap = buildZoneMap(zoneRecords);
      } catch (zoneErr) {
        console.warn('加载库区映射失败', zoneErr);
      }

      const groupedByBatch = new Map();
      inventoryItems.forEach((record) => {
        const batchNumber = record.batch_number || "无批号";
        const resolvedLocation = resolveInventoryLocation(record, zoneMap);
        if (!groupedByBatch.has(batchNumber)) {
          groupedByBatch.set(batchNumber, {
            batch_number: batchNumber,
            records: [],
            itemCount: 0,
            minExpiry: record.expiry_date || null,
            hasLongTermValidity: !!record.is_long_term_valid,
            hasMissingExpiry: !record.expiry_date && !record.is_long_term_valid,
            location: resolvedLocation,
            product_code: record.product_code,
            material_name: record.material_name,
            sub_category: record.sub_category || item.sub_category || '',
            subcategory_key: record.subcategory_key || item.subcategory_key || ''
          });
        }

        const group = groupedByBatch.get(batchNumber);
        group.records.push(record);
        group.itemCount += 1;
        if (record.is_long_term_valid) {
          group.hasLongTermValidity = true;
        }
        if (!record.expiry_date && !record.is_long_term_valid) {
          group.hasMissingExpiry = true;
        }
        if (record.expiry_date && (!group.minExpiry || new Date(record.expiry_date) < new Date(group.minExpiry))) {
          group.minExpiry = record.expiry_date;
        }
      });

      // Format for display
      const now = new Date();
      const batches = Array.from(groupedByBatch.values()).map((b) => {
        let expiry = b.hasMissingExpiry ? '未设置过期日' : (b.hasLongTermValidity ? '长期有效' : '未设置过期日');
        let isExpiring = false;
        let totalQuantity = 0;
        let totalBaseLengthM = 0;
        let unit = item.category === 'film' ? item.unit : ((b.records[0] && b.records[0].quantity && b.records[0].quantity.unit) || 'kg');

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

        if (item.category === 'film') {
          const summary = summarizeFilmDisplayQuantities(b.records, item.unit);
          totalQuantity = summary.displayQuantity;
          totalBaseLengthM = summary.baseLengthM;
          unit = summary.displayUnit;
        } else {
          totalQuantity = parseFloat(b.records.reduce((sum, current) => {
            const quantityVal = current && current.quantity ? Number(current.quantity.val) || 0 : 0;
            return sum + quantityVal;
          }, 0).toFixed(2));
        }

        return {
          batch_number: b.batch_number,
          totalQuantity: totalQuantity,
          totalBaseLengthM: totalBaseLengthM,
          itemCount: b.itemCount,
          expiry,
          isExpiring,
          location: b.location,
          unit: unit,
          product_code: b.product_code,
          material_name: b.material_name,
          sub_category: b.sub_category || item.sub_category || '',
          subcategory_key: b.subcategory_key || item.subcategory_key || '',
          isArchived: item.isArchived || false  // 从聚合项传递归档状态
        };
      }).sort((a, b) => {
        const timeA = /^\d{4}-\d{2}-\d{2}$/.test(a.expiry) ? new Date(a.expiry).getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = /^\d{4}-\d{2}-\d{2}$/.test(b.expiry) ? new Date(b.expiry).getTime() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
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
