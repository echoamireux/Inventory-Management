const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { assertActiveUserAccess } = require('./auth');
const { writeAuditEvent } = require('./audit-events');
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
const {
  buildPreprintJobId,
  buildPreprintLabelDocumentId,
  chunkPreprintItems,
  assertPreprintJobConsumable,
  assertPreprintJobVoidable,
  isMissingDocumentError
} = require('./preprint-jobs');
const {
  loadTestMaterialIdentityForSelection
} = require('./test-material-identities');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const CHEMICAL_TEMPLATE_TYPES = ['chemical', 'chemical_std', 'chemical_mini'];
const MAX_DAILY_PREPRINT_LABELS = 500;
const MAX_PREPRINT_TASKS_PER_10_MINUTES = 5;
const PREPRINT_BURST_WINDOW_MS = 10 * 60 * 1000;

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

function buildOperatorSnapshot(operator = {}, openid = '') {
  return Object.assign({}, operator || {}, {
    _openid: openid || operator._openid || operator.openid || ''
  });
}

function buildPreprintJobAuditLabel(job = {}) {
  const labelCodes = Array.isArray(job.label_codes) ? job.label_codes : [];
  const startCode = labelCodes[0] || '';
  const endCode = labelCodes[labelCodes.length - 1] || startCode;
  return [job.product_code, startCode && endCode && startCode !== endCode ? `${startCode}-${endCode}` : startCode]
    .filter(Boolean)
    .join(' ');
}

function buildPreprintJobAuditDetail(job = {}, extra = {}) {
  const labelCodes = Array.isArray(job.label_codes) ? job.label_codes : [];
  return Object.assign({
    template_type: job.template_type || '',
    product_code: job.product_code || '',
    material_name: job.material_name || '',
    material_id: job.material_id || '',
    count: Number(job.count) || labelCodes.length,
    start_code: labelCodes[0] || '',
    end_code: labelCodes[labelCodes.length - 1] || labelCodes[0] || '',
    export_status: job.export_status || '',
    status: job.status || ''
  }, extra || {});
}

async function writePreprintAudit(action, job = {}, operator = {}, operatorOpenid = '', detail = {}) {
  await writeAuditEvent(db, db, {
    domain: 'preprint',
    action,
    operator: buildOperatorSnapshot(operator, operatorOpenid),
    target: {
      type: 'preprint_job',
      id: job.job_id || '',
      label: buildPreprintJobAuditLabel(job)
    },
    detail: buildPreprintJobAuditDetail(job, detail)
  });
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

function isRetryablePreprintTransactionConflict(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '').toLowerCase();
  return /transaction|conflict|version|事务|冲突|版本/.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatCstDateKey(date = new Date()) {
  const cst = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildPreprintDailyUsageId(operatorOpenid, dateKey) {
  return crypto
    .createHash('sha256')
    .update(`${operatorOpenid}:${dateKey}`)
    .digest('hex')
    .slice(0, 32);
}

async function consumePreprintQuota(transaction, operatorOpenid, count) {
  const now = new Date();
  const nowTime = now.getTime();
  const dateKey = formatCstDateKey(now);
  const usageId = buildPreprintDailyUsageId(operatorOpenid, dateKey);
  const usageRef = transaction.collection('preprint_daily_usage').doc(usageId);
  const currentUsage = await getDocumentData(usageRef) || {};
  const currentTotal = Number(currentUsage.total_count) || 0;
  const recentTaskTimes = (currentUsage.recent_task_times || [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && nowTime - value < PREPRINT_BURST_WINDOW_MS);

  if (currentTotal + count > MAX_DAILY_PREPRINT_LABELS) {
    throw new Error(`每人每天最多预生成 ${MAX_DAILY_PREPRINT_LABELS} 个标签，请明天再生成或联系管理员`);
  }
  if (recentTaskTimes.length >= MAX_PREPRINT_TASKS_PER_10_MINUTES) {
    throw new Error(`10 分钟内最多创建 ${MAX_PREPRINT_TASKS_PER_10_MINUTES} 次标签预生成任务，请稍后再试`);
  }

  await usageRef.set({
    data: {
      operator_id: operatorOpenid,
      date_key: dateKey,
      total_count: currentTotal + count,
      recent_task_times: recentTaskTimes.concat(nowTime),
      updated_at: db.serverDate()
    }
  });
}

async function runPreprintTransactionWithRetry(operation) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryablePreprintTransactionConflict(error) || attempt >= 3) {
        throw error;
      }
      await wait(attempt * 80);
    }
  }
  throw lastError;
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
  if (material.status !== 'active') {
    throw new Error('所选物料未启用，不能预生成标签');
  }
  return material;
}

