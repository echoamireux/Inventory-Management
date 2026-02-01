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
      // 2. 写入/验证 Materials 集合
      // MDM 强管控模式：必须查到已有主数据，否则报错
      const materialQuery = await db.collection('materials').where({
          product_code: base.product_code
      }).get();

      let materialId;
      if (materialQuery.data.length > 0) {
          // 已存在：复用该主数据 ID
          materialId = materialQuery.data[0]._id;
      } else {
          // 不存在：禁止入库！
          throw new Error(`物料代码 ${base.product_code} 未在标准库中，请先申请建档`);
      }

      /* 废弃：不再自动新建主数据
      const materialRes = await transaction.collection('materials').add({
        data: {
          ...base,
          // ...
        }
      });
      materialId = materialRes._id;
      */

      // 4. 写入 Inventory 集合
      const invData = {
        material_id: materialId,
        material_name: base.name,
        category: base.category,
        sub_category: base.sub_category || '', // 冗余存一份方便筛选
        product_code: base.product_code || '', // 冗余存一份方便列表展示
        unique_code: unique_code, // 使用传入的 code
        supplier: base.supplier || '', // Save instance supplier
        supplier_model: base.supplier_model || '', // Save instance model
        location: inventory.location,
        status: 'in_stock',
        quantity: {
          val: Number(inventory.quantity_val),
          unit: inventory.quantity_unit
        },
        create_time: db.serverDate(),
        update_time: db.serverDate()
      };

      if (inventory.expiry_date) {
        invData.expiry_date = new Date(inventory.expiry_date);
    }

    if (base.category === 'chemical') {
        invData.batch_number = inventory.batch_number;
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
