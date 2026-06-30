async function callProjectCode(action, payload = {}) {
  const res = await wx.cloud.callFunction({
    name: 'manageProjectCode',
    data: {
      action,
      ...payload
    }
  });
  const result = res.result || {};
  if (!result.success) {
    throw new Error(result.msg || '项目编码操作失败');
  }
  return result;
}

async function listProjectCodes(includeDisabled = false) {
  const result = await callProjectCode('list', { includeDisabled });
  return result.list || [];
}

async function createProjectCode(projectCode, projectName) {
  return callProjectCode('create', {
    project_code: projectCode,
    project_name: projectName
  });
}

async function updateProjectCode(projectCode, projectName) {
  return callProjectCode('update', {
    project_code: projectCode,
    project_name: projectName
  });
}

async function setProjectCodeStatus(projectCode, status) {
  return callProjectCode('setStatus', {
    project_code: projectCode,
    status
  });
}

async function reorderProjectCodes(projectCodes) {
  return callProjectCode('reorder', {
    project_codes: projectCodes
  });
}

function buildProjectCodePickerColumns(records = []) {
  return (records || []).map(item => ({
    text: item.project_name ? `${item.project_code} - ${item.project_name}` : item.project_code,
    value: item.project_code,
    project_code: item.project_code,
    project_name: item.project_name || ''
  }));
}

module.exports = {
  listProjectCodes,
  createProjectCode,
  updateProjectCode,
  setProjectCodeStatus,
  reorderProjectCodes,
  buildProjectCodePickerColumns
};