async function loadUsedLabelCodes(transaction, collectionName, codes = []) {
  const used = new Set();
  for (const codeChunk of chunkPreprintItems(codes, 20)) {
    const res = await transaction.collection(collectionName).where({
      unique_code: _.in(codeChunk)
    }).get();
    (res.data || []).forEach(record => {
      const code = normalizeText(record.unique_code).toUpperCase();
      if (code) {
        used.add(code);
      }
    });
  }
  return used;
}

async function allocatePreprintLabelCodes(transaction, count) {
  const counterRef = transaction.collection('system_counters').doc('label_code');
  const counterData = await getDocumentData(counterRef);
  let cursor = Number(counterData && counterData.next_number) || 1;
  const labelCodes = [];

  while (labelCodes.length < count) {
    const remainingCodeSpace = 1000000 - cursor;
    if (remainingCodeSpace <= 0) {
      throw new Error('标签编号已达到上限，请联系管理员处理');
    }
    const candidateCount = Math.min(
      remainingCodeSpace,
      200,
      Math.max(20, count - labelCodes.length)
    );
    const candidates = buildNextLabelCodes({
      count: candidateCount,
      existingCodes: [],
      startNumber: cursor
    });
    cursor = parseLabelCodeNumber(candidates[candidates.length - 1]) + 1;
    const inventoryCodes = await loadUsedLabelCodes(transaction, 'inventory', candidates);
    const historicalPreprintCodes = await loadUsedLabelCodes(transaction, 'preprinted_labels', candidates);
    candidates.forEach((candidate) => {
      if (
        labelCodes.length < count
        && !inventoryCodes.has(candidate)
        && !historicalPreprintCodes.has(candidate)
      ) {
        labelCodes.push(candidate);
      }
    });
  }

  await counterRef.set({
    data: {
      next_number: cursor,
      update_time: db.serverDate()
    }
  });

  return labelCodes;
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
    const normalizedTemplateType = normalizeTemplateType(templateType);
    where.template_type = normalizedTemplateType === 'chemical'
      ? _.in(CHEMICAL_TEMPLATE_TYPES)
      : normalizedTemplateType;
  }

  const res = await db.collection('preprinted_labels')
    .where(where)
    .orderBy('job_index', 'asc')
    .limit(200)
    .get();
  return res.data || [];
}

async function exportPreprintRecords(templateType, records = [], options = {}) {
  const rows = records.map(buildPreprintLabelExportRow);
  if (!rows.length) {
    throw new Error('当前批次没有可导出的标签数据');
  }
  const exportedAt = new Date();
  const workbook = await buildLabelExportWorkbook({
    templateType,
    exportedAt,
    rows
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = buildLabelExportFileName(templateType, exportedAt, {
    startLabelCode: rows[0] && rows[0]['标签编号']
  });
  const jobId = normalizeText(options.jobId || options.job_id);
  const operatorId = normalizeText(options.operatorId || options.operator_id) || 'legacy';
  const uploadRes = await cloud.uploadFile({
    cloudPath: `label-exports/${operatorId}/preprint/${jobId || 'legacy'}.xlsx`,
    fileContent: Buffer.from(buffer)
  });

  return {
    fileID: uploadRes.fileID,
    fileName
  };
}

async function updatePreprintJobExportState(jobId, operatorOpenid, exportStatus, data = {}) {
  const normalizedJobId = normalizeText(jobId);
  if (!normalizedJobId) {
    return false;
  }

  return runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
    const jobRef = transaction.collection('preprint_jobs').doc(normalizedJobId);
    const job = await getDocumentData(jobRef);
    if (!job || job.operator_id !== operatorOpenid) {
      throw new Error('预生成标签任务不存在或无权操作');
    }
    if (job.status !== 'ready') {
      const error = new Error('预生成标签批次状态已变化，导出结果已失效');
      error.code = 'PREPRINT_JOB_STATE_CHANGED';
      throw error;
    }
    await jobRef.update({
      data: {
        export_status: exportStatus,
        file_id: normalizeText(data.fileID || data.file_id),
        file_name: normalizeText(data.fileName || data.file_name),
        export_error: normalizeText(data.error || data.export_error),
        exported_at: exportStatus === 'exported' ? db.serverDate() : null,
        updated_at: db.serverDate()
      }
    });
    return true;
  }));
}

