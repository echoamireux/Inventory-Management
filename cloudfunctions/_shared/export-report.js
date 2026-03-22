const { OFFSET_MS } = require('./cst-time');
const { getFilmDisplayState } = require('./film-quantity');
const { resolveSubcategoryDisplay } = require('./material-subcategories');

let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (error) {
  ExcelJS = require('../exportMaterialTemplate/node_modules/exceljs');
}

const EXPORT_TITLE = '库存明细报表';
const EXPORT_SHEET_NAME = '库存明细';
const EXPORT_HEADERS = [
  '产品代码',
  '物料名称',
  '标签编号',
  '类别',
  '子类别',
  '生产批号',
  '当前库存',
  '单位',
  '库区',
  '详细坐标',
  '化材包装形式',
  '膜材幅宽(mm)',
  '膜材厚度(μm)',
  '供应商',
  '原厂型号',
  '过期日期',
  '状态',
  '入库时间'
];

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

function buildInventoryExportFileName(exportedAt = new Date()) {
  const parts = getCstParts(exportedAt);
  if (!parts) {
    return `${EXPORT_TITLE}.xlsx`;
  }

  return `${EXPORT_TITLE}_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}.xlsx`;
}

function resolveCategoryLabel(category) {
  if (category === 'film') {
    return '膜材';
  }
  if (category === 'chemical') {
    return '化材';
  }
  return '--';
}

function resolveStatusLabel(item, quantityValue) {
  if (item && item.status === 'out_of_stock') {
    return '已用完';
  }
  return Number(quantityValue) > 0 ? '在库' : '已用完';
}

function normalizePositiveNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function resolveChemicalPackageType(item = {}, material = {}) {
  const packageType = String(material.package_type || item.package_type || '').trim();
  return packageType || '--';
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
    widthMm: width || '--',
    thicknessUm: thickness || '--'
  };
}

function resolveZoneLabel(item = {}, zoneMap) {
  const zoneKey = String(item.zone_key || '').trim();
  if (!zoneKey || !(zoneMap instanceof Map)) {
    return '--';
  }

  const zoneRecord = zoneMap.get(zoneKey);
  const zoneName = String((zoneRecord && zoneRecord.name) || '').trim();
  return zoneName || '--';
}

function resolveLocationDetail(item = {}) {
  const detail = String(item.location_detail || '').trim();
  return detail || '--';
}

function buildInventoryExportRow(item = {}, context = {}) {
  const material = context.material || {};
  const zoneMap = context.zoneMap;
  const subcategoryMap = context.subcategoryMap;
  const category = item.category || material.category;
  const quantity = item.quantity || {};

  let currentStock = Number(quantity.val) || 0;
  let unit = String(quantity.unit || material.default_unit || '--').trim() || '--';
  let chemicalPackageType = '--';
  let filmWidthMm = '--';
  let filmThicknessUm = '--';

  if (category === 'film') {
    const filmState = getFilmDisplayState(item, material.default_unit || quantity.unit);
    const filmSpecParts = resolveFilmSpecParts(item, material);
    currentStock = filmState.displayQuantity;
    unit = filmState.displayUnit || unit;
    filmWidthMm = filmSpecParts.widthMm;
    filmThicknessUm = filmSpecParts.thicknessUm;
  } else {
    chemicalPackageType = resolveChemicalPackageType(item, material);
  }

  return {
    productCode: item.product_code || material.product_code || '--',
    materialName: item.material_name || material.material_name || material.name || '--',
    uniqueCode: item.unique_code || '--',
    categoryLabel: resolveCategoryLabel(category),
    subcategoryLabel: resolveSubcategoryDisplay({
      subcategory_key: item.subcategory_key || material.subcategory_key,
      sub_category: item.sub_category || material.sub_category
    }, subcategoryMap) || '--',
    batchNumber: item.batch_number || '--',
    currentStock,
    unit,
    zoneLabel: resolveZoneLabel(item, zoneMap),
    locationDetail: resolveLocationDetail(item),
    chemicalPackageType,
    filmWidthMm,
    filmThicknessUm,
    supplier: item.supplier || material.supplier || '--',
    supplierModel: item.supplier_model || material.supplier_model || '--',
    expiryDate: resolveExportExpiryLabel(item),
    statusLabel: resolveStatusLabel(item, currentStock),
    inboundTime: formatExportDateTime(item.create_time)
  };
}

