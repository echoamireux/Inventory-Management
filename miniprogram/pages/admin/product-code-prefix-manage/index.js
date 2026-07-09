import Toast from '@vant/weapp/toast/toast';
const {
  listProductCodePrefixes,
  createProductCodePrefix,
  setProductCodePrefixStatus,
  reorderProductCodePrefixes
} = require('../../../utils/product-code-prefix-service');

function getInputValue(e) {
  if (e && e.detail && e.detail.value !== undefined) {
    return e.detail.value;
  }
  if (e && e.detail !== undefined) {
    return e.detail;
  }
  return '';
}

function normalizePrefixInput(value) {
  const raw = String(value || '').replace(/\s+/g, '').toUpperCase();
  return raw;
}

Page({
  data: {
    prefixes: [],
    loading: false,
    loadError: '',
    formVisible: false,
    formSubmitting: false,
    form: {
      prefix: '',
      category: 'chemical'
    }
  },

  onLoad() {
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

    wx.setNavigationBarTitle({ title: '产品代码前缀管理' });
    this.loadPrefixes();
  },

  async loadPrefixes() {
    this.setData({ loading: true, loadError: '' });
    try {
      const prefixes = await listProductCodePrefixes(true);
      this.setData({ prefixes, loadError: '' });
    } catch (err) {
      const message = err.message || '加载产品代码前缀失败';
      this.setData({ loadError: message });
      Toast.fail(message);
    } finally {
      this.setData({ loading: false });
    }
  },

  onReloadPrefixes() {
    this.loadPrefixes();
  },

  onCreatePrefix() {
    this.setData({
      formVisible: true,
      form: {
        prefix: '',
        category: 'chemical'
      }
    });
  },

  onCloseForm() {
    if (this.data.formSubmitting) return;
    this.setData({ formVisible: false });
  },

  onPrefixInput(e) {
    this.setData({
      'form.prefix': normalizePrefixInput(getInputValue(e))
    });
  },

  onSelectChemical() {
    this.setData({ 'form.category': 'chemical' });
  },

  onSelectFilm() {
    this.setData({ 'form.category': 'film' });
  },

  async onSubmitForm() {
    const prefix = normalizePrefixInput(this.data.form.prefix);
    const category = this.data.form.category === 'film' ? 'film' : 'chemical';

    if (!/^[A-Z]{1,4}$/.test(prefix)) {
      Toast.fail('前缀填写 1-4 位大写英文字母');
      return;
    }

    this.setData({ formSubmitting: true });
    wx.showLoading({ title: '创建中...' });
    try {
      await createProductCodePrefix(prefix, category);
      Toast.success('创建成功');
      this.setData({ formVisible: false });
      await this.loadPrefixes();
    } catch (err) {
      Toast.fail(err.message || '创建失败');
    } finally {
      wx.hideLoading();
      this.setData({ formSubmitting: false });
    }
  },

  async onTogglePrefix(e) {
    const record = this.data.prefixes[e.currentTarget.dataset.index];
    if (!record || !record.prefix) return;

    const nextStatus = record.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';
    wx.showLoading({ title: `${actionLabel}中...` });
    try {
      await setProductCodePrefixStatus(record.prefix, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadPrefixes();
    } catch (err) {
      Toast.fail(err.message || `${actionLabel}失败`);
    } finally {
      wx.hideLoading();
    }
  },

  onMoveUp(e) {
    this.movePrefix(e.currentTarget.dataset.index, -1);
  },

  onMoveDown(e) {
    this.movePrefix(e.currentTarget.dataset.index, 1);
  },

  async movePrefix(index, delta) {
    const list = this.data.prefixes.slice();
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;

    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    wx.showLoading({ title: '排序中...' });
    try {
      await reorderProductCodePrefixes(list.map(item => item.prefix));
      this.setData({ prefixes: list });
      Toast.success('排序已更新');
    } catch (err) {
      Toast.fail(err.message || '排序失败');
      await this.loadPrefixes();
    } finally {
      wx.hideLoading();
    }
  }
});
