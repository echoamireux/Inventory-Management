const {
  sortSubcategoryRecords,
  filterSubcategoryRecordsByCategory,
  isSelectableSubcategoryRecord
} = require('./material-subcategories');

const DATA_SHEET_NAME = '物料导入表';
const CONFIG_SHEET_NAME = 'Config';
const HELP_SHEET_NAME = '【必看】填写指导与示例';
const TEMPLATE_KIND = 'material_import';
const TEMPLATE_SCHEMA_VERSION = 'material-import-v2';
const TEMPLATE_HEADERS = [
  '代码前缀',
  '产品编号',
  '物料名称',
  '类别',
  '子类别',
  '默认单位',
  '化材包装形式',
  '膜材厚度(μm)',
  '默认幅宽(mm)',
  '供应商',
  '原厂型号',
  '是否测试料'
];

const CATEGORY_OPTIONS = ['化材', '膜材'];
const UNIT_OPTIONS = {
  chemical: ['kg', 'g', 'L', 'mL'],
  film: ['m', 'm²']
};
const PACKAGE_TYPE_OPTIONS = ['瓶装', '桶装', '袋装', '卷装', '盒装'];
const TEMPLATE_MAX_ROW = 3000;
const TEMPLATE_PREVIEW_STYLED_ROW_COUNT = 50;
const TEMPLATE_DATA_START_ROW = 3;
const TEMPLATE_INLINE_HINTS = [
  '必填',
  '必填',
  '必填',
  '必填',
  '必填',
  '必填',
  '化材选填',
  '膜材必填',
  '膜材选填',
  '选填',
  '选填',
  '选填'
];

function pickRepresentativeSubcategory(subcategories, preferredName) {
  const list = Array.isArray(subcategories) ? subcategories : [];
  if (preferredName && list.includes(preferredName)) {
    return preferredName;
  }
  return list[0] || '';
}

function getActiveTemplateSubcategoryNames(records, category) {
  return filterSubcategoryRecordsByCategory(
    sortSubcategoryRecords(records),
    category,
    { includeDisabled: false, includeDeprecated: false }
  )
    .filter(isSelectableSubcategoryRecord)
    .map(item => item.name);
}

function validateTemplateSubcategoryState({
  chemicalSubcategories = [],
  filmSubcategories = []
} = {}) {
  if (!chemicalSubcategories.length) {
    return {
      ok: false,
      msg: '化材当前没有可用子类别，请先在子类别管理中维护后再导出模板'
    };
  }

  if (!filmSubcategories.length) {
    return {
      ok: false,
      msg: '膜材当前没有可用子类别，请先在子类别管理中维护后再导出模板'
    };
  }

  return { ok: true };
}

