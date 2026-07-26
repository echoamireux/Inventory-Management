import Toast from '@vant/weapp/toast/toast';
const {
  listProjectCodes,
  createProjectCode,
  updateProjectCode,
  setProjectCodeStatus,
  reorderProjectCodes
} = require('../../../utils/project-code-service');

const PROJECT_CODE_PATTERN = /^OR\d{4}RD\d{5}$/;

function getInputValue(e) {
  if (e && e.detail && e.detail.value !== undefined) {
    return e.detail.value;
  }
  if (e && e.detail !== undefined) {
    return e.detail;
  }
  return '';
}

function normalizeProjectCodeInput(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

Page({
  data: {
    projects: [],
    loading: false,
    loadError: '',
    projectFormVisible: false,
    projectFormMode: 'create',
    editingProjectCode: '',
    formSubmitting: false,
    projectForm: {
      project_code: '',
      project_name: ''
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

    wx.setNavigationBarTitle({ title: '项目编码管理' });
    this.loadProjects();
  },

  async loadProjects() {
    this.setData({ loading: true, loadError: '' });
    try {
      const projects = await listProjectCodes(true);
      this.setData({ projects, loadError: '' });
    } catch (err) {
      console.error(err);
      const message = err.message || '加载项目编码失败';
      this.setData({ loadError: message });
      Toast.fail(message);
    } finally {
      this.setData({ loading: false });
    }
  },

  onReloadProjects() {
    this.loadProjects();
  },

  onCreateProject() {
    this.setData({
      projectFormVisible: true,
      projectFormMode: 'create',
      editingProjectCode: '',
      projectForm: {
        project_code: '',
        project_name: ''
      }
    });
  },

  onRenameProject(e) {
    const project = this.data.projects[e.currentTarget.dataset.index];
    if (!project || !project.project_code) return;

    this.setData({
      projectFormVisible: true,
      projectFormMode: 'rename',
      editingProjectCode: project.project_code,
      projectForm: {
        project_code: project.project_code,
        project_name: project.project_name || ''
      }
    });
  },

  onCloseProjectForm() {
    if (this.data.formSubmitting) {
      return;
    }
    this.setData({ projectFormVisible: false });
  },

  onProjectCodeInput(e) {
    this.setData({
      'projectForm.project_code': normalizeProjectCodeInput(getInputValue(e))
    });
  },

  onProjectNameInput(e) {
    this.setData({
      'projectForm.project_name': String(getInputValue(e) || '')
    });
  },

  async onSubmitProjectForm() {
    const mode = this.data.projectFormMode;
    const projectCode = mode === 'rename'
      ? normalizeProjectCodeInput(this.data.editingProjectCode)
      : normalizeProjectCodeInput(this.data.projectForm.project_code);
    const projectName = String(this.data.projectForm.project_name || '').trim();

    if (!projectCode) {
      Toast.fail('请输入项目编码');
      return;
    }
    if (mode === 'create' && !PROJECT_CODE_PATTERN.test(projectCode)) {
      Toast.fail('项目编码格式应类似 OR2026RD99999');
      return;
    }
    if (!projectName) {
      Toast.fail('请输入项目名称');
      return;
    }

    this.setData({ formSubmitting: true });
    wx.showLoading({ title: mode === 'create' ? '创建中' : '保存中' });
    try {
      if (mode === 'create') {
        await createProjectCode(projectCode, projectName);
        Toast.success('创建成功');
      } else {
        await updateProjectCode(projectCode, projectName);
        Toast.success('已保存');
      }
      this.setData({ projectFormVisible: false });
      await this.loadProjects();
    } catch (err) {
      console.error(err);
      Toast.fail(err.message || (mode === 'create' ? '创建失败' : '保存失败'));
    } finally {
      wx.hideLoading();
      this.setData({ formSubmitting: false });
    }
  },

  async onToggleProject(e) {
    const project = this.data.projects[e.currentTarget.dataset.index];
    if (!project || !project.project_code) return;

    const nextStatus = project.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'active' ? '启用' : '停用';

    wx.showLoading({ title: `${actionLabel}中` });
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

    wx.showLoading({ title: '排序中' });
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
