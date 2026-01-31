// cloudfunctions/searchInventory/index.js
/**
 * 库存搜索云函数
 *
 * 功能：
 * - 物料建议搜索（type: 'suggestion'）
 * - 支持按产品代码、名称、供应商、批号搜索
 *
 * 参数：
 * - keyword: 搜索关键词
 * - type: 搜索类型 ('suggestion' 或其他)
 */
const cloud = require('wx-server-sdk');
const { success, fail, ErrorCode } = require('./response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { keyword, type } = event;

  // 参数校验
  if (!keyword) {
    return fail('关键词不能为空', ErrorCode.INVALID_PARAMS);
  }

  try {
    if (type === 'suggestion') {
      // 在 materials 集合中搜索模板
      // 支持：产品代码、名称、供应商、批号
      const res = await db.collection('materials').where(_.or([
        {
          product_code: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        },
        {
          name: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        },
        {
          supplier: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        },
        {
          batch_number: db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        }
      ]))
      .limit(10)
      .get();

      return success(res.data);
    }

    // 默认：未知搜索类型
    return fail('未知的搜索类型', ErrorCode.INVALID_PARAMS);

  } catch (err) {
    console.error('[searchInventory] Error:', err);
    return fail(err.message || '搜索失败', ErrorCode.INTERNAL_ERROR);
  }
};
