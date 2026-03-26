const XLSX = require('./xlsx.mini.min.js');

const IMPORT_TEMPLATE_ERROR_CODES = {
  unsupportedExtension: 'unsupported_extension',
  unsupportedBinaryPayload: 'unsupported_binary_payload',
  missingSheet: 'missing_sheet',
  headerMismatch: 'header_mismatch',
  legacyRuntimeMismatch: 'legacy_runtime_mismatch',
  emptyDataRows: 'empty_data_rows'
};

const TEMPLATE_PROTOCOLS = {
  inventory_import: ['inventory-import-v2'],
  material_import: ['material-import-v1']
};

function buildImportTemplateError(code, message, details) {
  const error = new Error(String(message || '文件解析失败'));
  error.code = code || '';
  error.details = details || null;
  return error;
}

function getFileExtension(fileName = '') {
  const value = String(fileName || '').trim().toLowerCase();
  const dotIndex = value.lastIndexOf('.');
  return dotIndex >= 0 ? value.slice(dotIndex) : '';
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return String(value).trim();
}

function normalizeRowValues(values = []) {
  return (Array.isArray(values) ? values : []).map(normalizeCellValue);
}

function normalizeExpectedRow(values = []) {
  return normalizeRowValues(values);
}

function rowsFromAoA(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((values, index) => ({
    rowIndex: index + 1,
    values: normalizeRowValues(values)
  }));
}

function attachParsedTemplateMeta(rows, meta) {
  const list = Array.isArray(rows) ? rows : [];
  Object.defineProperty(list, '__templateMeta', {
    value: meta || null,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return list;
}

function getParsedTemplateMeta(rows) {
  return rows && rows.__templateMeta ? rows.__templateMeta : null;
}

function parseCsvLine(line = '') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsvText(content = '') {
  const rows = [];
  const text = String(content || '').replace(/^\uFEFF/u, '');
  let currentCell = '';
  let currentRow = [];
  let inQuotes = false;
  let rowIndex = 1;

  function pushCell() {
    currentRow.push(currentCell.trim());
    currentCell = '';
  }

  function pushRow() {
    rows.push({
      rowIndex,
      values: currentRow.slice()
    });
    currentRow = [];
    rowIndex += 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      pushCell();
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      pushCell();
      pushRow();
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      continue;
    }

    currentCell += char;
  }

  if (currentCell || currentRow.length > 0) {
    pushCell();
    pushRow();
  }

  return rows;
}

function rowMatchesExpected(rowValues = [], expectedValues = []) {
  const expected = normalizeExpectedRow(expectedValues);
  const actual = normalizeExpectedRow(rowValues).slice(0, expected.length);
  while (actual.length < expected.length) {
    actual.push('');
  }
  return actual.every((value, index) => value === expected[index]);
}

function matchesExpectedHeaderRows(rows = [], expectedHeaderRows = []) {
  const expected = Array.isArray(expectedHeaderRows) ? expectedHeaderRows : [];
  if (!expected.length) {
    return true;
  }

  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(item => item && Array.isArray(item.values))
    .filter(item => item.values.some(value => normalizeCellValue(value)));

  if (candidates.length < expected.length) {
    return false;
  }

  return expected.every((headerRow, index) => rowMatchesExpected(candidates[index].values, headerRow));
}

function getObjectTag(value) {
  return Object.prototype.toString.call(value);
}

function toUint8Array(fileContent) {
  if (fileContent == null) {
    return null;
  }

  if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(fileContent)) {
    return new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
  }

  if (ArrayBuffer.isView(fileContent)) {
    return new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
  }

  // Mini-program runtimes can hand back cross-context ArrayBuffer values that
  // fail instanceof checks even though they are valid binary payloads.
  if (getObjectTag(fileContent) === '[object ArrayBuffer]') {
    try {
      return new Uint8Array(fileContent);
    } catch (_error) {
      // Fall through to the more defensive copy paths below.
    }
  }

  if (typeof fileContent === 'object') {
    const nestedBuffer = fileContent.buffer;
    if (nestedBuffer && (ArrayBuffer.isView(nestedBuffer) || getObjectTag(nestedBuffer) === '[object ArrayBuffer]')) {
      try {
        return new Uint8Array(
          ArrayBuffer.isView(nestedBuffer) ? nestedBuffer.buffer : nestedBuffer,
          Number(fileContent.byteOffset) || 0,
          Number(fileContent.byteLength) || undefined
        );
      } catch (_error) {
        // Ignore and try the conservative copy fallback below.
      }
    }

    if (typeof fileContent.byteLength === 'number' && fileContent.byteLength > 0) {
      if (typeof fileContent.slice === 'function') {
        try {
          const sliced = fileContent.slice(0);
          if (getObjectTag(sliced) === '[object ArrayBuffer]') {
            return new Uint8Array(sliced);
          }
        } catch (_error) {
          // Ignore and try the array-like fallback below.
        }
      }

      const hasIndexedBytes = typeof fileContent.length === 'number'
        || Object.prototype.hasOwnProperty.call(fileContent, 0);
      if (!hasIndexedBytes) {
        return null;
      }

      try {
        const sliceLength = typeof fileContent.length === 'number'
          ? Math.min(Number(fileContent.length) || 0, Number(fileContent.byteLength) || 0)
          : Number(fileContent.byteLength) || 0;
        return Uint8Array.from(Array.prototype.slice.call(fileContent, 0, sliceLength));
      } catch (_error) {
        // Ignore and return null below.
      }
    }
  }

  return null;
}

