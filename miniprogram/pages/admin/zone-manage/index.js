import Toast from '@vant/weapp/toast/toast';
const {
  listZoneConfig,
  createZone,
  renameZone,
  setZoneStatus,
  reorderZones,
  createLocationDetail,
  renameLocationDetail,
  setLocationDetailStatus,
  reorderLocationDetails
} = require('../../../utils/zone-service');

function resolveCategory(options) {
  return options && options.category === 'film' ? 'film' : 'chemical';
}

function resolveTitle(category) {
  return category === 'film' ? '膜材库区管理' : '化材库区管理';
}

function buildScopeOptions(category) {
  return [
    { name: '化材专用', value: 'chemical', checked: category !== 'film' },
    { name: '膜材专用', value: 'film', checked: category === 'film' },
    { name: '共享', value: 'global', checked: false }
  ];
}

function resolveDefaultScope(category) {
  return category === 'film' ? 'film' : 'chemical';
}

function buildZonesWithDetails(zones, details) {
  const detailMap = new Map();
  (details || []).forEach((detail) => {
    const zoneKey = String((detail && detail.zone_key) || '').trim();
    if (!zoneKey) {
      return;
    }
    if (!detailMap.has(zoneKey)) {
      detailMap.set(zoneKey, []);
    }
    detailMap.get(zoneKey).push(detail);
  });

  return (zones || []).map(zone => ({
    ...zone,
    details: detailMap.get(zone.zone_key) || []
  }));
}

Page({
  data: {
    category: 'chemical',
    title: '化材库区管理',
    zones: [],
    loading: false,
    showCreatePopup: false,
    createForm: {
      name: '',
      scope: 'chemical'
    },
    scopeOptions: buildScopeOptions('chemical')
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
    this.setData({
      category,
      title,
      'createForm.scope': resolveDefaultScope(category),
      scopeOptions: buildScopeOptions(category)
    });
    wx.setNavigationBarTitle({ title });
    this.loadZones();
  },

  async loadZones() {
    this.setData({ loading: true });
    try {
      const zoneConfig = await listZoneConfig(this.data.category, true);
      this.setData({
        zones: buildZonesWithDetails(zoneConfig.zones || [], zoneConfig.details || [])
      });
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '加载库区失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  onCreateZone() {
    const scope = resolveDefaultScope(this.data.category);
    this.setData({
      showCreatePopup: true,
      createForm: {
        name: '',
        scope
      },
      scopeOptions: buildScopeOptions(this.data.category)
    });
  },

  onCloseCreatePopup() {
    this.setData({ showCreatePopup: false });
  },

  onCreateNameChange(e) {
    this.setData({
      'createForm.name': e.detail
    });
  },

  onCreateScopeChange(e) {
    this.setData({
      'createForm.scope': e.detail
    });
  },

  async onSubmitCreateZone() {
    const name = String(this.data.createForm.name || '').trim();
    if (!name) {
      Toast.fail('请输入库区名称');
      return;
    }

    wx.showLoading({ title: '创建中...' });
    try {
      await createZone(name, this.data.createForm.scope);
      Toast.success('创建成功');
      this.setData({ showCreatePopup: false });
      await this.loadZones();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '创建失败');
    } finally {
      wx.hideLoading();
    }
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
  },
  onCreateDetail(e) {
    const zone = this.data.zones[e.currentTarget.dataset.index];
    if (!zone || !zone.zone_key) {
      return;
    }

    wx.showModal({
      title: '新增详细坐标',
      editable: true,
      placeholderText: '例如 F6、样品层',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const name = String(res.content || '').trim();
        if (!name) {
          Toast.fail('请输入详细坐标名称');
          return;
        }

        wx.showLoading({ title: '创建中...' });
        try {
          await createLocationDetail(zone.zone_key, name);
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

  onRenameDetail(e) {
    const zone = this.data.zones[e.currentTarget.dataset.zoneIndex];
    const detail = zone && zone.details ? zone.details[e.currentTarget.dataset.detailIndex] : null;
    if (!detail || !detail.detail_key) {
      return;
    }

    wx.showModal({
      title: '重命名详细坐标',
      editable: true,
      placeholderText: `当前名称：${detail.name}`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const name = String(res.content || '').trim();
        if (!name) {
          Toast.fail('请输入新的详细坐标名称');
          return;
        }

        wx.showLoading({ title: '保存中...' });
        try {
          await renameLocationDetail(detail.detail_key, name);
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

  async onToggleDetail(e) {
    const zone = this.data.zones[e.currentTarget.dataset.zoneIndex];
    const detail = zone && zone.details ? zone.details[e.currentTarget.dataset.detailIndex] : null;
    if (!detail || !detail.detail_key) {
      return;
    }

    const nextStatus = detail.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';

    wx.showLoading({ title: `${actionLabel}中...` });
    try {
      await setLocationDetailStatus(detail.detail_key, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadZones();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || `${actionLabel}失败`);
    } finally {
      wx.hideLoading();
    }
  },

  onMoveDetailUp(e) {
    this.moveDetail(e.currentTarget.dataset.zoneIndex, e.currentTarget.dataset.detailIndex, -1);
  },

  onMoveDetailDown(e) {
    this.moveDetail(e.currentTarget.dataset.zoneIndex, e.currentTarget.dataset.detailIndex, 1);
  },

  async moveDetail(zoneIndex, detailIndex, delta) {
    const zones = this.data.zones.slice();
    const zone = zones[zoneIndex];
    const details = zone && zone.details ? zone.details.slice() : [];
    const nextIndex = detailIndex + delta;
    if (!zone || detailIndex < 0 || nextIndex < 0 || nextIndex >= details.length) {
      return;
    }

    const temp = details[detailIndex];
    details[detailIndex] = details[nextIndex];
    details[nextIndex] = temp;

    wx.showLoading({ title: '排序中...' });
    try {
      await reorderLocationDetails(zone.zone_key, details.map(item => item.detail_key));
      zones[zoneIndex] = { ...zone, details };
      this.setData({ zones });
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
