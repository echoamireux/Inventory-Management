const LEGACY_IMPORT_TEMPLATE_HINT = '当前云函数版本过旧，请部署最新版 importInventoryTemplate';

function normalizeInventoryTemplatePreviewResult(res) {
  const result = res && res.result ? res.result : {};

  if (!result.success) {
    throw new Error(result.msg || '预览失败');
  }

  if (!Array.isArray(result.list)) {
    throw new Error(LEGACY_IMPORT_TEMPLATE_HINT);
  }

  return {
    success: true,
    list: result.list,
    validCount: Number(result.validCount) || 0,
    errorCount: Number(result.errorCount) || 0,
    warningCount: Number(result.warningCount) || 0
  };
}

function normalizeInventoryTemplateSubmitResult(res) {
  const result = res && res.result ? res.result : {};

  if (!result.success) {
    throw new Error(result.msg || '入库失败');
  }

  const created = Number(result.created);

  return {
    success: true,
    created: Number.isFinite(created) ? created : 0,
    msg: String(result.msg || '').trim()
  };
}

module.exports = {
  LEGACY_IMPORT_TEMPLATE_HINT,
  normalizeInventoryTemplatePreviewResult,
  normalizeInventoryTemplateSubmitResult
};