async function getDocumentData(documentReference) {
  try {
    const res = await documentReference.get();
    return res.data || null;
  } catch (error) {
    if (isMissingDocumentError(error)) {
      return null;
    }
    throw error;
  }
}

async function getPreprintJobById(jobId, operatorOpenid = '') {
  const normalizedJobId = normalizeText(jobId);
  if (!normalizedJobId) {
    return null;
  }
  const job = await getDocumentData(db.collection('preprint_jobs').doc(normalizedJobId));
  if (!job || (operatorOpenid && job.operator_id !== operatorOpenid)) {
    return null;
  }
  return job;
}

function buildPreprintJobMaterial(job = {}) {
  return {
    _id: job.material_id,
    product_code: job.product_code,
    material_name: job.material_name,
    category: job.category,
    subcategory_key: job.subcategory_key || '',
    sub_category: job.sub_category || '',
    is_test_material: !!job.is_test_material,
    specs: job.material_specs || {}
  };
}

function buildPreprintJobRecords(job = {}) {
  const form = job.form_snapshot || {};
  return buildPreprintLabelRecords({
    templateType: job.template_type,
    labelCodes: job.label_codes || [],
    material: buildPreprintJobMaterial(job),
    form,
    operatorOpenid: job.operator_id,
    operatorName: job.operator_name || '',
    now: job.created_at || new Date(),
    jobId: job.job_id
  }).map(record => Object.assign({}, record, {
    _id: buildPreprintLabelDocumentId(job.job_id, record.job_index),
    request_id: job.request_id,
    request_signature: job.request_signature,
    exported: job.export_status === 'exported'
  }));
}

