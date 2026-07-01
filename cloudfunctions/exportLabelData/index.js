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
const {
  buildNextLabelCodes,
  buildPreprintLabelRecords,
  buildPreprintLabelExportRow,
  assertPreprintPayload,
  parseLabelCodeNumber
} = require('./preprint-labels');

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

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

async function loadMaterialForPreprint(data = {}) {
  const materialId = normalizeText(data.materialId || data.material_id);
  const productCode = normalizeText(data.productCode || data.product_code);
  let query;

  if (materialId) {
    query = { _id: materialId };
  } else if (productCode) {
    query = { product_code: productCode };
  } else {
    throw new Error('请先选择需要打印标签的物料');
  }

  const res = await db.collection('materials').where(query).limit(1).get();
  const material = res.data && res.data[0];
  if (!material) {
    throw new Error('未找到对应物料主数据');
  }
  return material;
}

async function isLabelCodeUsed(transaction, code) {
  const inventoryRes = await transaction.collection('inventory').where({
    unique_code: code
  }).get();
  if (inventoryRes.data && inventoryRes.data.length > 0) {
    return true;
  }

  const preprintRes = await transaction.collection('preprinted_labels').where({
    unique_code: code
  }).get();
  return !!(preprintRes.data && preprintRes.data.length > 0);
}

async function allocatePreprintLabelCodes(transaction, count) {
  const counterRef = transaction.collection('system_counters').doc('label_code');
  const counterRes = await counterRef.get().catch(() => ({ data: null }));
  let cursor = Number(counterRes.data && counterRes.data.next_number) || 1;
  const labelCodes = [];

  while (labelCodes.length < count) {
    const candidate = buildNextLabelCodes({
      count: 1,
      existingCodes: labelCodes,
      startNumber: cursor
    })[0];
    cursor = parseLabelCodeNumber(candidate) + 1;
    if (await isLabelCodeUsed(transaction, candidate)) {
      continue;
    }
    labelCodes.push(candidate);
  }

  await counterRef.set({
    data: {
      next_number: cursor,
      update_time: db.serverDate()
    }
  });

  return labelCodes;
}

async function getPreprintRecordsByRequest(requestId, operatorOpenid) {
  const normalizedRequestId = normalizeText(requestId);
  if (!normalizedRequestId) {
    return [];
  }

  const res = await db.collection('preprinted_labels')
    .where({
      request_id: normalizedRequestId,
      operator_id: operatorOpenid
    })
    .orderBy('job_index', 'asc')
    .limit(200)
    .get();
  return res.data || [];
}

async function createPreprintJob(data = {}, operator = {}, operatorOpenid = '') {
  const requestId = normalizeText(data.requestId || data.request_id);
  const existingRequestRecords = await getPreprintRecordsByRequest(requestId, operatorOpenid);
  if (existingRequestRecords.length > 0) {
    const firstRecord = existingRequestRecords[0];
    return {
      success: true,
      job_id: firstRecord.job_id,
      records: existingRequestRecords,
      qr_content: firstRecord.qr_content,
      count: existingRequestRecords.length,
      reused: true,
      msg: '已复用本次生成记录'
    };
  }

  const templateType = normalizeTemplateType(data.templateType);
  const count = Number(data.count) || 0;
  const material = await loadMaterialForPreprint(data);
  const form = data.form || data;
  assertPreprintPayload({
    templateType,
    count,
    material,
    form
  });

  return db.runTransaction(async transaction => {
    const labelCodes = await allocatePreprintLabelCodes(transaction, count);
    const now = new Date();
    const records = buildPreprintLabelRecords({
      templateType,
      labelCodes,
      material,
      form,
      operatorOpenid,
      operatorName: operator.name || operator.nickname || '',
      now
    }).map(record => Object.assign({}, record, {
      request_id: requestId
    }));

    const resultRecords = [];
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const addRes = await transaction.collection('preprinted_labels').add({
        data: Object.assign({}, record, {
          create_time: db.serverDate(),
          update_time: db.serverDate()
        })
      });
      resultRecords.push(Object.assign({}, record, {
        _id: addRes && addRes._id
      }));
    }

    return {
      success: true,
      job_id: resultRecords[0] && resultRecords[0].job_id,
      records: resultRecords,
      count: resultRecords.length,
      msg: '生成成功'
    };
  });
}

