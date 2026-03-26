let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (_error) {
  ExcelJS = require('../exportMaterialTemplate/node_modules/exceljs');
}

const OFFSET_MS = 8 * 60 * 60 * 1000;

const LABEL_EXPORT_TEMPLATE_TYPES = {
  film: '膜材信息标签',
  chemical_std: '化材标准瓶信息标签',
  chemical_mini: '化材小瓶信息标签'
};

const LABEL_EXPORT_HEADERS = {
  film: ['标签编号', '产品代码', '物料名称', '子类别', '厚度', '幅宽', '批次', '过期日期'],
  chemical_std: ['标签编号', '产品代码', '物料名称'],
  chemical_mini: ['标签编号', '产品代码']
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCstParts(value) {
  const date = toDate(value);
  if (!date) {
    return null;
  }

  const cstDate = new Date(date.getTime() + OFFSET_MS);
  return {
    year: cstDate.getUTCFullYear(),
    month: pad(cstDate.getUTCMonth() + 1),
    day: pad(cstDate.getUTCDate()),
    hour: pad(cstDate.getUTCHours()),
    minute: pad(cstDate.getUTCMinutes()),
    second: pad(cstDate.getUTCSeconds())
  };
}

function formatExportDateTime(value) {
  const parts = getCstParts(value);
  if (!parts) {
    return '--';
  }

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatExportDate(value) {
  const parts = getCstParts(value);
  if (!parts) {
    return '--';
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizePositiveNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function normalizeTemplateType(templateType = 'film') {
  const normalized = String(templateType || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LABEL_EXPORT_TEMPLATE_TYPES, normalized)) {
    throw new Error('无效的信息标签模板类型');
  }
  return normalized;
}

function resolveTemplateLabel(templateType = 'film') {
  return LABEL_EXPORT_TEMPLATE_TYPES[normalizeTemplateType(templateType)];
}

function resolveTemplateCategory(templateType = 'film') {
  const normalized = normalizeTemplateType(templateType);
  return normalized === 'film' ? 'film' : 'chemical';
}

function buildLabelExportFileName(templateType = 'film', exportedAt = new Date()) {
  const parts = getCstParts(exportedAt);
  const templateLabel = resolveTemplateLabel(templateType);
  if (!parts) {
    return `${templateLabel}.xlsx`;
  }

  return `${templateLabel}_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}.xlsx`;
}

function formatOptionalSpecValue(value, unit) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return '--';
  }
  return `${value} ${unit}`;
}

function resolveFilmSpecParts(item = {}, material = {}) {
  const dynamicAttrs = item.dynamic_attrs || {};
  const itemSpecs = item.specs || {};
  const materialSpecs = material.specs || {};

  const width = normalizePositiveNumber(
    dynamicAttrs.width_mm !== undefined
      ? dynamicAttrs.width_mm
      : (
        itemSpecs.standard_width_mm !== undefined
          ? itemSpecs.standard_width_mm
          : (
            materialSpecs.standard_width_mm !== undefined
              ? materialSpecs.standard_width_mm
              : (itemSpecs.width_mm !== undefined ? itemSpecs.width_mm : materialSpecs.width_mm)
          )
      )
  );

  const thickness = normalizePositiveNumber(
    materialSpecs.thickness_um !== undefined
      ? materialSpecs.thickness_um
      : (
        itemSpecs.thickness_um !== undefined
          ? itemSpecs.thickness_um
          : dynamicAttrs.thickness_um
      )
  );

  return {
    widthLabel: formatOptionalSpecValue(width, 'mm'),
    thicknessLabel: formatOptionalSpecValue(thickness, 'μm')
  };
}

function resolveExportExpiryLabel(item = {}) {
  const explicitExpiry = item.expiry_date || (item.dynamic_attrs && item.dynamic_attrs.expiry_date);
  if (explicitExpiry) {
    return formatExportDate(explicitExpiry);
  }
  if (item.is_long_term_valid) {
    return '长期有效';
  }
  return '未设置过期日';
}

function buildLabelExportRow(templateType = 'film', item = {}, context = {}) {
  const normalizedType = normalizeTemplateType(templateType);
  const material = context.material || {};
  const uniqueCode = String(item.unique_code || '').trim() || '--';
  const productCode = String(item.product_code || material.product_code || '').trim() || '--';
  const materialName = String(item.material_name || material.material_name || material.name || '').trim() || '--';

  if (normalizedType === 'chemical_mini') {
    return {
      标签编号: uniqueCode,
      产品代码: productCode
    };
  }

  if (normalizedType === 'chemical_std') {
    return {
      标签编号: uniqueCode,
      产品代码: productCode,
      物料名称: materialName
    };
  }

  const filmSpecParts = resolveFilmSpecParts(item, material);
  const subCategory = String(item.sub_category || material.sub_category || '').trim() || '--';
  const batchNumber = String(item.batch_number || '').trim() || '--';

  return {
    标签编号: uniqueCode,
    产品代码: productCode,
    物料名称: materialName,
    子类别: subCategory,
    厚度: filmSpecParts.thicknessLabel,
    幅宽: filmSpecParts.widthLabel,
    批次: batchNumber,
    过期日期: resolveExportExpiryLabel(item)
  };
}

function sortLabelExportRecordsBySelection(records = [], selectedIds = []) {
  const orderMap = new Map(
    (selectedIds || []).map((id, index) => [String(id), index])
  );

  return [...(records || [])].sort((left, right) => {
    const leftOrder = orderMap.has(String(left && left._id)) ? orderMap.get(String(left._id)) : Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.has(String(right && right._id)) ? orderMap.get(String(right._id)) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function buildHeaderFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1E3A8A' }
  };
}

function buildThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'D1D5DB' } },
    left: { style: 'thin', color: { argb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
    right: { style: 'thin', color: { argb: 'D1D5DB' } }
  };
}

