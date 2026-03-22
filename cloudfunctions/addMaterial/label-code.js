function normalizeLabelCodeInput(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) {
    return '';
  }

  if (/^\d{1,6}$/.test(raw)) {
    return `L${raw.padStart(6, '0')}`;
  }

  const partialMatch = raw.match(/^L(\d{1,6})$/);
  if (partialMatch) {
    return `L${partialMatch[1].padStart(6, '0')}`;
  }

  if (/^L\d{6}$/.test(raw)) {
    return raw;
  }

  return raw;
}

function isValidLabelCode(value) {
  return /^L\d{6}$/.test(String(value || '').trim().toUpperCase());
}

module.exports = {
  normalizeLabelCodeInput,
  isValidLabelCode
};
