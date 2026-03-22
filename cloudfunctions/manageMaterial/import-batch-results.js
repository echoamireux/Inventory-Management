function normalizeRowIndex(rowIndex) {
  const value = Number(rowIndex);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeProductCode(productCode) {
  return String(productCode || '').trim();
}

function createImportResultTracker() {
  const state = {
    created: 0,
    skipped: 0,
    errors: 0,
    results: []
  };

  function push(status, rowIndex, productCode, reason) {
    state.results.push({
      rowIndex: normalizeRowIndex(rowIndex),
      product_code: normalizeProductCode(productCode),
      status,
      reason: String(reason || '').trim()
    });
  }

  return {
    recordCreated(rowIndex, productCode, reason = '创建成功') {
      state.created += 1;
      push('created', rowIndex, productCode, reason);
    },
    recordSkipped(rowIndex, productCode, reason = '已跳过') {
      state.skipped += 1;
      push('skipped', rowIndex, productCode, reason);
    },
    recordError(rowIndex, productCode, reason = '导入失败') {
      state.errors += 1;
      push('error', rowIndex, productCode, reason);
    },
    toResponse() {
      return {
        created: state.created,
        skipped: state.skipped,
        errors: state.errors,
        results: state.results.slice()
      };
    }
  };
}

module.exports = {
  createImportResultTracker
};