function buildColumnWidths(templateType = 'film') {
  const normalizedType = normalizeTemplateType(templateType);
  if (normalizedType === 'chemical_mini') {
    return [16, 16];
  }
  if (normalizedType === 'chemical_std') {
    return [16, 16, 28];
  }
  return [16, 16, 28, 16, 12, 12, 18, 16];
}

async function buildLabelExportWorkbook({
  templateType = 'film',
  exportedAt = new Date(),
  rows = []
} = {}) {
  const normalizedType = normalizeTemplateType(templateType);
  const templateLabel = resolveTemplateLabel(normalizedType);
  const headers = LABEL_EXPORT_HEADERS[normalizedType];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(templateLabel);

  const columnWidths = buildColumnWidths(normalizedType);
  sheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: columnWidths[index] || 18
  }));

  const lastColumnLetter = String.fromCharCode(64 + headers.length);
  sheet.mergeCells(`A1:${lastColumnLetter}1`);
  sheet.getCell('A1').value = templateLabel;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: '1E3A8A' } };
  sheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };

  sheet.mergeCells(`A2:${lastColumnLetter}2`);
  sheet.getCell('A2').value = `导出时间：${formatExportDateTime(exportedAt)}`;
  sheet.getCell('A2').font = { size: 10, color: { argb: '64748B' } };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };

  const headerRow = sheet.getRow(4);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.fill = buildHeaderFill();
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = buildThinBorder();
  });
  headerRow.height = 22;

  (rows || []).forEach((row, index) => {
    const excelRow = sheet.getRow(index + 5);
    headers.forEach((header, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = row[header] !== undefined ? row[header] : '--';
      cell.border = buildThinBorder();
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (header === '标签编号' || header === '产品代码') {
        cell.font = { bold: true, color: { argb: '1E3A8A' } };
      }
    });
  });

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: headers.length }
  };
  sheet.views = [{ state: 'frozen', ySplit: 4 }];

  return workbook;
}

module.exports = {
  LABEL_EXPORT_TEMPLATE_TYPES,
  LABEL_EXPORT_HEADERS,
  normalizeTemplateType,
  resolveTemplateLabel,
  resolveTemplateCategory,
  buildLabelExportFileName,
  buildLabelExportRow,
  buildLabelExportWorkbook,
  sortLabelExportRecordsBySelection,
  formatExportDateTime
};
