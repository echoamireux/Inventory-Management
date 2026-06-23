function shouldBlockTestMaterialProductOnlyWithdrawal({
  unique_code,
  product_code,
  batch_no,
  candidates = [],
  material = null
} = {}) {
  if (!product_code || unique_code || batch_no) {
    return { blocked: false, msg: '' };
  }

  const hasTestCandidate = (Array.isArray(candidates) ? candidates : [])
    .some(item => item && item.is_test_material);
  const materialIsTest = !!(material && material.is_test_material);

  if (!hasTestCandidate && !materialIsTest) {
    return { blocked: false, msg: '' };
  }

  return {
    blocked: true,
    msg: '测试料请扫码标签或选择明确批次后出库，不能仅按产品代码自动扣减'
  };
}

module.exports = {
  shouldBlockTestMaterialProductOnlyWithdrawal
};