function decodeWithEncoding(uint8, encoding, { fatal = false } = {}) {
  if (typeof TextDecoder !== 'function') {
    throw new Error('当前环境不支持文本解码');
  }
  return new TextDecoder(encoding, { fatal }).decode(uint8).replace(/^\uFEFF/u, '');
}

function buildCsvDecodeCandidates(uint8) {
  const candidates = [];
  const seen = new Set();
  const attempts = [
    { encoding: 'utf-8', fatal: true },
    { encoding: 'utf-8', fatal: false },
    { encoding: 'gb18030', fatal: false },
    { encoding: 'gbk', fatal: false }
  ];

  attempts.forEach(({ encoding, fatal }) => {
    try {
      const text = decodeWithEncoding(uint8, encoding, { fatal });
      if (!seen.has(text)) {
        seen.add(text);
        candidates.push(text);
      }
    } catch (_error) {
      // Ignore unsupported encodings and try the next candidate.
    }
  });

  if (!candidates.length) {
    throw new Error('文件解析失败');
  }

  return candidates;
}

function looksLikeDelimitedText(text = '') {
  const value = String(text || '');
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (!/[,\n\r\t]/.test(trimmed)) {
    return false;
  }
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed);
}

function detectFileType(fileContent, fileName = '') {
  const extension = getFileExtension(fileName);
  if (extension === '.xlsx') {
    return extension;
  }
  if (extension) {
    return extension;
  }

  const uint8 = toUint8Array(fileContent);
  if (uint8 && uint8.length >= 4) {
    const isZip = uint8[0] === 0x50 && uint8[1] === 0x4B;
    if (isZip) {
      return '.xlsx';
    }
  }

  return '';
}

function inferTemplateKind(options = {}) {
  const explicit = String(options.templateKind || '').trim();
  if (explicit) {
    return explicit;
  }
  const sheetName = String(options.sheetName || '').trim();
  if (sheetName === '库存入库表') {
    return 'inventory_import';
  }
  if (sheetName === '物料导入表') {
    return 'material_import';
  }
  return '';
}

function getStrongHeaderSpec(expectedHeaderRows = []) {
  const rows = Array.isArray(expectedHeaderRows) ? expectedHeaderRows : [];
  if (!rows.length) {
    return {
      hardHeader: [],
      strongIndex: 0,
      trailingWeakRows: []
    };
  }

  const strongIndex = rows.length >= 3 ? 1 : 0;
  return {
    hardHeader: rows[strongIndex] || rows[0] || [],
    strongIndex,
    trailingWeakRows: rows.slice(strongIndex + 1)
  };
}

function summarizeHeader(values = [], limit = 15) {
  return normalizeRowValues(values)
    .slice(0, limit)
    .map(value => value || '∅')
    .join(' | ');
}

function readSheetCell(sheet, address) {
  if (!sheet || !address || !sheet[address]) {
    return '';
  }
  const cell = sheet[address];
  return normalizeCellValue(cell && Object.prototype.hasOwnProperty.call(cell, 'w') ? cell.w : cell.v);
}

function readTemplateMetaFromWorkbook(workbook) {
  if (!workbook || !workbook.Sheets) {
    return null;
  }

  const configSheet = workbook.Sheets.Config;
  if (!configSheet) {
    return null;
  }

  const kindKey = readSheetCell(configSheet, 'X1');
  const schemaKey = readSheetCell(configSheet, 'X2');
  const templateKind = readSheetCell(configSheet, 'Y1');
  const schemaVersion = readSheetCell(configSheet, 'Y2');

  if (kindKey !== 'template_kind' || schemaKey !== 'schema_version') {
    return null;
  }
  if (!templateKind && !schemaVersion) {
    return null;
  }

  return {
    templateKind,
    schemaVersion
  };
}