async function reservePreprintJob({
  requestId,
  requestSignature,
  templateType,
  count,
  material,
  form,
  operator,
  operatorOpenid
}) {
  const jobId = buildPreprintJobId(operatorOpenid, requestId);
  return runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
    const jobRef = transaction.collection('preprint_jobs').doc(jobId);
    const existingJob = await getDocumentData(jobRef);
    if (existingJob) {
      if (existingJob.request_signature !== requestSignature) {
        return {
          success: false,
          code: 'PREPRINT_REQUEST_CHANGED',
          msg: '本次表单内容已变化，请确认是作废重做还是另生成一批'
        };
      }
      if (existingJob.status === 'voiding' || existingJob.status === 'voided') {
        return {
          success: false,
          code: 'PREPRINT_JOB_VOIDED',
          msg: '本批标签已作废，不能重新生成或导出'
        };
      }
      return { success: true, job: existingJob, reused: true };
    }

    const currentMaterialRes = await transaction.collection('materials').doc(material._id).get();
    const currentMaterial = currentMaterialRes.data;
    if (!currentMaterial || currentMaterial.status !== 'active') {
      throw new Error('所选物料未启用，不能预生成标签');
    }
    const identityValidation = await loadTestMaterialIdentityForSelection(transaction, currentMaterial, form);
    if (!identityValidation.ok) {
      throw new Error(identityValidation.msg);
    }
    const currentForm = currentMaterial.is_test_material
      ? {
        ...form,
        supplier: normalizeText(form.supplier) || identityValidation.supplier || '',
        supplier_model: identityValidation.supplier_model,
        supplier_model_key: identityValidation.supplier_model_key
      }
      : form;
    const currentSignature = buildPreprintRequestSignature({
      templateType,
      count,
      material: currentMaterial,
      form: currentForm
    });
    if (currentSignature !== requestSignature) {
      throw new Error('物料主数据已变化，请刷新物料后重新生成标签');
    }

    await consumePreprintQuota(transaction, operatorOpenid, count);
    const labelCodes = await allocatePreprintLabelCodes(transaction, count);
    const job = {
      request_id: requestId,
      request_signature: requestSignature,
      operator_id: operatorOpenid,
      operator_name: operator.name || operator.nickname || '',
      job_id: jobId,
      template_type: templateType,
      material_id: currentMaterial._id,
      product_code: currentMaterial.product_code,
      material_name: currentMaterial.material_name || currentMaterial.name || '',
      category: currentMaterial.category,
      subcategory_key: currentMaterial.subcategory_key || '',
      sub_category: currentMaterial.sub_category || '',
      is_test_material: !!currentMaterial.is_test_material,
      material_specs: currentMaterial.specs || {},
      form_snapshot: {
        supplier_model: normalizeText(currentForm.supplier_model),
        supplier_model_key: normalizeText(currentForm.supplier_model_key),
        supplier: normalizeText(currentForm.supplier),
        sample_note: normalizeText(currentForm.sample_note),
        thickness_um: currentForm.thickness_um,
        width_mm: currentForm.width_mm
      },
      count,
      label_codes: labelCodes,
      status: 'creating',
      export_status: 'pending',
      used_count: 0,
      file_id: '',
      file_name: '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    };
    await jobRef.set({ data: job });
    return { success: true, job, reused: false };
  }));
}

async function writePreprintJobLabels(job = {}) {
  const records = buildPreprintJobRecords(job);
  for (const recordChunk of chunkPreprintItems(records, 20)) {
    await runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
      const currentJob = await getDocumentData(
        transaction.collection('preprint_jobs').doc(job.job_id)
      );
      if (!currentJob || currentJob.operator_id !== job.operator_id) {
        throw new Error('预生成标签任务不存在');
      }
      if (currentJob.status === 'ready') {
        return;
      }
      if (currentJob.status !== 'creating') {
        throw new Error('预生成标签任务状态已变化，不能继续写入标签');
      }

      for (const record of recordChunk) {
        const { _id, ...recordData } = record;
        const recordRef = transaction.collection('preprinted_labels').doc(_id);
        const existingRecord = await getDocumentData(recordRef);
        if (existingRecord) {
          const sameReservation = existingRecord.job_id === job.job_id
            && existingRecord.operator_id === job.operator_id
            && existingRecord.unique_code === record.unique_code;
          if (!sameReservation || existingRecord.status !== 'unused') {
            throw new Error(`标签 ${record.unique_code} 状态已变化，恢复任务不能覆盖`);
          }
          continue;
        }

        await recordRef.set({
          data: Object.assign({}, recordData, {
            create_time: record.create_time || db.serverDate(),
            update_time: db.serverDate()
          })
        });
      }
    }));
  }
  return records;
}

async function finalizePreprintJob(jobId, operatorOpenid) {
  return runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
    const jobRef = transaction.collection('preprint_jobs').doc(jobId);
    const job = await getDocumentData(jobRef);
    if (!job || job.operator_id !== operatorOpenid) {
      throw new Error('预生成标签任务不存在');
    }
    if (job.status === 'ready') {
      return job;
    }
    if (job.status !== 'creating') {
      throw new Error('预生成标签任务状态已变化，不能完成生成');
    }
    await jobRef.update({
      data: {
        status: 'ready',
        updated_at: db.serverDate()
      }
    });
    return Object.assign({}, job, { status: 'ready' });
  }));
}

