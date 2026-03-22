import Toast from '@vant/weapp/toast/toast';
const {
  listZoneRecords,
  createZone,
  renameZone,
  setZoneStatus,
  reorderZones
} = require('../../../utils/zone-service');

function resolveCategory(options) {
  return options && options.category === 'film' ? 'film' : 'chemical';
}

function resolveTitle(category) {
  return category === 'film' ? '膜材库区管理' : '化材库区管理';
}

Page({
  data: {
    category: 'chemical',
    title: '化材库区管理',
    zones: [],
    loading: false
  },

  onLoad(options) {
    const app = getApp();
    const user = app.globalData.user;
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      wx.showModal({
        title: '无权限',
        content: '该页面仅限管理员访问',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
      return;
    }

    const category = resolveCategory(options);
    const title = resolveTitle(category);
    this.setData({ category, title });
    wx.setNavigationBarTitle({ title });
    this.loadZones();
  },

  async loadZones() {
    this.setData({ loading: true });
    try {
      const zones = await listZoneRecords(this.data.category, true);
      this.setData({ zones });
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '加载库区失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  async onCreateZone() {
    wx.showModal({
      title: '新建库区',
      editable: true,
      placeholderText: '请输入库区名称',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const name = String(res.content || '').trim();
        if (!name) {
          Toast.fail('请输入库区名称');
          return;
        }

        wx.showLoading({ title: '创建中...' });
        try {
          await createZone(name);
          Toast.success('创建成功');
          await this.loadZones();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '创建失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  onRenameZone(e) {
    const zone = this.data.zones[e.currentTarget.dataset.index];
    if (!zone || !zone.zone_key) {
      return;
    }

    wx.showModal({
      title: '重命名库区',
      editable: true,
      placeholderText: `当前名称：${zone.name}`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const nextName = String(res.content || '').trim();
        if (!nextName) {
          Toast.fail('请输入新的库区名称');
          return;
        }

        wx.showLoading({ title: '保存中...' });
        try {
          await renameZone(zone.zone_key, nextName);
          Toast.success('已重命名');
          await this.loadZones();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '重命名失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onToggleZone(e) {
    const zone = this.data.zones[e.currentTarget.dataset.index];
    if (!zone || !zone.zone_key) {
      return;
    }

    const nextStatus = zone.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';

    wx.showLoading({ title: `${actionLabel}中...` });
    try {
      await setZoneStatus(zone.zone_key, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadZones();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || `${actionLabel}失败`);
    } finally {
      wx.hideLoading();
    }
  },

  onMoveUp(e) {
    this.moveZone(e.currentTarget.dataset.index, -1);
  },

  onMoveDown(e) {
    this.moveZone(e.currentTarget.dataset.index, 1);
  },

  async moveZone(index, delta) {
    const list = this.data.zones.slice();
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) {
      return;
    }

    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    wx.showLoading({ title: '排序中...' });
    try {
      await reorderZones(list.map(item => item.zone_key));
      this.setData({ zones: list });
      Toast.success('排序已更新');
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '排序失败');
      await this.loadZones();
    } finally {
      wx.hideLoading();
    }
  }
});
