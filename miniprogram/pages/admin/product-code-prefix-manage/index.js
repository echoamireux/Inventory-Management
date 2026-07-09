import Toast from '@vant/weapp/toast/toast';
const {
  listProductCodePrefixes,
  createProductCodePrefix,
  updateProductCodePrefix,
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
  if (/^[A-Z]$/.test(raw)) {
    return `${raw}-`;
  }
  return raw;
}

Page({
  data: {
    prefixes: [],
    loading: false,
    loadError: '',
    formVisible: false,
    formMode: 'create',
    editingPrefix: '',
    formSubmitting: false,
    form: {
      prefix: '',
      category: 'chemical',
      name: ''
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
      formMode: 'create',
      editingPrefix: '',
      form: {
        prefix: '',
        category: 'chemical',
        name: ''
      }
    });
  },

  onRenamePrefix(e) {
    const record = this.data.prefixes[e.currentTarget.dataset.index];
    if (!record || !record.prefix) return;

    this.setData({
      formVisible: true,
      formMode: 'rename',
      editingPrefix: record.prefix,
      form: {
        prefix: record.prefix,
        category: record.category || 'chemical',
        name: record.name || ''
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

  onNameInput(e) {
    this.setData({
      'form.name': String(getInputValue(e) || '')
    });
  },

  onSelectChemical() {
    this.setData({ 'form.category': 'chemical' });
  },

  onSelectFilm() {
    this.setData({ 'form.category': 'film' });
  },

  async onSubmitForm() {
    const mode = this.data.formMode;
    const prefix = mode === 'rename'
      ? normalizePrefixInput(this.data.editingPrefix)
      : normalizePrefixInput(this.data.form.prefix);
    const category = this.data.form.category === 'film' ? 'film' : 'chemical';
    const name = String(this.data.form.name || '').trim();

    if (!/^[A-Z]-$/.test(prefix)) {
      Toast.fail('前缀格式如 S-');
      return;
    }
    if (!name) {
      Toast.fail('请输入前缀名称');
      return;
    }

    this.setData({ formSubmitting: true });
    wx.showLoading({ title: mode === 'create' ? '创建中...' : '保存中...' });
    try {
      if (mode === 'create') {
        await createProductCodePrefix(prefix, category, name);
        Toast.success('创建成功');
      } else {
        await updateProductCodePrefix(prefix, name);
        Toast.success('已保存');
      }
      this.setData({ formVisible: false });
      await this.loadPrefixes();
    } catch (err) {
      Toast.fail(err.message || (mode === 'create' ? '创建失败' : '保存失败'));
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
