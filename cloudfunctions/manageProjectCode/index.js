const cloud = require('wx-server-sdk');
const { assertActiveUserAccess, assertAdminMutationAccess } = require('./auth');
const {
  normalizeProjectCode,
  normalizeProjectName,
  normalizeStatus,
  ensureBuiltinProjectCodes,
  sortProjectCodeRecords
} = require('./project-codes');
const { writeAuditEvent } = require('./audit-events');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function loadOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function getProjectRecords(includeDisabled = false) {
  const records = sortProjectCodeRecords(await ensureBuiltinProjectCodes(db));
  return includeDisabled ? records : records.filter(item => item.status === 'active');
}

async function findProjectByCode(projectCode) {
  const records = sortProjectCodeRecords(await ensureBuiltinProjectCodes(db));
  return records.find(item => item.project_code === projectCode) || null;
}

async function writeProjectAudit(action, operator, openid, record = {}, detail = {}) {
  await writeAuditEvent(db, db, {
    domain: 'project_code',
    action,
    operator: Object.assign({}, operator || {}, { _openid: openid }),
    target: {
      type: 'project_code',
      id: record._id || record.project_code || '',
      label: record.project_code || ''
    },
    after: record,
    detail
  });
}

async function listProjects(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看项目编码');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  return {
    success: true,
    list: await getProjectRecords(!!(event && event.includeDisabled))
  };
}

async function createProject(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护项目编码');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const projectCode = normalizeProjectCode(event && event.project_code);
  const projectName = normalizeProjectName(event && event.project_name);
  if (!projectCode) {
    return { success: false, msg: '请输入项目编码' };
  }
  if (!projectName) {
    return { success: false, msg: '请输入项目名称' };
  }
  if (await findProjectByCode(projectCode)) {
    return { success: false, msg: '项目编码已存在' };
  }

  const records = await getProjectRecords(true);
  const maxOrder = records.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0);
  const res = await db.collection('project_codes').add({
    data: {
      project_code: projectCode,
      project_name: projectName,
      status: 'active',
      is_builtin: false,
      sort_order: maxOrder + 10,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });
  await writeProjectAudit('create', operator, openid, {
    _id: res._id,
    project_code: projectCode,
    project_name: projectName,
    status: 'active'
  });

  return {
    success: true,
    msg: '创建成功',
    id: res._id,
    project_code: projectCode
  };
}

async function updateProject(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护项目编码');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const projectCode = normalizeProjectCode(event && event.project_code);
  const projectName = normalizeProjectName(event && event.project_name);
  if (!projectCode) {
    return { success: false, msg: '缺少项目编码' };
  }
  if (!projectName) {
    return { success: false, msg: '请输入项目名称' };
  }

  const project = await findProjectByCode(projectCode);
  if (!project || !project._id) {
    return { success: false, msg: '项目编码不存在' };
  }

  await db.collection('project_codes').doc(project._id).update({
    data: {
      project_name: projectName,
      updated_at: db.serverDate()
    }
  });
  await writeProjectAudit('update', operator, openid, Object.assign({}, project, {
    project_name: projectName
  }), {
    previous_name: project.project_name,
    next_name: projectName
  });

  return { success: true, msg: '保存成功' };
}

async function setProjectStatus(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护项目编码');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const projectCode = normalizeProjectCode(event && event.project_code);
  const nextStatus = normalizeStatus(event && event.status);
  const project = await findProjectByCode(projectCode);
  if (!project || !project._id) {
    return { success: false, msg: '项目编码不存在' };
  }

  await db.collection('project_codes').doc(project._id).update({
    data: {
      status: nextStatus,
      updated_at: db.serverDate()
    }
  });
  await writeProjectAudit('status', operator, openid, Object.assign({}, project, {
    status: nextStatus
  }), {
    previous_status: project.status,
    next_status: nextStatus
  });

  return {
    success: true,
    msg: nextStatus === 'active' ? '已启用' : '已停用'
  };
}

async function reorderProjects(event, openid) {
  const operator = await loadOperator(openid);
  const authResult = assertAdminMutationAccess(operator, '仅管理员可维护项目编码');
  if (!authResult.ok) {
    return { success: false, msg: authResult.msg };
  }

  const projectCodes = Array.isArray(event && event.project_codes)
    ? event.project_codes.map(normalizeProjectCode).filter(Boolean)
    : [];
  if (projectCodes.length === 0) {
    return { success: false, msg: '缺少排序数据' };
  }

  const records = await getProjectRecords(true);
  const recordMap = new Map(records.map(item => [item.project_code, item]));
  const validCodes = projectCodes.filter(code => recordMap.has(code));
  if (validCodes.length === 0) {
    return { success: false, msg: '未找到可排序的项目编码' };
  }

  for (let index = 0; index < validCodes.length; index += 1) {
    const record = recordMap.get(validCodes[index]);
    await db.collection('project_codes').doc(record._id).update({
      data: {
        sort_order: (index + 1) * 10,
        updated_at: db.serverDate()
      }
    });
  }
  await writeProjectAudit('reorder', operator, openid, { project_code: validCodes.join(',') }, {
    project_codes: validCodes
  });

  return { success: true, msg: '排序已更新' };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : 'list';

  try {
    if (action === 'list') {
      return await listProjects(event || {}, OPENID);
    }
    if (action === 'create') {
      return await createProject(event || {}, OPENID);
    }
    if (action === 'update') {
      return await updateProject(event || {}, OPENID);
    }
    if (action === 'setStatus') {
      return await setProjectStatus(event || {}, OPENID);
    }
    if (action === 'reorder') {
      return await reorderProjects(event || {}, OPENID);
    }

    return { success: false, msg: `不支持的操作: ${action}` };
  } catch (err) {
    console.error('manageProjectCode error', err);
    return { success: false, msg: err.message };
  }
};
