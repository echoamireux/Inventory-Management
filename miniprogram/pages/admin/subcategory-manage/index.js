import Toast from '@vant/weapp/toast/toast';
const {
  listSubcategoryRecords,
  createSubcategory,
  renameSubcategory,
  setSubcategoryStatus,
  reorderSubcategories
} = require('../../../utils/subcategory-service');

function resolveCategory(options) {
  return options && options.category === 'film' ? 'film' : 'chemical';
}

function resolveTitle(category) {
  return category === 'film' ? '膜材子类别管理' : '化材子类别管理';
}

Page({
  data: {
    category: 'chemical',
    title: '化材子类别管理',
    subcategories: [],
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
    this.loadSubcategories();
  },

  async loadSubcategories() {
    this.setData({ loading: true });
    try {
      const subcategories = await listSubcategoryRecords(this.data.category, true);
      this.setData({ subcategories });
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '加载子类别失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  async onCreateSubcategory() {
    wx.showModal({
      title: '新建子类别',
      editable: true,
      placeholderText: '请输入子类别名称',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const name = String(res.content || '').trim();
        if (!name) {
          Toast.fail('请输入子类别名称');
          return;
        }

        wx.showLoading({ title: '创建中...' });
        try {
          await createSubcategory(name, this.data.category);
          Toast.success('创建成功');
          await this.loadSubcategories();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '创建失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  onRenameSubcategory(e) {
    const subcategory = this.data.subcategories[e.currentTarget.dataset.index];
    if (!subcategory || !subcategory.subcategory_key) {
      return;
    }

    wx.showModal({
      title: '重命名子类别',
      editable: true,
      placeholderText: `当前名称：${subcategory.name}`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const nextName = String(res.content || '').trim();
        if (!nextName) {
          Toast.fail('请输入新的子类别名称');
          return;
        }

        wx.showLoading({ title: '保存中...' });
        try {
          await renameSubcategory(subcategory.subcategory_key, nextName);
          Toast.success('已重命名');
          await this.loadSubcategories();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '重命名失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onToggleSubcategory(e) {
    const subcategory = this.data.subcategories[e.currentTarget.dataset.index];
    if (!subcategory || !subcategory.subcategory_key) {
      return;
    }

    const nextStatus = subcategory.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';

    wx.showLoading({ title: `${actionLabel}中...` });
    try {
      await setSubcategoryStatus(subcategory.subcategory_key, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadSubcategories();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || `${actionLabel}失败`);
    } finally {
      wx.hideLoading();
    }
  },

  onMoveUp(e) {
    this.moveSubcategory(e.currentTarget.dataset.index, -1);
  },

  onMoveDown(e) {
    this.moveSubcategory(e.currentTarget.dataset.index, 1);
  },

  async moveSubcategory(index, delta) {
    const list = this.data.subcategories.slice();
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) {
      return;
    }

    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    wx.showLoading({ title: '排序中...' });
    try {
      await reorderSubcategories(list.map(item => item.subcategory_key));
      this.setData({ subcategories: list });
      Toast.success('排序已更新');
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '排序失败');
      await this.loadSubcategories();
    } finally {
      wx.hideLoading();
    }
  }
});
