const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const { buildContainsRegExp } = require('./search');
const {
  normalizeTemplateType,
  resolveTemplateCategory,
  buildLabelExportFileName,
  buildLabelExportRow,
  buildLabelExportWorkbook,
  sortLabelExportRecordsBySelection
} = require('./label-export-report');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

function buildQueryWhere(templateType, searchVal) {
  const conditions = [
    { status: 'in_stock' },
    { category: resolveTemplateCategory(templateType) }
  ];

  const searchRegex = buildContainsRegExp(db, searchVal);
  if (searchRegex) {
    conditions.push(_.or([
      { unique_code: searchRegex },
      { product_code: searchRegex },
      { material_name: searchRegex },
      { batch_number: searchRegex }
    ]));
  }

  return _.and(conditions);
}

function mapLabelListItem(item = {}) {
  const material = (item.material_info && item.material_info[0]) || {};
  return {
    _id: item._id,
    unique_code: String(item.unique_code || '').trim() || '--',
    product_code: String(item.product_code || material.product_code || '').trim() || '--',
    material_name: String(item.material_name || material.material_name || material.name || '').trim() || '--',
    batch_number: String(item.batch_number || '').trim(),
    category: String(item.category || material.category || '').trim() || 'chemical',
    create_time: item.create_time || null
  };
}

async function listLabelItems(data = {}) {
  const templateType = normalizeTemplateType(data.templateType);
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(data.pageSize) || 20));
  const where = buildQueryWhere(templateType, data.searchVal);

  const totalRes = await db.collection('inventory').where(where).count();
  const result = await db.collection('inventory').aggregate()
    .match(where)
    .lookup({
      from: 'materials',
      localField: 'material_id',
      foreignField: '_id',
      as: 'material_info'
    })
    .sort({
      create_time: -1,
      _id: -1
    })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .end();

  const list = (result.list || []).map(mapLabelListItem);
  const total = Number(totalRes.total) || list.length;

  return {
    success: true,
    list,
    total,
    isEnd: page * pageSize >= total
  };
}

async function exportLabelWorkbook(data = {}) {
  const templateType = normalizeTemplateType(data.templateType);
  const selectedIds = Array.isArray(data.selectedIds)
    ? data.selectedIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];

  if (!selectedIds.length) {
    return {
      success: false,
      msg: '请先勾选需要导出的标签'
    };
  }

  if (selectedIds.length > 200) {
    return {
      success: false,
      msg: '单次最多导出 200 个标签'
    };
  }

  const result = await db.collection('inventory').aggregate()
    .match(_.and([
      { _id: _.in(selectedIds) },
      { status: 'in_stock' },
      { category: resolveTemplateCategory(templateType) }
    ]))
    .lookup({
      from: 'materials',
      localField: 'material_id',
      foreignField: '_id',
      as: 'material_info'
    })
    .end();

  const records = sortLabelExportRecordsBySelection(result.list || [], selectedIds);
  if (records.length !== selectedIds.length) {
    return {
      success: false,
      msg: '部分标签已不在库或与当前模板类型不匹配，请刷新后重试'
    };
  }

  const rows = records.map((item) => buildLabelExportRow(templateType, item, {
    material: (item.material_info && item.material_info[0]) || {}
  }));
  const exportedAt = new Date();
  const workbook = await buildLabelExportWorkbook({
    templateType,
    exportedAt,
    rows
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = buildLabelExportFileName(templateType, exportedAt);
  const uploadRes = await cloud.uploadFile({
    cloudPath: `label-exports/${Date.now()}_${fileName}`,
    fileContent: Buffer.from(buffer)
  });

  return {
    success: true,
    fileID: uploadRes.fileID,
    fileName,
    msg: '生成成功'
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || '').trim();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可导出信息标签');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    if (action === 'list') {
      return listLabelItems(event.data || {});
    }

    if (action === 'export') {
      return exportLabelWorkbook(event.data || {});
    }

    return {
      success: false,
      msg: '未知操作'
    };
  } catch (error) {
    console.error('导出信息标签失败', error);
    return {
      success: false,
      msg: error.message || '导出失败'
    };
  }
};
