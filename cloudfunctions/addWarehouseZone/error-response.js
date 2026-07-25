const PUBLIC_BUSINESS_PREFIX = /^(第\d+条|仅|缺少|请输入|请选择|必须|过期|标签|预生成标签|本批|每人|10 分钟|与预生成|产品代码|物料|膜材|化材|库存|项目编码|项目用料|用户状态|状态仅|测试料|库区|详细坐标|该|同一|已有|存在|未找到|至少|冲突|操作编号|申请|前缀|单次|单个|领用|导入|没有|不支持|当前|所选|纠错)/;
const TECHNICAL_DETAIL = /(database|collection|document|mongodb|mongoerror|stack|sdk|econn|timeout|timed out|network|internal|unexpected|undefined|null|duplicate key|index\s|数据库|集合|索引|调用栈)/i;

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function isPublicBusinessMessage(message) {
  const normalized = normalizeText(message);
  return !!normalized
    && normalized.length <= 240
    && PUBLIC_BUSINESS_PREFIX.test(normalized)
    && !TECHNICAL_DETAIL.test(normalized);
}

function normalizeRequestId(value) {
  const normalized = normalizeText(value);
  return /^[A-Za-z0-9_:-]{8,100}$/.test(normalized) ? normalized : '';
}

function createRequestId(now = Date.now(), random = Math.random) {
  const randomPart = Math.floor(Number(random()) * 0xFFFFFF)
    .toString(36)
    .padStart(5, '0');
  return `req_${Number(now).toString(36)}_${randomPart}`;
}

function buildCloudErrorResponse(error, options = {}) {
  const message = normalizeText(error && error.message);
  const isPublic = !!(error && error.expose === true) || isPublicBusinessMessage(message);
  const requestId = normalizeRequestId(options.requestId || options.operationId)
    || createRequestId(options.now, options.random);
  const explicitCode = normalizeText(error && error.code);

  return {
    success: false,
    code: isPublic ? (explicitCode || 'BUSINESS_ERROR') : 'INTERNAL_ERROR',
    msg: isPublic ? message : (normalizeText(options.fallbackMessage) || '操作失败，请稍后重试'),
    request_id: requestId
  };
}

function handleCloudError(error, options = {}) {
  const response = buildCloudErrorResponse(error, options);
  const scope = normalizeText(options.scope) || 'cloud-function';
  console.error(`[${response.request_id}] ${scope}`, error);
  return response;
}

module.exports = {
  isPublicBusinessMessage,
  createRequestId,
  buildCloudErrorResponse,
  handleCloudError
};
