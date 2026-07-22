const LEGACY_TEMPLATE_EXPORT_HINT = '当前云函数版本过旧，请部署最新版 exportMaterialTemplate';

function normalizeTemplateExportResult(res) {
  const result = res && res.result ? res.result : {};

  if (!result.success) {
    throw new Error(result.msg || '模板导出失败');
  }

  if (!result.fileID || typeof result.fileID !== 'string') {
    throw new Error(LEGACY_TEMPLATE_EXPORT_HINT);
  }

  const normalized = {
    success: true,
    fileID: result.fileID,
    fileName: String(result.fileName || '').trim()
  };
  const fileContentBase64 = String(result.fileContentBase64 || '').trim();
  if (fileContentBase64) {
    normalized.fileContentBase64 = fileContentBase64;
  }
  return normalized;
}

module.exports = {
  LEGACY_TEMPLATE_EXPORT_HINT,
  normalizeTemplateExportResult
};
