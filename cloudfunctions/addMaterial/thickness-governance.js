function normalizePositiveNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }
  return normalized;
}

function getFilmThicknessLockedMessage(thicknessUm) {
  return `当前物料厚度已锁定为 ${thicknessUm} μm，请按主数据入库；如需修改请联系管理员在物料管理中调整`;
}

function resolveFilmThicknessGovernance({ materialThicknessUm, inboundThicknessUm }) {
  const normalizedMaterialThicknessUm = normalizePositiveNumber(materialThicknessUm);
  const normalizedInboundThicknessUm = normalizePositiveNumber(inboundThicknessUm);

  if (
    normalizedMaterialThicknessUm
    && normalizedInboundThicknessUm
    && normalizedMaterialThicknessUm !== normalizedInboundThicknessUm
  ) {
    throw new Error(getFilmThicknessLockedMessage(normalizedMaterialThicknessUm));
  }

  return {
    materialThicknessUm: normalizedMaterialThicknessUm,
    inboundThicknessUm: normalizedInboundThicknessUm,
    resolvedThicknessUm: normalizedMaterialThicknessUm || normalizedInboundThicknessUm,
    shouldBackfillMasterThickness: !normalizedMaterialThicknessUm && !!normalizedInboundThicknessUm
  };
}

module.exports = {
  normalizePositiveNumber,
  getFilmThicknessLockedMessage,
  resolveFilmThicknessGovernance
};
