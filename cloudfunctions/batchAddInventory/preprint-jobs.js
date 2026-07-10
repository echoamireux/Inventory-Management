const crypto = require('crypto');

const PREPRINT_JOB_STATUSES = Object.freeze({
  CREATING: 'creating',
  READY: 'ready',
  VOIDING: 'voiding',
  VOIDED: 'voided'
});

const PREPRINT_EXPORT_STATUSES = Object.freeze({
  PENDING: 'pending',
  EXPORTED: 'exported',
  FAILED: 'failed'
});

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function buildStableHash(parts = []) {
  return crypto
    .createHash('sha1')
    .update((parts || []).map(normalizeText).join('\u0000'))
    .digest('hex');
}

function buildPreprintJobId(operatorOpenid, requestId) {
  const operatorId = normalizeText(operatorOpenid);
  const normalizedRequestId = normalizeText(requestId);
  if (!operatorId || !normalizedRequestId) {
    throw new Error('缺少预打印任务操作者或请求编号');
  }
  return `preprint_job_${buildStableHash([operatorId, normalizedRequestId])}`;
}

function buildPreprintLabelDocumentId(jobId, jobIndex) {
  const normalizedJobId = normalizeText(jobId);
  const normalizedIndex = Number(jobIndex);
  if (!normalizedJobId || !Number.isInteger(normalizedIndex) || normalizedIndex <= 0) {
    throw new Error('预打印标签任务索引无效');
  }
  return `preprint_label_${buildStableHash([normalizedJobId, normalizedIndex])}`;
}

function chunkPreprintItems(items = [], size = 20) {
  const chunkSize = Math.max(1, Number(size) || 20);
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function assertPreprintJobConsumable(job = null) {
  if (!job) {
    return;
  }
  if (job.status === PREPRINT_JOB_STATUSES.READY) {
    return;
  }
  if (job.status === PREPRINT_JOB_STATUSES.CREATING) {
    throw new Error('预生成标签尚未生成完成，请稍后重试');
  }
  if (job.status === PREPRINT_JOB_STATUSES.VOIDING) {
    throw new Error('预生成标签所属批次正在作废，不能入库');
  }
  if (job.status === PREPRINT_JOB_STATUSES.VOIDED) {
    throw new Error('预生成标签所属批次已作废，不能入库');
  }
  throw new Error('预生成标签所属批次状态异常，不能入库');
}

function assertPreprintJobVoidable(job = {}, operatorOpenid = '') {
  if (normalizeText(job.operator_id) !== normalizeText(operatorOpenid)) {
    throw new Error('无权作废该预生成标签批次');
  }
  if (job.status === PREPRINT_JOB_STATUSES.VOIDED) {
    return;
  }
  if (![PREPRINT_JOB_STATUSES.CREATING, PREPRINT_JOB_STATUSES.READY, PREPRINT_JOB_STATUSES.VOIDING].includes(job.status)) {
    throw new Error('当前预生成标签批次状态不能作废');
  }
  if (Number(job.used_count) > 0) {
    throw new Error('该批次已有标签入库，不能整体作废');
  }
}

function isMissingDocumentError(error) {
  const message = normalizeText(
    error && (error.errCode || error.code || error.errMsg || error.message || error)
  ).toLowerCase();
  return /document.*not.*exist|document.*not.*found|database_document_not_exist|文档.*不存在/.test(message);
}

async function loadPreprintJobForLabel(transaction, preprintLabel = {}) {
  const jobId = normalizeText(preprintLabel && preprintLabel.job_id);
  if (!jobId) {
    return null;
  }
  try {
    const res = await transaction.collection('preprint_jobs').doc(jobId).get();
    return res.data || null;
  } catch (error) {
    if (isMissingDocumentError(error)) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  PREPRINT_JOB_STATUSES,
  PREPRINT_EXPORT_STATUSES,
  buildPreprintJobId,
  buildPreprintLabelDocumentId,
  chunkPreprintItems,
  assertPreprintJobConsumable,
  assertPreprintJobVoidable,
  isMissingDocumentError,
  loadPreprintJobForLabel
};