function buildMaterialTemplateSpec({
  chemicalSubcategories = [],
  filmSubcategories = [],
  codePrefixes = ['J', 'S', 'Y', 'M']
} = {}) {
  const chemicalSubcategoryEnd = chemicalSubcategories.length + 1;
  const filmSubcategoryEnd = filmSubcategories.length + 1;
  const chemicalUnitEnd = UNIT_OPTIONS.chemical.length + 1;
  const filmUnitEnd = UNIT_OPTIONS.film.length + 1;
  const packageTypeEnd = PACKAGE_TYPE_OPTIONS.length + 1;
  const normalizedCodePrefixes = (Array.isArray(codePrefixes) ? codePrefixes : [])
    .map(item => (typeof item === 'string' ? item : item && item.prefix))
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => /^[A-Z]$/.test(item));
  const codePrefixOptions = Array.from(new Set(normalizedCodePrefixes.length
    ? normalizedCodePrefixes
    : ['J', 'S', 'Y', 'M']));
  const codePrefixEnd = codePrefixOptions.length + 1;
  const chemicalExampleSubcategory = pickRepresentativeSubcategory(
    chemicalSubcategories,
    '溶剂'
  );
  const filmExampleSubcategory = pickRepresentativeSubcategory(
    filmSubcategories,
    '保护膜'
  );

  return {
    dataSheetName: DATA_SHEET_NAME,
    configSheetName: CONFIG_SHEET_NAME,
    helpSheetName: HELP_SHEET_NAME,
    templateKind: TEMPLATE_KIND,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    headers: TEMPLATE_HEADERS.slice(),
    inlineHints: TEMPLATE_INLINE_HINTS.slice(),
    maxRow: TEMPLATE_MAX_ROW,
    previewStyledRowCount: TEMPLATE_PREVIEW_STYLED_ROW_COUNT,
    validationRanges: {
      codePrefix: `A${TEMPLATE_DATA_START_ROW}:A${TEMPLATE_MAX_ROW}`,
      productCodeNumber: `B${TEMPLATE_DATA_START_ROW}:B${TEMPLATE_MAX_ROW}`,
      category: `D${TEMPLATE_DATA_START_ROW}:D${TEMPLATE_MAX_ROW}`,
      subcategory: `E${TEMPLATE_DATA_START_ROW}:E${TEMPLATE_MAX_ROW}`,
      unit: `F${TEMPLATE_DATA_START_ROW}:F${TEMPLATE_MAX_ROW}`,
      packageType: `G${TEMPLATE_DATA_START_ROW}:G${TEMPLATE_MAX_ROW}`,
      thicknessUm: `H${TEMPLATE_DATA_START_ROW}:H${TEMPLATE_MAX_ROW}`,
      standardWidthMm: `I${TEMPLATE_DATA_START_ROW}:I${TEMPLATE_MAX_ROW}`
    },
    validationFormulae: {
      codePrefix: '代码前缀',
      subcategory: `INDIRECT($D${TEMPLATE_DATA_START_ROW}&"_子类")`,
      unit: `INDIRECT($D${TEMPLATE_DATA_START_ROW}&"_单位")`
    },
    definedNames: {
      chemicalSubcategories: {
        name: '化材_子类',
        range: `Config!$A$2:$A$${chemicalSubcategoryEnd}`
      },
      filmSubcategories: {
        name: '膜材_子类',
        range: `Config!$B$2:$B$${filmSubcategoryEnd}`
      },
      chemicalUnits: {
        name: '化材_单位',
        range: `Config!$C$2:$C$${chemicalUnitEnd}`
      },
      filmUnits: {
        name: '膜材_单位',
        range: `Config!$D$2:$D$${filmUnitEnd}`
      },
      chemicalPackageTypes: {
        name: '化材_包装形式',
        range: `Config!$E$2:$E$${packageTypeEnd}`
      },
      codePrefixes: {
        name: '代码前缀',
        range: `Config!$F$2:$F$${codePrefixEnd}`
      }
    },
    categoryOptions: CATEGORY_OPTIONS.slice(),
    unitOptions: {
      chemical: UNIT_OPTIONS.chemical.slice(),
      film: UNIT_OPTIONS.film.slice()
    },
    codePrefixOptions,
    packageTypeOptions: PACKAGE_TYPE_OPTIONS.slice(),
    subcategoryOptions: {
      chemical: chemicalSubcategories.slice(),
      film: filmSubcategories.slice()
    },
    helpLines: [
      '【重要：填写说明】',
      '',
      '1. 请先使用本系统导出的最新模板，不要复用旧模板。',
      '2. 若刚调整过子类别，请重新导出模板后再填写。',
      '3. 模板填写完成后，请直接上传 .xlsx 文件回到系统导入。',
      '',
      '▶ 字段说明',
      '代码前缀*：必填。请从下拉选择 J、S、Y、M 等当前启用前缀，只填写字母，不填写横杠。',
      '产品编号*：必填。请填写 1-3 位数字，例如 1 或 001；系统会补齐为 3 位并与前缀组成完整产品代码。',
      '物料名称*：必填。',
      '类别*：必填。只能选择“化材”或“膜材”。',
      '子类别*：必填。只能选择系统中当前启用的正式子类别。',
      '默认单位*：必填。化材仅支持 kg/g/L/mL；膜材仅支持 m/m²。',
      '化材包装形式：选填。仅化材使用；膜材请留空。',
      '膜材厚度(μm)*：膜材必填；化材请留空。',
      '默认幅宽(mm)：膜材选填；化材请留空。填写即写入主数据默认幅宽，留空则后续补齐。',
      '供应商：选填。',
      '原厂型号：选填；测试料真实原厂型号请在库存入库或标签预打印时填写。',
      '是否测试料：填“是”或“否”，空白按“否”处理；选择“是”后入库、出库和标签打印会启用测试料防呆规则。',
      '模板仅用于新建物料；若产品代码已存在，系统会跳过，不会更新现有主数据。',
      '如现有子类别不适用，请先在系统“子类别管理”中维护后，再重新导出模板。',
      '',
      `当前产品代码前缀：${codePrefixOptions.join(' / ')}`,
      `当前化材子类别：${chemicalSubcategories.join(' / ')}`,
      `当前膜材子类别：${filmSubcategories.join(' / ')}`,
      `当前化材包装形式：${PACKAGE_TYPE_OPTIONS.join(' / ')}`
    ],
    exampleRows: [
      ['J', '001', '异丙醇', '化材', chemicalExampleSubcategory || '溶剂', 'L', '铁桶', '', '', '国药', 'IPA-99', '否'],
      ['M', '002', 'PET保护膜', '膜材', filmExampleSubcategory || '保护膜', 'm', '', '25', '1240', '东丽', 'T100', '否']
    ]
  };
}

module.exports = {
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  TEMPLATE_KIND,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_HEADERS,
  CATEGORY_OPTIONS,
  UNIT_OPTIONS,
  PACKAGE_TYPE_OPTIONS,
  TEMPLATE_MAX_ROW,
  TEMPLATE_PREVIEW_STYLED_ROW_COUNT,
  TEMPLATE_DATA_START_ROW,
  TEMPLATE_INLINE_HINTS,
  getActiveTemplateSubcategoryNames,
  validateTemplateSubcategoryState,
  buildMaterialTemplateSpec
};
