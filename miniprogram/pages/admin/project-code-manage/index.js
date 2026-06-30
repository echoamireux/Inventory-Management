import Toast from '@vant/weapp/toast/toast';
const {
  listProjectCodes,
  createProjectCode,
  updateProjectCode,
  setProjectCodeStatus,
  reorderProjectCodes
} = require('../../../utils/project-code-service');

Page({
  data: {
    projects: [],
    loading: false
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

    wx.setNavigationBarTitle({ title: '项目编码管理' });
    this.loadProjects();
  },

  async loadProjects() {
    this.setData({ loading: true });
    try {
      const projects = await listProjectCodes(true);
      this.setData({ projects });
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '加载项目编码失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  onCreateProject() {
    wx.showModal({
      title: '新建项目编码',
      editable: true,
      placeholderText: '输入格式：项目编码 项目名称',
      success: async (res) => {
        if (!res.confirm) return;

        const raw = String(res.content || '').trim();
        const match = raw.match(/^(\S+)\s+(.+)$/);
        if (!match) {
          Toast.fail('请按“项目编码 项目名称”填写');
          return;
        }

        wx.showLoading({ title: '创建中...' });
        try {
          await createProjectCode(match[1], match[2]);
          Toast.success('创建成功');
          await this.loadProjects();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '创建失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  onRenameProject(e) {
    const project = this.data.projects[e.currentTarget.dataset.index];
    if (!project || !project.project_code) return;

    wx.showModal({
      title: '修改项目名称',
      editable: true,
      placeholderText: project.project_name || project.project_code,
      success: async (res) => {
        if (!res.confirm) return;

        const nextName = String(res.content || '').trim();
        if (!nextName) {
          Toast.fail('请输入项目名称');
          return;
        }

        wx.showLoading({ title: '保存中...' });
        try {
          await updateProjectCode(project.project_code, nextName);
          Toast.success('已保存');
          await this.loadProjects();
        } catch (err) {
          console.error(err);
          Toast.fail(err.message || '保存失败');
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onToggleProject(e) {
    const project = this.data.projects[e.currentTarget.dataset.index];
    if (!project || !project.project_code) return;

    const nextStatus = project.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';

    wx.showLoading({ title: `${actionLabel}中...` });
    try {
      await setProjectCodeStatus(project.project_code, nextStatus);
      Toast.success(`${actionLabel}成功`);
      await this.loadProjects();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || `${actionLabel}失败`);
    } finally {
      wx.hideLoading();
    }
  },

  onMoveUp(e) {
    this.moveProject(e.currentTarget.dataset.index, -1);
  },

  onMoveDown(e) {
    this.moveProject(e.currentTarget.dataset.index, 1);
  },

  async moveProject(index, delta) {
    const list = this.data.projects.slice();
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;

    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    wx.showLoading({ title: '排序中...' });
    try {
      await reorderProjectCodes(list.map(item => item.project_code));
      this.setData({ projects: list });
      Toast.success('排序已更新');
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || '排序失败');
      await this.loadProjects();
    } finally {
      wx.hideLoading();
    }
  }
});
