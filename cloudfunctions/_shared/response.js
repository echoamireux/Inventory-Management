// cloudfunctions/_shared/response.js
/**
 * 统一响应格式
 * 所有云函数应使用此模块返回响应
 */

/**
 * 成功响应
 * @param {any} data - 响应数据
 * @param {string} msg - 可选消息
 */
function success(data = null, msg = '') {
  return {
    success: true,
    data,
    msg
  };
}

/**
 * 失败响应
 * @param {string} msg - 错误消息
 * @param {string} code - 错误码
 * @param {any} data - 可选附加数据
 */
function fail(msg = '操作失败', code = 'ERROR', data = null) {
  return {
    success: false,
    code,
    msg,
    data
  };
}

/**
 * 分页响应
 * @param {Array} list - 数据列表
 * @param {number} total - 总数
 * @param {number} page - 当前页
 * @param {number} pageSize - 每页数量
 */
function paginated(list, total, page, pageSize) {
  return {
    success: true,
    data: {
      list,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  };
}

// 错误码常量
const ErrorCode = {
  INVALID_PARAMS: 'INVALID_PARAMS',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  DUPLICATE: 'DUPLICATE',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

module.exports = {
  success,
  fail,
  paginated,
  ErrorCode
};