function validateTemplateMeta(meta, options = {}) {
  if (!meta || (!meta.templateKind && !meta.schemaVersion)) {
    return null;
  }

  const expectedTemplateKind = inferTemplateKind(options);
  const details = {
    templateKind: meta.templateKind || '',
    schemaVersion: meta.schemaVersion || '',
    expectedTemplateKind
  };

  if (expectedTemplateKind && meta.templateKind && meta.templateKind !== expectedTemplateKind) {
    throw buildImportTemplateError(
      IMPORT_TEMPLATE_ERROR_CODES.headerMismatch,
      options.invalidTemplateMessage || '模板字段顺序不正确，请使用系统当前模板中的正式字段行',
      details
    );
  }

  const supportedSchemaVersions = TEMPLATE_PROTOCOLS[meta.templateKind] || [];
  if (meta.schemaVersion && supportedSchemaVersions.length && !supportedSchemaVersions.includes(meta.schemaVersion)) {
    throw buildImportTemplateError(
      IMPORT_TEMPLATE_ERROR_CODES.legacyRuntimeMismatch,
      options.legacyRuntimeMessage || '当前模板协议与系统运行版本不一致，请更新后重试',
      details
    );
  }

  return details;
}

function buildHeaderMismatchError(rows = [], options = {}) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(item => item && Array.isArray(item.values))
    .filter(item => item.values.some(value => normalizeCellValue(value)));
  const { hardHeader, strongIndex } = getStrongHeaderSpec(options.expectedHeaderRows);
  const fallbackCandidate = candidates[strongIndex] || candidates[0] || { rowIndex: 0, values: [] };

  return buildImportTemplateError(
    IMPORT_TEMPLATE_ERROR_CODES.headerMismatch,
    options.invalidTemplateMessage || '模板字段顺序不正确，请使用系统当前模板中的正式字段行',
    {
      headerRowIndex: fallbackCandidate.rowIndex || 0,
      expectedHeader: normalizeExpectedRow(hardHeader),
      actualHeader: normalizeRowValues(fallbackCandidate.values).slice(0, normalizeExpectedRow(hardHeader).length),
      actualHeaderSummary: summarizeHeader(fallbackCandidate.values)
    }
  );
}

function looksLikeInventoryDataRow(values = []) {
  const first = normalizeCellValue(values[0]);
  return /^L\d{6}$/i.test(first);
}

function looksLikeMaterialDataRow(values = []) {
  const productCode = normalizeCellValue(values[0]);
  const category = normalizeCellValue(values[2]);
  return !!productCode && !!category && (category === '化材' || category === '膜材');
}

function looksLikeLikelyDataRow(values = [], templateKind = '') {
  if (templateKind === 'inventory_import') {
    return looksLikeInventoryDataRow(values);
  }
  if (templateKind === 'material_import') {
    return looksLikeMaterialDataRow(values);
  }
  return looksLikeInventoryDataRow(values) || looksLikeMaterialDataRow(values);
}

function buildRowIndexMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((item) => {
    if (!item || !Array.isArray(item.values)) {
      return;
    }
    map.set(Number(item.rowIndex) || 0, item);
  });
  return map;
}

function inspectParsedRows(rows = [], options = {}) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(item => item && Array.isArray(item.values))
    .filter(item => item.values.some(value => normalizeCellValue(value)));
  const { hardHeader, strongIndex, trailingWeakRows } = getStrongHeaderSpec(options.expectedHeaderRows);

  if (!hardHeader.length) {
    return {
      headerRowIndex: 1,
      dataStartRowIndex: 1
    };
  }

  let matchedCandidate = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (rowMatchesExpected(candidates[index].values, hardHeader)) {
      matchedCandidate = candidates[index];
      break;
    }
  }

  if (!matchedCandidate) {
    throw buildHeaderMismatchError(rows, options);
  }

  const rowIndexMap = buildRowIndexMap(rows);
  let cursor = Number(matchedCandidate.rowIndex) || (strongIndex + 1);
  for (let index = 0; index < trailingWeakRows.length; index += 1) {
    const nextRow = rowIndexMap.get(cursor + 1);
    if (!nextRow) {
      break;
    }
    if (looksLikeLikelyDataRow(nextRow.values, inferTemplateKind(options))) {
      break;
    }
    cursor += 1;
  }

  return {
    headerRowIndex: Number(matchedCandidate.rowIndex) || 0,
    dataStartRowIndex: cursor + 1
  };
}

