// cloudfunctions/searchInventory/index.js
/**
 * 库存搜索云函数
 *
 * 功能：
 * - 物料建议搜索（type: 'suggestion'）
 * - 支持按产品代码、名称、供应商搜索
 * - 按 product_code 去重，优先选择字段最完整的记录
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

// 计算记录的完整度分数
function calculateCompleteness(item) {
  let score = 0;
  if (item.name) score += 1;
  if (item.supplier) score += 2; // 供应商权重更高
  if (item.sub_category) score += 1;
  if (item.supplier_model) score += 1;
  if (item.unit) score += 1;
  if (item.package_type) score += 1;
  if (item.specs && Object.keys(item.specs).length > 0) score += 1;
  return score;
}

exports.main = async (event, context) => {
  const { keyword, type } = event;

  // 参数校验
  if (!keyword) {
    return fail('关键词不能为空', ErrorCode.INVALID_PARAMS);
  }

  try {
    if (type === 'suggestion') {
      // 在 materials 集合中搜索模板
      // 按 create_time 降序，优先获取最新记录
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
        }
      ]))
      .orderBy('create_time', 'desc') // 最新的在前
      .limit(30) // 获取更多以便去重
      .get();

      // 按 product_code 去重，保留信息最完整的记录
      const uniqueMap = new Map();
      for (const item of res.data) {
        const code = item.product_code;
        if (!code) continue;

        if (!uniqueMap.has(code)) {
          // 第一次遇到这个 code
          uniqueMap.set(code, item);
        } else {
          // 已有记录，比较完整度
          const existing = uniqueMap.get(code);
          if (calculateCompleteness(item) > calculateCompleteness(existing)) {
            uniqueMap.set(code, item);
          }
        }
      }

      // 转换为数组并限制10条
      const uniqueList = Array.from(uniqueMap.values()).slice(0, 10);

      // 打印调试信息
      console.log('[searchInventory] Keyword:', keyword);
      console.log('[searchInventory] Found:', res.data.length, 'Unique:', uniqueList.length);
      if (uniqueList.length > 0) {
        console.log('[searchInventory] First item fields:', Object.keys(uniqueList[0]));
      }

      return success(uniqueList);
    }

    // 默认：未知搜索类型
    return fail('未知的搜索类型', ErrorCode.INVALID_PARAMS);

  } catch (err) {
    console.error('[searchInventory] Error:', err);
    return fail(err.message || '搜索失败', ErrorCode.INTERNAL_ERROR);
  }
};