function buildFilterSummary(filters = {}) {
  const parts = [];
  if (filters.categoryLabel) {
    parts.push(`类别=${filters.categoryLabel}`);
  }

  if (filters.searchVal) {
    parts.push(`搜索词=${filters.searchVal}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `筛选条件：${parts.join('；')}`;
}

function buildHeaderFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1E3A8A' }
  };
}

function buildInfoFill() {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'EFF6FF' }
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

async function buildInventoryExportWorkbook(options = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(EXPORT_SHEET_NAME);
  const rows = options.rows || [];
  const exportedAt = options.exportedAt || new Date();
  const filters = options.filters || {};
  const filterSummary = buildFilterSummary(filters);

  sheet.columns = [
    { header: EXPORT_HEADERS[0], key: 'productCode', width: 14 },
    { header: EXPORT_HEADERS[1], key: 'materialName', width: 24 },
    { header: EXPORT_HEADERS[2], key: 'uniqueCode', width: 18 },
    { header: EXPORT_HEADERS[3], key: 'categoryLabel', width: 10 },
    { header: EXPORT_HEADERS[4], key: 'subcategoryLabel', width: 16 },
    { header: EXPORT_HEADERS[5], key: 'batchNumber', width: 16 },
    { header: EXPORT_HEADERS[6], key: 'currentStock', width: 12 },
    { header: EXPORT_HEADERS[7], key: 'unit', width: 10 },
    { header: EXPORT_HEADERS[8], key: 'zoneLabel', width: 14 },
    { header: EXPORT_HEADERS[9], key: 'locationDetail', width: 18 },
    { header: EXPORT_HEADERS[10], key: 'chemicalPackageType', width: 16 },
    { header: EXPORT_HEADERS[11], key: 'filmWidthMm', width: 16 },
    { header: EXPORT_HEADERS[12], key: 'filmThicknessUm', width: 16 },
    { header: EXPORT_HEADERS[13], key: 'supplier', width: 18 },
    { header: EXPORT_HEADERS[14], key: 'supplierModel', width: 20 },
    { header: EXPORT_HEADERS[15], key: 'expiryDate', width: 14 },
    { header: EXPORT_HEADERS[16], key: 'statusLabel', width: 10 },
    { header: EXPORT_HEADERS[17], key: 'inboundTime', width: 20 }
  ];

  sheet.mergeCells(1, 1, 1, EXPORT_HEADERS.length);
  sheet.getCell('A1').value = EXPORT_TITLE;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: '0F172A' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 24;

  ['A2'].forEach((address) => {
    const cell = sheet.getCell(address);
    cell.fill = buildInfoFill();
    cell.border = buildThinBorder();
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.font = { size: 10, color: { argb: '334155' } };
  });
  sheet.mergeCells(2, 1, 2, EXPORT_HEADERS.length);
  sheet.getCell('A2').value = `导出时间：${formatExportDateTime(exportedAt)}`;

  let headerRowNumber = 4;
  let firstDataRowNumber = 5;
  if (filterSummary) {
    const filterCell = sheet.getCell('A3');
    filterCell.fill = buildInfoFill();
    filterCell.border = buildThinBorder();
    filterCell.alignment = { vertical: 'middle', wrapText: true };
    filterCell.font = { size: 10, color: { argb: '334155' } };
    sheet.mergeCells(3, 1, 3, EXPORT_HEADERS.length);
    sheet.getCell('A3').value = filterSummary;
    headerRowNumber = 5;
    firstDataRowNumber = 6;
  }

  const headerRow = sheet.getRow(headerRowNumber);
  EXPORT_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.fill = buildHeaderFill();
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = buildThinBorder();
  });
  headerRow.height = 22;

  rows.forEach((rowData, index) => {
    const row = sheet.getRow(index + firstDataRowNumber);
    row.values = [
      rowData.productCode,
      rowData.materialName,
      rowData.uniqueCode,
      rowData.categoryLabel,
      rowData.subcategoryLabel,
      rowData.batchNumber,
      rowData.currentStock,
      rowData.unit,
      rowData.zoneLabel,
      rowData.locationDetail,
      rowData.chemicalPackageType,
      rowData.filmWidthMm,
      rowData.filmThicknessUm,
      rowData.supplier,
      rowData.supplierModel,
      rowData.expiryDate,
      rowData.statusLabel,
      rowData.inboundTime
    ];
    row.eachCell((cell) => {
      cell.border = buildThinBorder();
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  });

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: EXPORT_HEADERS.length }
  };
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowNumber }];

  return workbook;
}

module.exports = {
  EXPORT_TITLE,
  EXPORT_SHEET_NAME,
  EXPORT_HEADERS,
  formatExportDateTime,
  formatExportDate,
  buildInventoryExportFileName,
  buildInventoryExportRow,
  buildInventoryExportWorkbook
};