async function exportPreprintJob(data = {}) {
  const jobId = normalizeText(data.jobId || data.job_id);
  const templateType = normalizeTemplateType(data.templateType);
  if (!jobId) {
    return {
      success: false,
      msg: '缺少预生成标签批次'
    };
  }

  const result = await db.collection('preprinted_labels')
    .where({
      job_id: jobId,
      template_type: templateType
    })
    .orderBy('job_index', 'asc')
    .limit(200)
    .get();
  const records = result.data || [];
  if (!records.length) {
    return {
      success: false,
      msg: '未找到可导出的预生成标签'
    };
  }

  const rows = records.map(buildPreprintLabelExportRow);
  const exportedAt = new Date();
  const workbook = await buildLabelExportWorkbook({
    templateType,
    exportedAt,
    rows
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = buildLabelExportFileName(templateType, exportedAt);
  const uploadRes = await cloud.uploadFile({
    cloudPath: `label-exports/preprint_${Date.now()}_${fileName}`,
    fileContent: Buffer.from(buffer)
  });

  return {
    success: true,
    fileID: uploadRes.fileID,
    fileName,
    msg: '生成成功'
  };
}

async function listPreprintJobs(data = {}) {
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(data.pageSize) || 20));
  const searchRegex = buildContainsRegExp(db, data.searchVal);
  const conditions = [];

  if (data.templateType) {
    conditions.push({ template_type: normalizeTemplateType(data.templateType) });
  }
  if (searchRegex) {
    conditions.push(_.or([
      { unique_code: searchRegex },
      { product_code: searchRegex },
      { material_name: searchRegex },
      { supplier_model: searchRegex },
      { sample_note: searchRegex }
    ]));
  }

  const where = conditions.length ? _.and(conditions) : {};
  const totalRes = await db.collection('preprinted_labels').where(where).count();
  const res = await db.collection('preprinted_labels')
    .where(where)
    .orderBy('create_time', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    success: true,
    list: res.data || [],
    total: Number(totalRes.total) || 0,
    isEnd: page * pageSize >= (Number(totalRes.total) || 0)
  };
}

async function voidPreprintLabels(data = {}, operatorOpenid = '') {
  const ids = Array.isArray(data.ids)
    ? data.ids.map(id => normalizeText(id)).filter(Boolean)
    : [];
  if (!ids.length) {
    return {
      success: false,
      msg: '请先选择需要作废的预生成标签'
    };
  }

  const result = await db.collection('preprinted_labels')
    .where({
      _id: _.in(ids),
      status: 'unused'
    })
    .get();
  const records = result.data || [];
  if (records.length !== ids.length) {
    return {
      success: false,
      msg: '只能作废未入库的预生成标签'
    };
  }

  await Promise.all(records.map(record => db.collection('preprinted_labels').doc(record._id).update({
    data: {
      status: 'voided',
      voided_by: operatorOpenid,
      voided_time: db.serverDate(),
      update_time: db.serverDate()
    }
  })));

  return {
    success: true,
    count: records.length,
    msg: '已作废'
  };
}

async function getPreprintLabel(data = {}) {
  const uniqueCode = normalizeText(data.uniqueCode || data.unique_code).toUpperCase();
  if (!uniqueCode) {
    return {
      success: false,
      msg: '缺少标签编号'
    };
  }

  const res = await db.collection('preprinted_labels')
    .where({ unique_code: uniqueCode })
    .limit(1)
    .get();
  const record = res.data && res.data[0];
  if (!record) {
    return {
      success: true,
      data: null,
      msg: '未找到预生成标签'
    };
  }
  if (record.status === 'voided') {
    return {
      success: false,
      status: 'voided',
      msg: '该预生成标签已作废，不能入库'
    };
  }
  if (record.status === 'used') {
    return {
      success: false,
      status: 'used',
      msg: '该预生成标签已入库，不能重复使用'
    };
  }

  return {
    success: true,
    data: record,
    msg: '已识别预生成标签'
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
    .limit(selectedIds.length)
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

    if (action === 'createPreprintJob') {
      return createPreprintJob(event.data || {}, operator || {}, OPENID);
    }

    if (action === 'listPreprintJobs') {
      return listPreprintJobs(event.data || {});
    }

    if (action === 'exportPreprintJob') {
      return exportPreprintJob(event.data || {});
    }

    if (action === 'voidPreprintLabels') {
      return voidPreprintLabels(event.data || {}, OPENID);
    }

    if (action === 'getPreprintLabel') {
      return getPreprintLabel(event.data || {});
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
