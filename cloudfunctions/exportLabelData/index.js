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
  buildPreprintRequestSignature,
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

async function getPreprintRecordsByJob(jobId, operatorOpenid, templateType = '') {
  const normalizedJobId = normalizeText(jobId);
  if (!normalizedJobId) {
    return [];
  }

  const where = {
    job_id: normalizedJobId,
    operator_id: operatorOpenid
  };
  if (templateType) {
    where.template_type = normalizeTemplateType(templateType);
  }

  const res = await db.collection('preprinted_labels')
    .where(where)
    .orderBy('job_index', 'asc')
    .limit(200)
    .get();
  return res.data || [];
}

async function preparePreprintJobVoid(previousJobId, operatorOpenid) {
  const jobId = normalizeText(previousJobId);
  if (!jobId) {
    return {
      ok: false,
      code: 'PREPRINT_ORIGINAL_ALREADY_CHANGED',
      msg: '原批次状态已变化，请刷新最近批次后重试'
    };
  }

  const records = await getPreprintRecordsByJob(jobId, operatorOpenid);
  if (!records.length) {
    return {
      ok: false,
      code: 'PREPRINT_ORIGINAL_ALREADY_CHANGED',
      msg: '原批次状态已变化，请刷新最近批次后重试'
    };
  }

  const usedRecords = records.filter(record => record.status === 'used');
  if (usedRecords.length > 0) {
    return {
      ok: false,
      code: 'PREPRINT_ORIGINAL_ALREADY_CHANGED',
      msg: '原批次已有标签入库，不能整体作废重做'
    };
  }

  const unusedIds = records
    .filter(record => record.status === 'unused')
    .map(record => record._id)
    .filter(Boolean);
  if (!unusedIds.length) {
    return {
      ok: false,
      code: 'PREPRINT_ORIGINAL_ALREADY_CHANGED',
      msg: '原批次状态已变化，请刷新最近批次后重试'
    };
  }

  return {
    ok: true,
    ids: unusedIds
  };
}

function buildPreprintJobSummary(records = []) {
  if (!records.length) {
    return null;
  }
  const sorted = records.slice().sort((left, right) => Number(left.job_index || 0) - Number(right.job_index || 0));
  const first = sorted[0] || {};
  const statusCounts = sorted.reduce((acc, record) => {
    const status = normalizeText(record.status) || 'unused';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const codes = sorted.map(record => normalizeText(record.unique_code)).filter(Boolean);
  const startCode = codes[0] || '';
  const endCode = codes[codes.length - 1] || startCode;

  return {
    job_id: first.job_id,
    template_type: first.template_type,
    material_id: first.material_id,
    product_code: first.product_code,
    material_name: first.material_name,
    supplier_model: first.supplier_model,
    supplier: first.supplier,
    sample_note: first.sample_note,
    request_id: first.request_id,
    request_signature: first.request_signature,
    create_time: first.create_time || null,
    count: sorted.length,
    unused_count: statusCounts.unused || 0,
    used_count: statusCounts.used || 0,
    voided_count: statusCounts.voided || 0,
    start_code: startCode,
    end_code: endCode,
    records: sorted
  };
}

async function exportPreprintRecords(templateType, records = []) {
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
    fileID: uploadRes.fileID,
    fileName
  };
}

async function createPreprintJob(data = {}, operator = {}, operatorOpenid = '') {
  const requestId = normalizeText(data.requestId || data.request_id);
  if (!requestId) {
    throw new Error('缺少本次生成请求编号，请刷新后重试');
  }
  const templateType = normalizeTemplateType(data.templateType);
  const count = Number(data.count) || 0;
  const material = await loadMaterialForPreprint(data);
  const form = data.form || data;
  const preprintMode = normalizeText(data.preprintMode || data.preprint_mode || 'normal') || 'normal';
  const requestSignature = buildPreprintRequestSignature({
    templateType,
    count,
    material,
    form
  });
  const existingRequestRecords = await getPreprintRecordsByRequest(requestId, operatorOpenid);
  if (existingRequestRecords.length > 0) {
    const firstRecord = existingRequestRecords[0];
    const existingSignature = normalizeText(firstRecord.request_signature);
    if (existingSignature && existingSignature !== requestSignature) {
      return {
        success: false,
        code: 'PREPRINT_REQUEST_CHANGED',
        msg: '本次表单内容已变化，请确认是作废重做还是另生成一批'
      };
    }
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

  const voidPlan = preprintMode === 'voidAndRecreate'
    ? await preparePreprintJobVoid(data.previousJobId || data.previous_job_id, operatorOpenid)
    : { ok: true, ids: [] };
  if (!voidPlan.ok) {
    return {
      success: false,
      code: voidPlan.code,
      msg: voidPlan.msg
    };
  }
  const voidBeforeCreateIds = voidPlan.ids || [];

  return db.runTransaction(async transaction => {
    for (let i = 0; i < voidBeforeCreateIds.length; i += 1) {
      const existingVoidRecord = await transaction.collection('preprinted_labels').doc(voidBeforeCreateIds[i]).get();
      if (!existingVoidRecord.data || existingVoidRecord.data.operator_id !== operatorOpenid || existingVoidRecord.data.status !== 'unused') {
        const error = new Error('原批次状态已变化，请刷新最近批次后重试');
        error.code = 'PREPRINT_ORIGINAL_ALREADY_CHANGED';
        throw error;
      }
      await transaction.collection('preprinted_labels').doc(voidBeforeCreateIds[i]).update({
        data: {
          status: 'voided',
          voided_by: operatorOpenid,
          voided_time: db.serverDate(),
          update_time: db.serverDate()
        }
      });
    }

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
      request_id: requestId,
      request_signature: requestSignature,
      exported: false
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
      request_signature: requestSignature,
      count: resultRecords.length,
      msg: '生成成功'
    };
  });
}

async function createAndExportPreprintJob(data = {}, operator = {}, operatorOpenid = '') {
  const createResult = await createPreprintJob(data, operator, operatorOpenid);
  if (!createResult.success) {
    return createResult;
  }

  const templateType = normalizeTemplateType(data.templateType);
  let exportResult;
  try {
    exportResult = await exportPreprintRecords(templateType, createResult.records || []);
    const ids = (createResult.records || []).map(record => record._id).filter(Boolean);
    if (ids.length) {
      await Promise.all(ids.map(id => db.collection('preprinted_labels').doc(id).update({
        data: {
          exported: true,
          exported_time: db.serverDate(),
          update_time: db.serverDate()
        }
      })));
    }
  } catch (error) {
    return {
      success: false,
      code: 'PREPRINT_EXPORT_FAILED',
      job_id: createResult.job_id,
      records: createResult.records,
      request_signature: createResult.request_signature,
      reused: !!createResult.reused,
      count: createResult.count,
      msg: error.message || '标签已生成，但 Excel 导出失败，请在最近打印批次中重新导出'
    };
  }

  return {
    success: true,
    job_id: createResult.job_id,
    records: createResult.records,
    request_signature: createResult.request_signature,
    reused: !!createResult.reused,
    fileID: exportResult.fileID,
    fileName: exportResult.fileName,
    count: createResult.count,
    msg: createResult.reused ? '已复用本批并重新导出' : '生成并导出成功'
  };
}

async function exportPreprintJob(data = {}, operatorOpenid = '') {
  const jobId = normalizeText(data.jobId || data.job_id);
  const templateType = normalizeTemplateType(data.templateType);
  if (!jobId) {
    return {
      success: false,
      msg: '缺少预生成标签批次'
    };
  }

  const records = await getPreprintRecordsByJob(jobId, operatorOpenid, templateType);
  if (!records.length) {
    return {
      success: false,
      msg: '未找到可导出的预生成标签'
    };
  }

  const exportResult = await exportPreprintRecords(templateType, records);

  return {
    success: true,
    fileID: exportResult.fileID,
    fileName: exportResult.fileName,
    msg: '生成成功'
  };
}

async function listPreprintJobs(data = {}, operatorOpenid = '') {
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(data.pageSize) || 20));
  const searchRegex = buildContainsRegExp(db, data.searchVal);
  const conditions = operatorOpenid ? [{ operator_id: operatorOpenid }] : [];

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

