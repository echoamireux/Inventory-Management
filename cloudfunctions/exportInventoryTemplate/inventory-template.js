const DATA_SHEET_NAME = '库存入库表';
const CONFIG_SHEET_NAME = 'Config';
const HELP_SHEET_NAME = '【必看】填写指导与示例';
const TEMPLATE_KIND = 'inventory_import';
const TEMPLATE_SCHEMA_VERSION = 'inventory-import-v2';
const INVENTORY_TEMPLATE_GROUP_HEADERS = [
  '基础信息',
  '库位信息',
  '化材信息',
  '膜材信息',
  '来源信息',
  '时效信息'
];
const INVENTORY_TEMPLATE_HEADERS = [
  '标签编号*',
  '产品代码*',
  '类别*',
  '生产批号*',
  '存储区域*',
  '详细坐标',
  '净含量',
  '包装形式',
  '膜材厚度(μm)',
  '本批次实际幅宽(mm)',
  '长度(m)',
  '供应商',
  '原厂型号',
  '过期日期',
  '长期有效'
];
const TEMPLATE_INLINE_HINTS = [
  '必填',
  '必填',
  '必填',
  '必填',
  '必填',
  '选填',
  '化材必填',
  '化材选填',
  '膜材条件必填',
  '膜材必填',
  '膜材必填',
  '选填',
  '选填',
  '二选一',
  '二选一'
];
const CATEGORY_OPTIONS = ['化材', '膜材'];
const TEMPLATE_MAX_ROW = 3000;
const TEMPLATE_PREVIEW_STYLED_ROW_COUNT = 80;
const TEMPLATE_DATA_START_ROW = 4;

function buildInventoryTemplateSpec({
  chemicalZones = [],
  filmZones = []
} = {}) {
  const chemicalZoneEnd = chemicalZones.length + 1;
  const filmZoneEnd = filmZones.length + 1;

  return {
    dataSheetName: DATA_SHEET_NAME,
    configSheetName: CONFIG_SHEET_NAME,
    helpSheetName: HELP_SHEET_NAME,
    templateKind: TEMPLATE_KIND,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    groupHeaders: INVENTORY_TEMPLATE_GROUP_HEADERS.slice(),
    headers: INVENTORY_TEMPLATE_HEADERS.slice(),
    inlineHints: TEMPLATE_INLINE_HINTS.slice(),
    maxRow: TEMPLATE_MAX_ROW,
    previewStyledRowCount: TEMPLATE_PREVIEW_STYLED_ROW_COUNT,
    validationRanges: {
      labelCode: `A${TEMPLATE_DATA_START_ROW}:A${TEMPLATE_MAX_ROW}`,
      productCode: `B${TEMPLATE_DATA_START_ROW}:B${TEMPLATE_MAX_ROW}`,
      category: `C${TEMPLATE_DATA_START_ROW}:C${TEMPLATE_MAX_ROW}`,
      zone: `E${TEMPLATE_DATA_START_ROW}:E${TEMPLATE_MAX_ROW}`,
      netContent: `G${TEMPLATE_DATA_START_ROW}:G${TEMPLATE_MAX_ROW}`,
      thicknessUm: `I${TEMPLATE_DATA_START_ROW}:I${TEMPLATE_MAX_ROW}`,
      batchWidthMm: `J${TEMPLATE_DATA_START_ROW}:J${TEMPLATE_MAX_ROW}`,
      lengthM: `K${TEMPLATE_DATA_START_ROW}:K${TEMPLATE_MAX_ROW}`,
      expiryDate: `N${TEMPLATE_DATA_START_ROW}:N${TEMPLATE_MAX_ROW}`,
      longTerm: `O${TEMPLATE_DATA_START_ROW}:O${TEMPLATE_MAX_ROW}`
    },
    validationFormulae: {
      zone: `INDIRECT($C${TEMPLATE_DATA_START_ROW}&"_库区")`,
      expiryDate: `OR(N${TEMPLATE_DATA_START_ROW}="",AND(ISNUMBER(N${TEMPLATE_DATA_START_ROW}),N${TEMPLATE_DATA_START_ROW}>=TODAY()))`
    },
    definedNames: {
      chemicalZones: {
        name: '化材_库区',
        range: `Config!$A$2:$A$${chemicalZoneEnd}`
      },
      filmZones: {
        name: '膜材_库区',
        range: `Config!$B$2:$B$${filmZoneEnd}`
      }
    },
    zoneOptions: {
      chemical: chemicalZones.slice(),
      film: filmZones.slice()
    },
    helpLines: [
      '【重要：填写说明】',
      '',
      '1. 请先导出系统最新库存入库模板，不要复用历史旧模板。',
      '2. 模板填写完成后，请直接上传 .xlsx 文件回到系统预览。',
      '3. 第 4 行开始填写正式数据；前 3 行为分组抬头、字段名和填写提示，请勿改动。',
      '4. 一行代表一个标签编号，对应一条库存记录。',
      '',
      '▶ 字段说明',
      '标签编号*：必填。格式固定为 L + 6 位数字，例如 L000123。',
      '产品代码*：必填。请填写 3 位数字，例如 001；系统会按类别归一化为标准产品代码。',
      '类别*：必填。只能选择“化材”或“膜材”。',
      '生产批号* / 存储区域*：必填。存储区域必须从当前系统启用库区中选择。',
      '过期日期 / 长期有效：二选一；过期日期请按 YYYY-MM-DD 填写，且必须是合法日期并且不能早于当天。',
      '默认单位由系统按主数据自动带出，本模板无需填写单位。',
      '净含量：仅化材必填；膜材请留空。',
      '包装形式：仅化材选填；膜材请留空。',
      '膜材厚度(μm)：膜材条件必填。主数据已有厚度时可留空，否则必须填写。',
      '本批次实际幅宽(mm) / 长度(m)：仅膜材必填；化材请留空。',
      '供应商 / 原厂型号：选填，系统会优先沿用当前主数据，不会把 Excel 当成主数据来源。',
      '',
      `当前化材库区：${chemicalZones.join(' / ')}`,
      `当前膜材库区：${filmZones.join(' / ')}`
    ],
    exampleRows: [
      ['L000101', '001', '化材', 'AC240301', chemicalZones[0] || '实验室1', 'A01', '2', '桶装', '', '', '', '国药', 'IPA-99', '2026-10-01', ''],
      ['L000201', '001', '膜材', 'PET2601', filmZones[0] || '研发仓1', 'F01', '', '', '50', '1080', '100', '东丽', 'T100', '', '是']
    ]
  };
}

module.exports = {
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  TEMPLATE_KIND,
  TEMPLATE_SCHEMA_VERSION,
  INVENTORY_TEMPLATE_GROUP_HEADERS,
  INVENTORY_TEMPLATE_HEADERS,
  TEMPLATE_INLINE_HINTS,
  CATEGORY_OPTIONS,
  TEMPLATE_MAX_ROW,
  TEMPLATE_PREVIEW_STYLED_ROW_COUNT,
  TEMPLATE_DATA_START_ROW,
  buildInventoryTemplateSpec
};