function parseXlsxRows(fileContent, options = {}) {
  const uint8 = toUint8Array(fileContent);
  if (!uint8) {
    throw buildImportTemplateError(
      IMPORT_TEMPLATE_ERROR_CODES.unsupportedBinaryPayload,
      options.binaryPayloadMessage || '文件内容读取失败',
      {
        fileName: String(options.fileName || ''),
        payloadTag: getObjectTag(fileContent)
      }
    );
  }

  const workbook = XLSX.read(uint8, {
    type: 'array',
    cellDates: true
  });
  const sheetName = String(options.sheetName || '').trim();
  const sheetNames = workbook.SheetNames || [];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw buildImportTemplateError(
      IMPORT_TEMPLATE_ERROR_CODES.missingSheet,
      options.invalidTemplateMessage || '文件解析失败',
      {
        expectedSheetName: sheetName,
        sheetNames
      }
    );
  }

  const meta = readTemplateMetaFromWorkbook(workbook);
  validateTemplateMeta(meta, options);

  const rows = rowsFromAoA(XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    dateNF: 'yyyy-mm-dd'
  }));

  const structure = inspectParsedRows(rows, options);
  return attachParsedTemplateMeta(rows, {
    templateKind: meta && meta.templateKind ? meta.templateKind : inferTemplateKind(options),
    schemaVersion: meta && meta.schemaVersion ? meta.schemaVersion : '',
    headerRowIndex: structure.headerRowIndex,
    dataStartRowIndex: structure.dataStartRowIndex,
    sheetName
  });
}

function parseCsvRows(fileContent, options = {}) {
  let rows = null;

  if (typeof fileContent === 'string') {
    rows = parseCsvText(fileContent);
  } else {
    const uint8 = toUint8Array(fileContent);
    if (!uint8) {
      throw buildImportTemplateError(
        IMPORT_TEMPLATE_ERROR_CODES.unsupportedBinaryPayload,
        options.binaryPayloadMessage || '文件内容读取失败',
        {
          fileName: String(options.fileName || ''),
          payloadTag: getObjectTag(fileContent)
        }
      );
    }

    const decodeCandidates = buildCsvDecodeCandidates(uint8);
    for (let index = 0; index < decodeCandidates.length; index += 1) {
      const candidateRows = parseCsvText(decodeCandidates[index]);
      try {
        inspectParsedRows(candidateRows, options);
        rows = candidateRows;
        break;
      } catch (_error) {
        if (!rows) {
          rows = candidateRows;
        }
      }
    }
  }

  const structure = inspectParsedRows(rows, options);
  return attachParsedTemplateMeta(rows, {
    templateKind: inferTemplateKind(options),
    schemaVersion: '',
    headerRowIndex: structure.headerRowIndex,
    dataStartRowIndex: structure.dataStartRowIndex,
    sheetName: String(options.sheetName || '').trim()
  });
}

function resolveImportTemplateErrorMessage(error, options = {}) {
  const fallback = options.fallbackMessage || '文件解析失败';
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.unsupportedExtension) {
    return '当前仅支持上传系统导出的 .xlsx 模板';
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.unsupportedBinaryPayload) {
    return options.binaryPayloadMessage || '当前运行环境未正确识别文件内容，请重新选择文件或更新解析器';
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.missingSheet) {
    const sheetName = String(options.sheetName || '').trim();
    return sheetName
      ? `文件中缺少“${sheetName}”工作表，请使用系统导出的模板文件`
      : (error.message || fallback);
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.headerMismatch) {
    return error.message || options.invalidTemplateMessage || fallback;
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.legacyRuntimeMismatch) {
    return options.legacyRuntimeMessage || error.message || fallback;
  }

  if (error.code === IMPORT_TEMPLATE_ERROR_CODES.emptyDataRows) {
    return error.message || fallback;
  }

  return error.message || fallback;
}

function parseImportTemplateFileBuffer(fileContent, options = {}) {
  const extension = detectFileType(fileContent, options.fileName);

  if (extension === '.xlsx') {
    return parseXlsxRows(fileContent, options);
  }

  throw buildImportTemplateError(
    IMPORT_TEMPLATE_ERROR_CODES.unsupportedExtension,
    '当前仅支持上传系统导出的 .xlsx 模板',
    {
      fileName: String(options.fileName || ''),
      detectedExtension: extension || ''
    }
  );
}

module.exports = {
  IMPORT_TEMPLATE_ERROR_CODES,
  buildImportTemplateError,
  parseCsvLine,
  matchesExpectedHeaderRows,
  parseImportTemplateFileBuffer,
  getParsedTemplateMeta,
  resolveImportTemplateErrorMessage
};