async function listRecentPreprintJobs(data = {}, operatorOpenid = '') {
  const pageSize = Math.max(1, Math.min(20, Number(data.pageSize) || 5));
  const templateType = data.templateType ? normalizeTemplateType(data.templateType) : '';
  const jobIds = [];
  const seen = new Set();
  const maxPages = 10;

  for (let page = 1; page <= maxPages && jobIds.length < pageSize; page += 1) {
    const where = {
      operator_id: operatorOpenid
    };
    if (templateType) {
      where.template_type = templateType;
    }
    const res = await db.collection('preprinted_labels')
      .where(where)
      .orderBy('create_time', 'desc')
      .skip((page - 1) * 100)
      .limit(100)
      .get();
    const rows = res.data || [];
    if (!rows.length) {
      break;
    }
    rows.forEach((record) => {
      if (record.status === 'voided') {
        return;
      }
      const jobId = normalizeText(record.job_id);
      if (jobId && !seen.has(jobId) && jobIds.length < pageSize) {
        seen.add(jobId);
        jobIds.push(jobId);
      }
    });
  }

  const summaries = await Promise.all(jobIds.map(async jobId => {
    const records = await getPreprintRecordsByJob(jobId, operatorOpenid, templateType);
    const summary = buildPreprintJobSummary(records);
    if (!summary || summary.unused_count + summary.used_count <= 0) {
      return null;
    }
    return summary;
  }));

  const list = summaries
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = left.create_time ? new Date(left.create_time).getTime() : 0;
      const rightTime = right.create_time ? new Date(right.create_time).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, pageSize);

  return {
    success: true,
    list,
    total: list.length
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
      operator_id: operatorOpenid,
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

    if (action === 'createAndExportPreprintJob') {
      return createAndExportPreprintJob(event.data || {}, operator || {}, OPENID);
    }

    if (action === 'listPreprintJobs') {
      return listPreprintJobs(event.data || {}, OPENID);
    }

    if (action === 'listRecentPreprintJobs') {
      return listRecentPreprintJobs(event.data || {}, OPENID);
    }

    if (action === 'exportPreprintJob') {
      return exportPreprintJob(event.data || {}, OPENID);
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
      code: error.code,
      msg: error.message || '导出失败'
    };
  }
};
