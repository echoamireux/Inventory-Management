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
const {
  ensureBuiltinProductCodePrefixes,
  filterProductCodePrefixRecordsByCategory
} = require('./product-code-prefixes');
const {
  buildOperationReceiptContext,
  beginOperationReceipt,
  markOperationReceiptSucceeded,
  markOperationReceiptFailed
} = require('./operation-receipts');
const { writeAuditEvent } = require('./audit-events');
const { handleCloudError } = require('./error-response');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function clearPendingKeyUpdate() {
  return typeof _?.remove === 'function' ? { pending_key: _.remove() } : {};
}

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

async function loadProductCodePrefixOptions(category = '') {
  try {
    const allRecords = await ensureBuiltinProductCodePrefixes(db);
    return filterProductCodePrefixRecordsByCategory(allRecords, category, { includeDisabled: false });
  } catch (_error) {
    return [];
  }
}

async function updatePendingMaterialRequestStatus(requestId, status, data = {}, auditContext = {}) {
  return db.runTransaction(async (transaction) => {
    const requestRef = transaction.collection('material_requests').doc(requestId);
    const requestRes = await requestRef.get();
    const request = requestRes.data;
    if (!request) {
      return { success: false, msg: '申请单不存在' };
    }
    if (request.status !== 'pending') {
      return { success: false, msg: '该申请已被处理过' };
    }
    await requestRef.update({
      data: {
        status,
        ...clearPendingKeyUpdate(),
        ...data,
        updated_at: db.serverDate()
      }
    });
    await writeAuditEvent(transaction, db, {
      domain: 'material_request',
      action: status === 'rejected' ? 'reject' : 'update',
      operator: Object.assign({}, auditContext.operator || {}, { _openid: auditContext.openid || '' }),
      target: {
        type: 'material_request',
        id: requestId,
        label: request.product_code || request.material_name || ''
      },
      before: {
        status: request.status
      },
      after: {
        status
      },
      detail: {
        product_code: request.product_code || '',
        material_name: request.material_name || '',
        reject_reason: data.reject_reason || ''
      }
    });
    return { success: true, msg: status === 'rejected' ? '已驳回' : '操作成功' };
  });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const requestId = sanitizeText(event.request_id);
  const action = sanitizeText(event.action);
  const rejectReason = sanitizeText(event.reject_reason);

  if (!requestId || !action) {
    return { success: false, msg: '缺少必填参数' };
  }

  try {
    const userRes = await db.collection('users')
      .where({ _openid: OPENID })
      .limit(1)
      .get();

    const operator = userRes.data && userRes.data[0];
    const authResult = assertAdminMutationAccess(operator, '无权限操作 (Require Admin)');
    if (!authResult.ok) {
      return { success: false, msg: authResult.msg };
    }
    if (!['approve', 'reject'].includes(action)) {
      return { success: false, msg: '未知操作类型' };
    }

    const operationContext = buildOperationReceiptContext({
      openid: OPENID,
      operationId: event.operation_id,
      requestPayload: {
        request_id: requestId,
        action,
        reject_reason: rejectReason
      }
    });

    return await db.runTransaction(async transaction => {
      const requestRef = transaction.collection('material_requests').doc(requestId);
      const requestRes = await requestRef.get();
      const request = requestRes.data;
      if (!request) {
        return { success: false, msg: '申请单不存在' };
      }

      const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
      if (operationReceipt.reused) {
        return operationReceipt.response;
      }

      if (request.status !== 'pending') {
        const response = { success: false, msg: '该申请已被处理过' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      if (action === 'reject') {
        await requestRef.update({
          data: {
            status: 'rejected',
            ...clearPendingKeyUpdate(),
            reject_reason: rejectReason,
            operator_id: OPENID,
            operator_name: operator.name || 'Admin',
            updated_at: db.serverDate()
          }
        });
        await writeAuditEvent(transaction, db, {
          domain: 'material_request',
          action: 'reject',
          operator: Object.assign({}, operator || {}, { _openid: OPENID }),
          operationId: operationContext.operationId,
          target: {
            type: 'material_request',
            id: requestId,
            label: request.product_code || request.material_name || ''
          },
          before: {
            status: request.status
          },
          after: {
            status: 'rejected'
          },
          detail: {
            product_code: request.product_code || '',
            material_name: request.material_name || '',
            reject_reason: rejectReason
          }
        });
        const response = { success: true, msg: '已驳回' };
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
        return response;
      }

      const category = request.category === 'film' ? 'film' : 'chemical';
      const prefixOptions = await loadProductCodePrefixOptions(category);
      const normalizedCode = validateStandardProductCode(category, request.product_code, {
        allowedPrefixes: prefixOptions
      });
      if (!normalizedCode.ok) {
        const response = { success: false, msg: normalizedCode.msg };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const resolvedSubcategory = await resolveRequestSubcategory(request);
      if (!resolvedSubcategory.subcategory_key) {
        const response = { success: false, msg: '申请单子类别无效，请先修正后再审批' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }
      const normalizedUnit = normalizeUnitInput(request.category, request.default_unit);
      if (!normalizedUnit.ok) {
        const response = { success: false, msg: '申请单默认单位无效，请先修正后再审批' };
        await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const existRes = await transaction.collection('materials')
        .where({ product_code: normalizedCode.product_code })
        .limit(1)
        .get();
      if (existRes.data && existRes.data.length > 0) {
        await requestRef.update({
          data: {
            status: 'rejected',
            ...clearPendingKeyUpdate(),
            reject_reason: 'System: Code already exists in library',
            updated_at: db.serverDate()
          }
        });
        await writeAuditEvent(transaction, db, {
          domain: 'material_request',
          action: 'reject',
          operator: Object.assign({}, operator || {}, { _openid: OPENID }),
          operationId: operationContext.operationId,
          target: {
            type: 'material_request',
            id: requestId,
            label: normalizedCode.product_code
          },
          before: {
            status: request.status
          },
          after: {
            status: 'rejected'
          },
          detail: {
            product_code: normalizedCode.product_code,
            reject_reason: 'System: Code already exists in library'
          }
        });
        const response = { success: false, msg: '代码已存在于物料库，已自动驳回' };
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
        return response;
      }

      const masterFields = buildGovernedMaterialMasterFields({
        ...request,
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
          created_by: request.applicant || request._openid || '',
          created_at: db.serverDate(),
          approved_by: OPENID,
          approved_at: db.serverDate()
        }
      });

      if (!addRes._id) {
        throw new Error('Write to materials failed');
      }

      await requestRef.update({
        data: {
          status: 'approved',
          ...clearPendingKeyUpdate(),
          material_id: addRes._id,
          subcategory_key: resolvedSubcategory.subcategory_key,
          sub_category: resolvedSubcategory.sub_category,
          operator_id: OPENID,
          operator_name: operator.name || 'Admin',
          updated_at: db.serverDate()
        }
      });
      await writeAuditEvent(transaction, db, {
        domain: 'material_request',
        action: 'approve',
        operator: Object.assign({}, operator || {}, { _openid: OPENID }),
        operationId: operationContext.operationId,
        target: {
          type: 'material_request',
          id: requestId,
          label: normalizedCode.product_code
        },
        before: {
          status: request.status
        },
        after: {
          status: 'approved',
          material_id: addRes._id,
          product_code: normalizedCode.product_code
        },
        detail: {
          material_id: addRes._id,
          product_code: normalizedCode.product_code,
          material_name: masterFields.material_name || '',
          category
        }
      });
      await writeAuditEvent(transaction, db, {
        domain: 'material',
        action: 'create',
        operator: Object.assign({}, operator || {}, { _openid: OPENID }),
        operationId: operationContext.operationId,
        target: {
          type: 'material',
          id: addRes._id,
          label: normalizedCode.product_code
        },
        after: {
          material_id: addRes._id,
          product_code: normalizedCode.product_code,
          material_name: masterFields.material_name || '',
          category,
          status: 'active'
        },
        detail: {
          note: '物料申请审批通过后创建主数据'
        }
      });

      const response = { success: true, msg: '已通过，物料创建成功' };
      await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      return response;
    });
  } catch (err) {
    return handleCloudError(err, {
      scope: 'approveMaterialRequest',
      operationId: event && event.operation_id,
      fallbackMessage: '审批物料申请失败，请稍后重试'
    });
  }
};
