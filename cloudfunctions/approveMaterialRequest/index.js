// cloudfunctions/approveMaterialRequest/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
      request_id,
      action, // 'approve' | 'reject'
      reject_reason
  } = event;

  if (!request_id || !action) {
      return { success: false, msg: 'Missing parameters' };
  }

  try {
    // 1. 鉴权：确认操作者是管理员
    // 注意：这里假设用户表里有 role 字段。如果您的应用逻辑不同，可调整。
    // 如果是开发阶段，也可以暂时放开权限或者只校验 specific OPENID。
    // 但为了严谨，我们查表。
    const userRes = await db.collection('users')
      .where({
          _openid: OPENID
      })
      .get();

    const operator = userRes.data[0];
    if (!operator || operator.role !== 'admin') {
         return { success: false, msg: '无权限操作 (Require Admin)' };
    }

    // 2. 获取申请单详情
    const requestRes = await db.collection('material_requests').doc(request_id).get();
    const request = requestRes.data;

    if (!request) {
        return { success: false, msg: '申请单不存在' };
    }

    if (request.status !== 'pending') {
        return { success: false, msg: '该申请已被处理过' };
    }

    // 3. 处理动作
    if (action === 'reject') {
        // 驳回逻辑
        await db.collection('material_requests').doc(request_id).update({
            data: {
                status: 'rejected',
                reject_reason: reject_reason || '',
                operator_id: OPENID,
                operator_name: operator.name || 'Admin',
                updated_at: db.serverDate()
            }
        });
        return { success: true, msg: '已驳回' };
    }

    if (action === 'approve') {
        // 通过逻辑

        // A. 二次查重 (防止并发写入)
        const existCount = await db.collection('materials').where({
            product_code: request.product_code
        }).count();

        if (existCount.total > 0) {
            // 虽然申请单还在，但 formally 库里已经有了，可能别人手动加了，或者并发了。
            // 此时标记为 rejected (Reason: 已存在) 比较合理，或者直接报错？
            // 为了流程闭环，我们手动置为 invalid/rejected
            await db.collection('material_requests').doc(request_id).update({
                data: {
                    status: 'rejected',
                    reject_reason: 'System: Code already exists in library',
                    updated_at: db.serverDate()
                }
            });
            return { success: false, msg: 'Fail: 代码已存在于物料库，自动驳回' };
        }

        // B. 写入正式物料库
        const newMaterial = {
            product_code: request.product_code,
            category: request.category,
            material_name: request.material_name,
            sub_category: request.sub_category,
            // 如果有 suggested_sub_category, 也可以考虑作为别名入库，这里暂时只存标准字段
            supplier: request.supplier,
            // 默认初始字段
            batch_count: 0,
            quantity: 0,
            location: '',
            // 审计字段
            created_by: request._openid, // 申请人作为创建者
            created_at: db.serverDate(),
            approved_by: OPENID,
            approved_at: db.serverDate()
        };

        const addRes = await db.collection('materials').add({
            data: newMaterial
        });

        if (!addRes._id) {
            throw new Error('Write to materials failed');
        }

        // C. 更新申请单状态
        await db.collection('material_requests').doc(request_id).update({
            data: {
                status: 'approved',
                material_id: addRes._id, // 关联正式ID
                operator_id: OPENID,
                operator_name: operator.name || 'Admin',
                updated_at: db.serverDate()
            }
        });

        return { success: true, msg: '已通过，物料创建成功' };
    }

    return { success: false, msg: 'Unknown action' };

  } catch (err) {
    console.error('Approve Error', err);
    return { success: false, msg: '操作失败: ' + err.message };
  }
};
