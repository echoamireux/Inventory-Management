const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  buildSubcategoryMap,
  resolveSubcategoryDisplay
} = require('./material-subcategories');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function getOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizePagination(event = {}) {
  return {
    page: Math.max(1, Number(event.page) || 1),
    pageSize: Math.max(1, Math.min(100, Number(event.pageSize) || 20))
  };
}

function buildPageResult(list, total, page, pageSize) {
  return {
    list,
    total,
    page,
    pageSize,
    isEnd: page * pageSize >= total
  };
}

async function listMaterials(page, pageSize) {
  const where = { status: 'pending' };
  const [countRes, requestRes, subcategoryRecords] = await Promise.all([
    db.collection('material_requests').where(where).count(),
    db.collection('material_requests')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
    ensureBuiltinSubcategories(db).then(sortSubcategoryRecords)
  ]);
  const subcategoryMap = buildSubcategoryMap(subcategoryRecords);
  const list = (requestRes.data || []).map(item => ({
    ...item,
    _subcategoryDisplay: resolveSubcategoryDisplay(item, subcategoryMap) || item.sub_category || '-',
    _timeStr: formatTime(item.created_at)
  }));

  return buildPageResult(list, Number(countRes.total) || 0, page, pageSize);
}

async function listUsers(page, pageSize) {
  const where = { status: 'pending' };
  const [countRes, res] = await Promise.all([
    db.collection('users').where(where).count(),
    db.collection('users')
      .where(where)
      .orderBy('create_time', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ]);

  const uniqueUsers = [];
  const seenOpenids = new Set();
  (res.data || []).forEach((item) => {
    const openid = normalizeText(item._openid || item.openid || item._id);
    if (seenOpenids.has(openid)) {
      return;
    }
    seenOpenids.add(openid);
    uniqueUsers.push({
      ...item,
      _timeStr: formatTime(item.create_time || item.created_at)
    });
  });

  return buildPageResult(uniqueUsers, Number(countRes.total) || 0, page, pageSize);
}

async function listCorrections(page, pageSize) {
  const where = { status: 'pending' };
  const [countRes, res] = await Promise.all([
    db.collection('inventory_correction_requests').where(where).count(),
    db.collection('inventory_correction_requests')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ]);
  const list = (res.data || []).map(item => ({
    ...item,
    _timeStr: formatTime(item.created_at)
  }));
  return buildPageResult(list, Number(countRes.total) || 0, page, pageSize);
}

function buildActionResponse(listKey, result) {
  return {
    success: true,
    [listKey]: result.list,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    isEnd: result.isEnd
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = normalizeText(event.action || 'all');
  const { page, pageSize } = normalizePagination(event);

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertAdminMutationAccess(operator, '仅已激活管理员可查看审批中心');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    if (action === 'materials') {
      return buildActionResponse('materialList', await listMaterials(page, pageSize));
    }
    if (action === 'users') {
      return buildActionResponse('userList', await listUsers(page, pageSize));
    }
    if (action === 'corrections') {
      return buildActionResponse('correctionList', await listCorrections(page, pageSize));
    }
    if (action === 'all') {
      const [materials, users, corrections] = await Promise.all([
        listMaterials(page, pageSize),
        listUsers(page, pageSize),
        listCorrections(page, pageSize)
      ]);
      return {
        success: true,
        materialList: materials.list,
        userList: users.list,
        correctionList: corrections.list,
        page,
        pageSize,
        total: materials.total + users.total + corrections.total,
        isEnd: materials.isEnd && users.isEnd && corrections.isEnd,
        pagination: { materials, users, corrections }
      };
    }

    return { success: false, msg: '未知操作' };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message || '加载审批数据失败'
    };
  }
};
