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

async function listMaterials() {
  const [requestRes, subcategoryRecords] = await Promise.all([
    db.collection('material_requests')
      .where({ status: 'pending' })
      .orderBy('created_at', 'desc')
      .limit(100)
      .get(),
    ensureBuiltinSubcategories(db).then(sortSubcategoryRecords)
  ]);
  const subcategoryMap = buildSubcategoryMap(subcategoryRecords);

  return (requestRes.data || []).map(item => ({
    ...item,
    _subcategoryDisplay: resolveSubcategoryDisplay(item, subcategoryMap) || item.sub_category || '-',
    _timeStr: formatTime(item.created_at)
  }));
}

async function listUsers() {
  const res = await db.collection('users')
    .where({ status: 'pending' })
    .orderBy('create_time', 'desc')
    .limit(100)
    .get();

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

  return uniqueUsers;
}

async function listCorrections() {
  const res = await db.collection('inventory_correction_requests')
    .where({ status: 'pending' })
    .orderBy('created_at', 'desc')
    .limit(100)
    .get();
  return (res.data || []).map(item => ({
    ...item,
    _timeStr: formatTime(item.created_at)
  }));
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = normalizeText(event.action || 'all');

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertAdminMutationAccess(operator, '仅已激活管理员可查看审批中心');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }

    if (action === 'materials') {
      return { success: true, materialList: await listMaterials() };
    }
    if (action === 'users') {
      return { success: true, userList: await listUsers() };
    }
    if (action === 'corrections') {
      return { success: true, correctionList: await listCorrections() };
    }
    if (action === 'all') {
      const [materialList, userList, correctionList] = await Promise.all([
        listMaterials(),
        listUsers(),
        listCorrections()
      ]);
      return {
        success: true,
        materialList,
        userList,
        correctionList
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