async function ensurePreprintJobReady(job = {}, operatorOpenid = '') {
  let currentJob = job;
  if (currentJob.status === 'creating') {
    await writePreprintJobLabels(currentJob);
    currentJob = await finalizePreprintJob(currentJob.job_id, operatorOpenid);
  }
  assertPreprintJobConsumable(currentJob);
  const records = await getPreprintRecordsByJob(currentJob.job_id, operatorOpenid, currentJob.template_type);
  if (records.length !== Number(currentJob.count)) {
    throw new Error('预生成标签任务数据不完整，请使用原请求重试恢复');
  }
  return { job: currentJob, records };
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
  const identityValidation = await loadTestMaterialIdentityForSelection(db, material, form);
  if (!identityValidation.ok) {
    throw new Error(identityValidation.msg);
  }
  const normalizedForm = material.is_test_material
    ? {
      ...form,
      supplier: normalizeText(form.supplier) || identityValidation.supplier || '',
      supplier_model: identityValidation.supplier_model,
      supplier_model_key: identityValidation.supplier_model_key
    }
    : form;
  const preprintMode = normalizeText(data.preprintMode || data.preprint_mode || 'normal') || 'normal';
  const requestSignature = buildPreprintRequestSignature({
    templateType,
    count,
    material,
    form: normalizedForm
  });

  if (preprintMode === 'voidAndRecreate') {
    const previousJobId = normalizeText(data.previousJobId || data.previous_job_id);
    const voidResult = await voidPreprintLabels({ jobId: previousJobId }, operatorOpenid, operator);
    if (!voidResult.success) {
      return {
        success: false,
        code: 'PREPRINT_ORIGINAL_ALREADY_CHANGED',
        msg: voidResult.msg || '原批次状态已变化，请刷新最近批次后重试'
      };
    }
  }

  const reserveResult = await reservePreprintJob({
    requestId,
    requestSignature,
    templateType,
    count,
    material,
    form: normalizedForm,
    operator,
    operatorOpenid
  });
  if (!reserveResult.success) {
    return reserveResult;
  }

  const readyResult = await ensurePreprintJobReady(reserveResult.job, operatorOpenid);
  if (!reserveResult.reused) {
    await writePreprintAudit('create', readyResult.job, operator, operatorOpenid, {
      note: '标签预打印创建'
    });
  }
  return {
    success: true,
    job_id: readyResult.job.job_id,
    records: readyResult.records,
    request_signature: readyResult.job.request_signature,
    count: readyResult.records.length,
    reused: !!reserveResult.reused,
    msg: reserveResult.reused ? '已复用本次生成记录' : '生成成功'
  };
}

