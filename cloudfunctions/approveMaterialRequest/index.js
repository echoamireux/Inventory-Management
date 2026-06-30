// cloudfunctions/approveMaterialRequest/index.js
const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategorySelection
} = require('./material-subcategories');
const { normalizeUnitInput } = require('./material-units');
const { normalizeTestMaterialFlag } = require('./test-material');
const { validateStandardProductCode } = require('./product-code');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function buildGovernedMaterialMasterFields(source = {}, category) {
  const testMaterialFlag = normalizeTestMaterialFlag(source.is_test_material);
  const fields = {
    material_name: sanitizeText(source.material_name),
    category,
    supplier: sanitizeText(source.supplier),
    supplier_model: sanitizeText(source.supplier_model),
    default_unit: sanitizeText(source.default_unit),
    is_test_material: testMaterialFlag.value
  };

  if (category === 'chemical') {
    fields.package_type = sanitizeText(source.package_type);
    return fields;
  }

  if (category === 'film') {
    const specs = {};
    const thicknessUm = normalizeOptionalNumber(
      source.thickness_um !== undefined
        ? source.thickness_um
        : source.specs && source.specs.thickness_um
    );
    const standardWidthMm = normalizeOptionalNumber(
      source.width_mm !== undefined
        ? source.width_mm
        : (
          source.standard_width_mm !== undefined
            ? source.standard_width_mm
            : (source.specs && (
              source.specs.standard_width_mm !== undefined
                ? source.specs.standard_width_mm
                : source.specs.width_mm
            ))
        )
    );

    if (thicknessUm !== null) {
      specs.thickness_um = thicknessUm;
    }
    if (standardWidthMm !== null) {
      specs.standard_width_mm = standardWidthMm;
    }
    fields.specs = specs;
  }

  return fields;
}

async function resolveRequestSubcategory(request) {
  const category = request && request.category === 'film' ? 'film' : 'chemical';
  const allRecords = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
  const records = filterSubcategoryRecordsByCategory(allRecords, category, { includeDisabled: true });
  const map = buildSubcategoryMap(records);

  return resolveSubcategorySelection({
    category,
    subcategory_key: request && request.subcategory_key,
    sub_category: request && request.sub_category
  }, records, map);
}

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
    const authResult = assertAdminMutationAccess(operator, '无权限操作 (Require Admin)');
    if (!authResult.ok) {
         return { success: false, msg: authResult.msg };
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
        const category = request.category === 'film' ? 'film' : 'chemical';
        const normalizedCode = validateStandardProductCode(category, request.product_code);
        if (!normalizedCode.ok) {
            return { success: false, msg: normalizedCode.msg };
        }

        const resolvedSubcategory = await resolveRequestSubcategory(request);
        if (!resolvedSubcategory.subcategory_key) {
            return { success: false, msg: '申请单子类别无效，请先修正后再审批' };
        }
        const normalizedUnit = normalizeUnitInput(request.category, request.default_unit);
        if (!normalizedUnit.ok) {
            return { success: false, msg: '申请单默认单位无效，请先修正后再审批' };
        }

        const txResult = await db.runTransaction(async transaction => {
            const txRequestRes = await transaction.collection('material_requests').doc(request_id).get();
            const txRequest = txRequestRes.data;
            if (!txRequest) {
                throw new Error('申请单不存在');
            }
            if (txRequest.status !== 'pending') {
                throw new Error('该申请已被处理过');
            }

            const existRes = await transaction.collection('materials')
              .where({ product_code: normalizedCode.product_code })
              .limit(1)
              .get();
            if (existRes.data && existRes.data.length > 0) {
                await transaction.collection('material_requests').doc(request_id).update({
                    data: {
                        status: 'rejected',
                        reject_reason: 'System: Code already exists in library',
                        updated_at: db.serverDate()
                    }
                });
                return { success: false, msg: 'Fail: 代码已存在于物料库，自动驳回' };
            }

            const masterFields = buildGovernedMaterialMasterFields({
                ...txRequest,
                product_code: normalizedCode.product_code,
                default_unit: normalizedUnit.unit
            }, category);
            const addRes = await transaction.collection('materials').add({
                data: {
                    product_code: normalizedCode.product_code,
                    subcategory_key: resolvedSubcategory.subcategory_key,
                    sub_category: resolvedSubcategory.sub_category,
                    ...masterFields,
                    status: 'active',
                    batch_count: 0,
                    quantity: 0,
                    created_by: txRequest.applicant || txRequest._openid || '',
                    created_at: db.serverDate(),
                    approved_by: OPENID,
                    approved_at: db.serverDate()
                }
            });

            if (!addRes._id) {
                throw new Error('Write to materials failed');
            }

            await transaction.collection('material_requests').doc(request_id).update({
                data: {
                    status: 'approved',
                    material_id: addRes._id,
                    subcategory_key: resolvedSubcategory.subcategory_key,
                    sub_category: resolvedSubcategory.sub_category,
                    operator_id: OPENID,
                    operator_name: operator.name || 'Admin',
                    updated_at: db.serverDate()
                }
            });

            return { success: true, msg: '已通过，物料创建成功' };
        });

        return txResult;
    }

    return { success: false, msg: 'Unknown action' };

  } catch (err) {
    console.error('Approve Error', err);
    return { success: false, msg: '操作失败: ' + err.message };
  }
};
