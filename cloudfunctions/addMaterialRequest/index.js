// cloudfunctions/addMaterialRequest/index.js
const cloud = require('wx-server-sdk');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  buildSubcategoryMap,
  resolveSubcategorySelection
} = require('./material-subcategories');
const { normalizeUnitInput } = require('./material-units');
const { assertActiveUserAccess } = require('./auth');
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

async function resolveApplicantName(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).field({ name: true }).get();
    return (res.data && res.data[0] && res.data[0].name) || '';
  } catch (err) {
    return '';
  }
}

async function getOperator(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return (res.data && res.data[0]) || null;
}

async function queryExists(collectionOwner, collectionName, where) {
  const query = collectionOwner.collection(collectionName).where(where);
  if (query && typeof query.limit === 'function') {
    const res = await query.limit(1).get();
    return !!(res.data && res.data.length);
  }
  if (query && typeof query.count === 'function') {
    const res = await query.count();
    return Number(res.total) > 0;
  }
  throw new Error(`无法检查 ${collectionName} 数据`);
}

async function submitRequest(event, openid) {
  const {
    product_code,
    category,
    material_name,
    subcategory_key,
    sub_category,
    supplier,
    default_unit
  } = event;
  const normalizedProductCode = String(product_code || '').trim().toUpperCase();

  if (!product_code || !category || !material_name) {
    return { success: false, msg: '缺少必填信息' };
  }

  const subcategoryRecords = filterSubcategoryRecordsByCategory(
    sortSubcategoryRecords(await ensureBuiltinSubcategories(db)),
    category,
    { includeDisabled: true }
  );
  const subcategoryMap = buildSubcategoryMap(subcategoryRecords);
  const resolvedSubcategory = resolveSubcategorySelection({
    category,
    subcategory_key,
    sub_category
  }, subcategoryRecords, subcategoryMap);
  if (!resolvedSubcategory.subcategory_key) {
    return { success: false, msg: '请选择有效子类别' };
  }

  const normalizedUnit = normalizeUnitInput(category, default_unit);
  if (!normalizedUnit.ok) {
    return { success: false, msg: normalizedUnit.msg || '请选择有效默认单位' };
  }

  const applicant_name = await resolveApplicantName(openid);
  const operationContext = event.operation_id
    ? buildOperationReceiptContext({
      openid,
      operationId: event.operation_id,
      requestPayload: {
        product_code: normalizedProductCode,
        category,
        material_name,
        subcategory_key: resolvedSubcategory.subcategory_key,
        sub_category: resolvedSubcategory.sub_category,
        supplier: supplier || '',
        default_unit: normalizedUnit.unit
      }
    })
    : null;

  try {
    return await db.runTransaction(async transaction => {
      if (operationContext) {
        const operationReceipt = await beginOperationReceipt(transaction, db, operationContext);
        if (operationReceipt.reused) {
          return operationReceipt.response;
        }
      }

      const hasPendingRequest = await queryExists(transaction, 'material_requests', {
        product_code: normalizedProductCode,
        status: 'pending'
      });
      if (hasPendingRequest) {
        const response = { success: false, msg: '该代码已有待审批的申请，请勿重复提交' };
        if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const hasActiveMaterial = await queryExists(transaction, 'materials', {
        product_code: normalizedProductCode,
        status: 'active'
      });
      if (hasActiveMaterial) {
        const response = { success: false, msg: '该代码已存在于标准库，无需申请' };
        if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
        return response;
      }

      const requestData = {
        product_code: normalizedProductCode,
        category,
        material_name,
        subcategory_key: resolvedSubcategory.subcategory_key,
        sub_category: resolvedSubcategory.sub_category,
        supplier: supplier || '',
        default_unit: normalizedUnit.unit,
        status: 'pending',
        pending_key: normalizedProductCode,
        applicant: openid,
        applicant_name: applicant_name || '',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      };
      let created;
      try {
        created = await transaction.collection('material_requests').add({ data: requestData });
      } catch (error) {
        if (/duplicate|unique|唯一|already exists|已存在/i.test(String(error && (error.errMsg || error.message) || ''))) {
          const response = { success: false, msg: '该代码已有待审批的申请，请勿重复提交' };
          if (operationContext) await markOperationReceiptFailed(transaction, db, operationContext, response);
          return response;
        }
        throw error;
      }

      const response = { success: true, msg: '申请已提交，请等待管理员审核', id: created._id };
      await writeAuditEvent(transaction, db, {
        domain: 'material_request',
        action: 'create',
        operator: { _openid: openid, name: applicant_name || '' },
        operationId: operationContext && operationContext.operationId,
        target: { type: 'material_request', id: created._id, label: normalizedProductCode },
        after: requestData
      });
      if (operationContext) {
        await markOperationReceiptSucceeded(transaction, db, operationContext, response);
      }
      return response;
    });
  } catch (error) {
    if (/duplicate|unique|唯一|already exists|已存在/i.test(String(error && (error.errMsg || error.message) || ''))) {
      return { success: false, msg: '该代码已有待审批的申请，请勿重复提交' };
    }
    throw error;
  }
}

async function listMine(openid) {
  const res = await db.collection('material_requests')
    .where(_.or([
      { applicant: openid },
      { _openid: openid }
    ]))
    .orderBy('created_at', 'desc')
    .get();

  return {
    success: true,
    list: res.data || []
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action ? event.action : 'submit';

  try {
    const operator = await getOperator(OPENID);

    if (action === 'listMine') {
      const authResult = assertActiveUserAccess(operator, '仅已激活用户可查看物料申请');
      if (!authResult.ok) {
        return { success: false, msg: authResult.msg };
      }
      return await listMine(OPENID);
    }

    if (action === 'submit') {
      const authResult = assertActiveUserAccess(operator, '仅已激活用户可提交物料申请');
      if (!authResult.ok) {
        return { success: false, msg: authResult.msg };
      }
      return await submitRequest(event, OPENID);
    }

    return { success: false, msg: '未知操作类型' };
  } catch (err) {
    return handleCloudError(err, {
      scope: 'addMaterialRequest',
      operationId: event && event.operation_id,
      fallbackMessage: action === 'listMine' ? '加载申请失败，请稍后重试' : '提交申请失败，请稍后重试'
    });
  }
};