async function createAndExportPreprintJob(data = {}, operator = {}, operatorOpenid = '') {
  const createResult = await createPreprintJob(data, operator, operatorOpenid);
  if (!createResult.success) {
    return createResult;
  }

  const templateType = normalizeTemplateType(data.templateType);
  let exportResult;
  try {
    exportResult = await exportPreprintRecords(templateType, createResult.records || [], {
      jobId: createResult.job_id,
      operatorId: operatorOpenid
    });
    await updatePreprintJobExportState(createResult.job_id, operatorOpenid, 'exported', exportResult);
    const auditJob = await getPreprintJobById(createResult.job_id, operatorOpenid);
    await writePreprintAudit('export', auditJob || {
      job_id: createResult.job_id,
      template_type: templateType,
      label_codes: (createResult.records || []).map(item => item.unique_code),
      count: createResult.count,
      product_code: createResult.records && createResult.records[0] && createResult.records[0].product_code,
      material_name: createResult.records && createResult.records[0] && createResult.records[0].material_name,
      export_status: 'exported'
    }, operator, operatorOpenid, {
      file_id: exportResult.fileID,
      file_name: exportResult.fileName,
      note: '标签 Excel 导出'
    });
  } catch (error) {
    await updatePreprintJobExportState(createResult.job_id, operatorOpenid, 'failed', {
      error: error.message || '标签 Excel 导出失败'
    }).catch(() => {});
    const auditJob = await getPreprintJobById(createResult.job_id, operatorOpenid).catch(() => null);
    await writePreprintAudit('export_failed', auditJob || {
      job_id: createResult.job_id,
      template_type: templateType,
      label_codes: (createResult.records || []).map(item => item.unique_code),
      count: createResult.count,
      product_code: createResult.records && createResult.records[0] && createResult.records[0].product_code,
      material_name: createResult.records && createResult.records[0] && createResult.records[0].material_name,
      export_status: 'failed'
    }, operator, operatorOpenid, {
      error: error.message || '标签 Excel 导出失败',
      note: '标签 Excel 导出失败'
    }).catch(() => {});
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

async function exportPreprintJob(data = {}, operatorOpenid = '', operator = {}) {
  const jobId = normalizeText(data.jobId || data.job_id);
  const templateType = normalizeTemplateType(data.templateType);
  if (!jobId) {
    return {
      success: false,
      msg: '缺少预生成标签批次'
    };
  }

  const job = await getPreprintJobById(jobId, operatorOpenid);
  if (job && job.status !== 'ready') {
    if (job.status === 'voided' || job.status === 'voiding') {
      return { success: false, msg: '本批标签已作废，不能重新导出' };
    }
    return { success: false, msg: '本批标签尚未生成完成，请使用原请求重试恢复' };
  }

  const effectiveTemplateType = job ? job.template_type : templateType;
  const records = await getPreprintRecordsByJob(jobId, operatorOpenid, effectiveTemplateType);
  if (!records.length) {
    return {
      success: false,
      msg: '未找到可导出的预生成标签'
    };
  }

  let exportResult;
  try {
    exportResult = await exportPreprintRecords(effectiveTemplateType, records, {
      jobId,
      operatorId: operatorOpenid
    });
    if (job) {
      await updatePreprintJobExportState(jobId, operatorOpenid, 'exported', exportResult);
    }
    await writePreprintAudit('export', job || {
      job_id: jobId,
      template_type: effectiveTemplateType,
      label_codes: records.map(item => item.unique_code),
      count: records.length,
      product_code: records[0] && records[0].product_code,
      material_name: records[0] && records[0].material_name,
      export_status: 'exported'
    }, operator, operatorOpenid, {
      file_id: exportResult.fileID,
      file_name: exportResult.fileName,
      note: '标签 Excel 重新导出'
    });
  } catch (error) {
    if (job) {
      await updatePreprintJobExportState(jobId, operatorOpenid, 'failed', {
        error: error.message || '标签 Excel 导出失败'
      }).catch(() => {});
    }
    await writePreprintAudit('export_failed', job || {
      job_id: jobId,
      template_type: effectiveTemplateType,
      label_codes: records.map(item => item.unique_code),
      count: records.length,
      product_code: records[0] && records[0].product_code,
      material_name: records[0] && records[0].material_name,
      export_status: 'failed'
    }, operator, operatorOpenid, {
      error: error.message || '标签 Excel 导出失败',
      note: '标签 Excel 导出失败'
    }).catch(() => {});
    throw error;
  }

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
    const normalizedTemplateType = normalizeTemplateType(data.templateType);
    conditions.push({
      template_type: normalizedTemplateType === 'chemical'
        ? _.in(CHEMICAL_TEMPLATE_TYPES)
        : normalizedTemplateType
    });
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
  const where = { operator_id: operatorOpenid };
  if (templateType) {
    where.template_type = templateType === 'chemical'
      ? _.in(CHEMICAL_TEMPLATE_TYPES)
      : templateType;
  }
  const jobs = [];
  const scanSize = 20;
  let skip = 0;
  while (jobs.length < pageSize) {
    const result = await db.collection('preprint_jobs')
      .where(where)
      .orderBy('created_at', 'desc')
      .skip(skip)
      .limit(scanSize)
      .get();
    const batch = result.data || [];
    jobs.push(...batch.filter(job => job.status !== 'voided').slice(0, pageSize - jobs.length));
    if (batch.length < scanSize) {
      break;
    }
    skip += scanSize;
  }
  const list = await Promise.all(jobs.map(async (job) => {
    const records = await getPreprintRecordsByJob(job.job_id, operatorOpenid, job.template_type);
    const statusCounts = records.reduce((counts, record) => {
      const status = normalizeText(record.status) || 'unused';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const labelCodes = Array.isArray(job.label_codes) ? job.label_codes : [];
    return {
      job_id: job.job_id,
      template_type: job.template_type,
      material_id: job.material_id,
      product_code: job.product_code,
      material_name: job.material_name,
      category: job.category,
      subcategory_key: job.subcategory_key || '',
      sub_category: job.sub_category || '',
      is_test_material: !!job.is_test_material,
      material_specs: job.material_specs || {},
      form_snapshot: job.form_snapshot || {},
      supplier_model: job.form_snapshot && job.form_snapshot.supplier_model,
      supplier: job.form_snapshot && job.form_snapshot.supplier,
      sample_note: job.form_snapshot && job.form_snapshot.sample_note,
      request_id: job.request_id,
      request_signature: job.request_signature,
      create_time: job.created_at || null,
      status: job.status,
      export_status: job.export_status,
      count: Number(job.count) || labelCodes.length,
      unused_count: statusCounts.unused || 0,
      used_count: Number(job.used_count) || statusCounts.used || 0,
      voided_count: statusCounts.voided || 0,
      start_code: labelCodes[0] || '',
      end_code: labelCodes[labelCodes.length - 1] || labelCodes[0] || '',
      records
    };
  }));

  return {
    success: true,
    list,
    total: list.length
  };
}

async function voidPreprintLabels(data = {}, operatorOpenid = '', operator = {}) {
  const jobId = normalizeText(data.jobId || data.job_id);
  if (!jobId) {
    return {
      success: false,
      msg: '缺少需要作废的预生成标签批次'
    };
  }

  const job = await getPreprintJobById(jobId, operatorOpenid);
  if (job) {
    try {
      const stateResult = await runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
        const jobRef = transaction.collection('preprint_jobs').doc(jobId);
        const currentJob = await getDocumentData(jobRef);
        if (!currentJob) {
          throw new Error('预生成标签批次不存在');
        }
        assertPreprintJobVoidable(currentJob, operatorOpenid);
        if (currentJob.status === 'voided') {
          return { alreadyVoided: true };
        }
        if (currentJob.status === 'creating' || currentJob.status === 'ready') {
          await jobRef.update({
            data: {
              status: 'voiding',
              updated_at: db.serverDate()
            }
          });
        }
        return { alreadyVoided: false };
      }));
      if (stateResult.alreadyVoided) {
        return { success: true, count: Number(job.count) || 0, msg: '本批标签已作废' };
      }
    } catch (error) {
      return { success: false, msg: error.message };
    }

    const expectedRecords = buildPreprintJobRecords(job);
    for (const recordChunk of chunkPreprintItems(expectedRecords, 20)) {
      await runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
        const currentJob = await getDocumentData(
          transaction.collection('preprint_jobs').doc(jobId)
        );
        if (!currentJob) {
          throw new Error('预生成标签批次不存在');
        }
        assertPreprintJobVoidable(currentJob, operatorOpenid);
        if (currentJob.status === 'voided') {
          return;
        }
        if (currentJob.status !== 'voiding') {
          throw new Error('预生成标签批次状态已变化，不能继续作废');
        }

        for (const record of recordChunk) {
          const { _id, ...recordData } = record;
          const recordRef = transaction.collection('preprinted_labels').doc(_id);
          const currentRecord = await getDocumentData(recordRef);
          if (currentRecord) {
            if (currentRecord.operator_id !== operatorOpenid || currentRecord.job_id !== jobId) {
              throw new Error('原批次状态已变化，请刷新最近批次后重试');
            }
            if (currentRecord.status === 'used') {
              throw new Error('该批次已有标签入库，不能整体作废');
            }
            if (currentRecord.status === 'unused') {
              await recordRef.update({
                data: {
                  status: 'voided',
                  voided_by: operatorOpenid,
                  voided_time: db.serverDate(),
                  update_time: db.serverDate()
                }
              });
            }
            continue;
          }

          await recordRef.set({
            data: Object.assign({}, recordData, {
              status: 'voided',
              voided_by: operatorOpenid,
              voided_time: db.serverDate(),
              create_time: record.create_time || db.serverDate(),
              update_time: db.serverDate()
            })
          });
        }
      }));
    }

    await runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
      const jobRef = transaction.collection('preprint_jobs').doc(jobId);
      const currentJob = await getDocumentData(jobRef);
      if (!currentJob) {
        throw new Error('预生成标签批次不存在');
      }
      assertPreprintJobVoidable(currentJob, operatorOpenid);
      await jobRef.update({
        data: {
          status: 'voided',
          export_status: currentJob.export_status,
          voided_by: operatorOpenid,
          voided_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    }));

    await writePreprintAudit('void', job, operator, operatorOpenid, {
      note: '预生成标签批次作废'
    });

    return {
      success: true,
      count: expectedRecords.length,
      msg: '已作废'
    };
  }

  const records = await getPreprintRecordsByJob(jobId, operatorOpenid);
  if (!records.length) {
    return { success: false, msg: '未找到需要作废的预生成标签批次' };
  }
  if (records.some(record => record.status === 'used')) {
    return { success: false, msg: '该批次已有标签入库，不能整体作废' };
  }

  for (const recordChunk of chunkPreprintItems(records, 20)) {
    await runPreprintTransactionWithRetry(() => db.runTransaction(async (transaction) => {
      for (const record of recordChunk) {
        const recordRef = transaction.collection('preprinted_labels').doc(record._id);
        const currentRecord = await getDocumentData(recordRef);
        if (!currentRecord || currentRecord.operator_id !== operatorOpenid || currentRecord.job_id !== jobId) {
          throw new Error('原批次状态已变化，请刷新最近批次后重试');
        }
        if (currentRecord.status === 'used') {
          throw new Error('该批次已有标签入库，不能整体作废');
        }
        if (currentRecord.status === 'unused') {
          await recordRef.update({
            data: {
              status: 'voided',
              voided_by: operatorOpenid,
              voided_time: db.serverDate(),
              update_time: db.serverDate()
            }
          });
        }
      }
    }));
  }

  await writePreprintAudit('void', {
    job_id: jobId,
    template_type: records[0] && records[0].template_type,
    label_codes: records.map(item => item.unique_code),
    count: records.length,
    product_code: records[0] && records[0].product_code,
    material_name: records[0] && records[0].material_name,
    status: 'voided'
  }, operator, operatorOpenid, {
    note: '旧预生成标签批次作废'
  });

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
  if (record.job_id) {
    const job = await getPreprintJobById(record.job_id);
    if (job) {
      try {
        assertPreprintJobConsumable(job);
      } catch (error) {
        return {
          success: false,
          status: job.status,
          msg: error.message
        };
      }
    }
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

async function exportLabelWorkbook(data = {}, operatorOpenid = '') {
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
  const fileName = buildLabelExportFileName(templateType, exportedAt, {
    startLabelCode: rows[0] && rows[0]['标签编号']
  });
  const uploadRes = await cloud.uploadFile({
    cloudPath: `label-exports/${operatorOpenid}/reprint/${templateType}/current.xlsx`,
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
      return await listLabelItems(event.data || {});
    }

    if (action === 'export') {
      return await exportLabelWorkbook(event.data || {}, OPENID);
    }

    if (action === 'createPreprintJob') {
      return await createPreprintJob(event.data || {}, operator || {}, OPENID);
    }

    if (action === 'createAndExportPreprintJob') {
      return await createAndExportPreprintJob(event.data || {}, operator || {}, OPENID);
    }

    if (action === 'listPreprintJobs') {
      return await listPreprintJobs(event.data || {}, OPENID);
    }

    if (action === 'listRecentPreprintJobs') {
      return await listRecentPreprintJobs(event.data || {}, OPENID);
    }

    if (action === 'exportPreprintJob') {
      return await exportPreprintJob(event.data || {}, OPENID, operator || {});
    }

    if (action === 'voidPreprintLabels') {
      return await voidPreprintLabels(event.data || {}, OPENID, operator || {});
    }

    if (action === 'getPreprintLabel') {
      return await getPreprintLabel(event.data || {});
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
