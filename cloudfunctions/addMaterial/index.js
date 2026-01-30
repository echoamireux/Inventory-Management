// cloudfunctions/addMaterial/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 生成唯一码: 前缀 + 年月日 + 4位随机
function generateUniqueCode(prefix) {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${yyyy}${mm}${dd}-${random}`;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { base, specs, inventory, unique_code } = event; // 接收 unique_code

  // 1. 参数校验
  if (!base.name || !base.category || !unique_code) {
    return { success: false, msg: 'Missing required info: name, category, or unique_code' };
  }

  try {
    const result = await db.runTransaction(async transaction => {
      // 1.1 唯一码查重 (必须全局唯一)
      // 注意：transaction 中不支持 where 查询，必须用 db.collection 直接查，或者假定重复会报错。
      // 但为了健壮性，我们可以先查一下 (非事务内)，或者依赖数据库的唯一索引 (如果设置了)。
      // 云开发事务限制比较多，这里先在事务外查重，虽然理论上有并发风险，但标签是物理唯一的，风险极低。
    });

    // 为了避开事务限制，先查重
    const existCode = await db.collection('inventory').where({
        unique_code: unique_code
    }).count();

    if (existCode.total > 0) {
        return { success: false, msg: `标签号 ${unique_code} 已存在，请勿重复录入` };
    }

    return await db.runTransaction(async transaction => {
      // 2. 写入 Materials 集合
      // 现在的逻辑：每次扫码都是一个"实例"。
      // 但如果这个物料名之前存在过，是否应该复用 Materials 记录？
      // 用户需求暗示："同一种胶水进货5桶"，意味着 "胶水" (Material) 是一个，而 "桶" (Inventory) 是5个。
      // 所以我们应该先查 Materials 表有没有同名的？

      // OPTIMIZATION: 现在的 addMaterial 实际上是 "Create Material + Stock In".
      // 如果用户希望 "联想输入"，说明 Materials 表应该存的是 "模板"。
      // 但目前的架构是 Material 和 Inventory 1:1 强绑定吗？
      // 看代码：invData.material_id = materialId.
      // 如果我们想复用 Material，就需要先查名。

      let materialId;

      // 尝试查找同名、同供应商、同规格的现有物料
      // 由于事务限制，这里简化逻辑：总是新建 Material 记录作为快照，
      // 或者，我们依然由于 "一物一码" 的设计，每个 inventory 对应一个 material record (snapshot style) 也没问题。
      // 但为了数据整洁，最好是复用。

      // 鉴于用户说 "输入乙酸匹配到乙酸乙酯，自动填入..."，这说明前端做了复用逻辑。
      // 后端这里，我们可以简单点，每次都存一个新的 Material 记录作为 "实例的元数据" 也可以，
      // 或者尝试复用。为了不破坏现有结构，我们暂时保持 "每次新建 Material" (或者视作快照)。
      // 只要 Inventory 里的 unique_code 是唯一的就行。

      const materialRes = await transaction.collection('materials').add({
        data: {
          ...base,
          supplier: base.supplier || '',
          // 新增字段
          product_code: base.product_code || '', // 产品代码 (SKU)
          sub_category: base.sub_category || '', // 详细分类
          supplier_model: base.supplier_model || '', // 供应商原始型号
          specs: specs,
          create_time: db.serverDate(),
          update_time: db.serverDate(),
          creator: OPENID
        }
      });
      materialId = materialRes._id;

      // 4. 写入 Inventory 集合
      const invData = {
        material_id: materialId,
        material_name: base.name,
        category: base.category,
        sub_category: base.sub_category || '', // 冗余存一份方便筛选
        product_code: base.product_code || '', // 冗余存一份方便列表展示
        unique_code: unique_code, // 使用传入的 code
        location: inventory.location,
        status: 'in_stock',
        quantity: {
          val: Number(inventory.quantity_val),
          unit: inventory.quantity_unit
        },
        create_time: db.serverDate(),
        update_time: db.serverDate()
      };

      if (base.category === 'chemical') {
        invData.batch_number = inventory.batch_number;
        if (inventory.expiry_date) {
            invData.expiry_date = new Date(inventory.expiry_date);
        }
        // 化材动态属性: 重量
        if (inventory.weight_kg) {
             invData.dynamic_attrs = { weight_kg: Number(inventory.weight_kg) };
        }
      } else if (base.category === 'film') {
         invData.batch_number = inventory.batch_number; // 膜材也有批号
         // 膜材动态属性: 长宽
         invData.dynamic_attrs = {
             current_length_m: Number(inventory.length_m || 0),
             width_mm: Number(specs.width_mm || 0), // 初始宽度通常等于规格宽度
             current_roll_diameter_mm: 0 // 初始卷径未知可填0
         };
      }

      const invRes = await transaction.collection('inventory').add({
        data: invData
      });

      // 5. 写入 inventory_log 集合 (原 logs 集合)
      await transaction.collection('inventory_log').add({
         data: {
            type: 'inbound', // 初始入库
            inventory_id: invRes._id,
            material_id: materialId,
            material_name: base.name,
            category: base.category, // Added for Log Display Logic
            product_code: base.product_code, // Added for Log Display Logic
            quantity_change: Number(inventory.quantity_val),
            spec_change_unit: inventory.quantity_unit || '份',
            operator: event.operator_name || 'System',
            operator_id: OPENID,
            _openid: OPENID,
            timestamp: db.serverDate(),
            description: '初始录入'
         }
      });

      return {
        success: true,
        materialId: materialId,
        inventoryId: invRes._id,
        uniqueCode: unique_code
      };
    });

    return result;

  } catch (err) {
    console.error('Transaction failed', err);
    return {
      success: false,
      msg: err.message || 'Database transaction failed'
    };
  }
};
