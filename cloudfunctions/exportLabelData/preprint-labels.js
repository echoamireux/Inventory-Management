const {
  normalizeTemplateType,
  resolveTemplateCategory,
  buildLabelExportRow
} = require('./label-export-report');

const LABEL_CODE_PREFIX = 'L';
const LABEL_CODE_DIGITS = 6;

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('请输入需要生成的标签数量');
  }
  if (count > 200) {
    throw new Error('单次最多生成 200 个标签');
  }
  return count;
}

function parseLabelCodeNumber(code) {
  const match = normalizeText(code).match(/^L(\d{6})$/i);
  return match ? Number(match[1]) : 0;
}

function formatLabelCode(number) {
  return `${LABEL_CODE_PREFIX}${String(number).padStart(LABEL_CODE_DIGITS, '0')}`;
}

function buildNextLabelCodes({ count, existingCodes = [], startNumber = 1 } = {}) {
  const needed = normalizeCount(count);
  const used = new Set((existingCodes || []).map(code => normalizeText(code).toUpperCase()).filter(Boolean));
  const result = [];
  let cursor = Math.max(1, Number(startNumber) || 1);

  while (result.length < needed) {
    const code = formatLabelCode(cursor);
    if (!used.has(code)) {
      result.push(code);
      used.add(code);
    }
    cursor += 1;
  }

  return result;
}

function resolveMaterialName(material = {}) {
  return normalizeText(material.material_name || material.name);
}

function resolveSupplierModel(material = {}, form = {}) {
  const fromForm = normalizeText(form.supplier_model);
  if (fromForm) {
    return fromForm;
  }
  return normalizeText(material.supplier_model);
}

function assertPreprintPayload({
  templateType = 'film',
  count = 1,
  material = {},
  form = {}
} = {}) {
  const normalizedType = normalizeTemplateType(templateType);
  const normalizedCount = normalizeCount(count);
  const expectedCategory = resolveTemplateCategory(normalizedType);
  const materialCategory = normalizeText(material.category) || expectedCategory;
  const productCode = normalizeText(material.product_code);
  const materialName = resolveMaterialName(material);
  const supplierModel = resolveSupplierModel(material, form);

  if (!material || !material._id) {
    throw new Error('请先选择需要打印标签的物料');
  }
  if (!productCode || !materialName) {
    throw new Error('物料主数据缺少产品代码或物料名称');
  }
  if (materialCategory !== expectedCategory) {
    throw new Error('所选标签模板与物料类型不匹配');
  }
  if (material.is_test_material && !supplierModel) {
    throw new Error('测试料预生成标签必须填写原厂型号');
  }

  return {
    templateType: normalizedType,
    count: normalizedCount,
    category: expectedCategory,
    productCode,
    materialName,
    supplierModel
  };
}

function buildPreprintRequestSignature({
  templateType = 'film',
  count = 1,
  material = {},
  form = {}
} = {}) {
  const payload = assertPreprintPayload({
    templateType,
    count,
    material,
    form
  });
  return JSON.stringify({
    template_type: payload.templateType,
    material_id: normalizeText(material._id),
    product_code: payload.productCode,
    category: payload.category,
    count: payload.count,
    supplier_model: payload.supplierModel,
    supplier: normalizeText(form.supplier),
    sample_note: normalizeText(form.sample_note)
  });
}

function buildJobId(now = new Date()) {
  const random = Math.random().toString(36).slice(2, 8);
  return `preprint_${now.getTime()}_${random}`;
}

function buildPreprintLabelRecords({
  templateType = 'film',
  labelCodes = [],
  material = {},
  form = {},
  operatorOpenid = '',
  operatorName = '',
  now = new Date(),
  jobId
} = {}) {
  const payload = assertPreprintPayload({
    templateType,
    count: labelCodes.length,
    material,
    form
  });
  const resolvedJobId = normalizeText(jobId) || buildJobId(now);
  const supplier = normalizeText(form.supplier);
  const supplierModel = payload.supplierModel;
  const sampleNote = normalizeText(form.sample_note);

  return labelCodes.map((code, index) => {
    const uniqueCode = normalizeText(code).toUpperCase();
    return {
      job_id: resolvedJobId,
      job_index: index + 1,
      unique_code: uniqueCode,
      qr_content: uniqueCode,
      template_type: payload.templateType,
      material_id: material._id,
      product_code: payload.productCode,
      material_name: payload.materialName,
      category: payload.category,
      subcategory_key: normalizeText(material.subcategory_key),
      sub_category: normalizeText(material.sub_category),
      supplier,
      supplier_model: supplierModel,
      sample_note: sampleNote,
      is_test_material: !!material.is_test_material,
      status: 'unused',
      operator_id: operatorOpenid,
      operator_name: operatorName,
      create_time: now,
      update_time: now
    };
  });
}

function buildPreprintLabelExportRow(record = {}) {
  return buildLabelExportRow(record.template_type || record.templateType || 'film', {
    unique_code: record.unique_code,
    qr_content: record.qr_content || record.unique_code,
    product_code: record.product_code,
    material_name: record.material_name,
    sub_category: record.sub_category,
    supplier_model: record.supplier_model,
    sample_note: record.sample_note,
    is_test_material: record.is_test_material,
    specs: record.specs || {},
    dynamic_attrs: record.dynamic_attrs || {}
  }, {});
}

module.exports = {
  buildNextLabelCodes,
  buildPreprintLabelRecords,
  buildPreprintLabelExportRow,
  buildPreprintRequestSignature,
  assertPreprintPayload,
  formatLabelCode,
  parseLabelCodeNumber
};
