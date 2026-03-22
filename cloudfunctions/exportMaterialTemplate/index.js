const cloud = require('wx-server-sdk');
const { assertAdminAccess } = require('./auth');
const {
  ensureBuiltinSubcategories,
  sortSubcategoryRecords
} = require('./material-subcategories');
const {
  TEMPLATE_HEADERS,
  DATA_SHEET_NAME,
  CONFIG_SHEET_NAME,
  HELP_SHEET_NAME,
  TEMPLATE_MAX_ROW,
  buildMaterialTemplateSpec,
  getActiveTemplateSubcategoryNames,
  validateTemplateSubcategoryState
} = require('./material-template');
const { buildTemplateWorkbook } = require('./material-template-workbook');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildMaterialTemplateFileName(exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(date.getTime())) {
    return '标准物料导入模板.xlsx';
  }

  const cstDate = new Date(date.getTime() + OFFSET_MS);
  const year = cstDate.getUTCFullYear();
  const month = pad(cstDate.getUTCMonth() + 1);
  const day = pad(cstDate.getUTCDate());
  const hour = pad(cstDate.getUTCHours());
  const minute = pad(cstDate.getUTCMinutes());

  return `标准物料导入模板_${year}${month}${day}_${hour}${minute}.xlsx`;
}

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertAdminAccess(operator, '仅管理员可导出最新模板');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    const allSubcategories = sortSubcategoryRecords(await ensureBuiltinSubcategories(db));
    const chemicalSubcategories = getActiveTemplateSubcategoryNames(allSubcategories, 'chemical');
    const filmSubcategories = getActiveTemplateSubcategoryNames(allSubcategories, 'film');
    const validation = validateTemplateSubcategoryState({
      chemicalSubcategories,
      filmSubcategories
    });

    if (!validation.ok) {
      return {
        success: false,
        msg: validation.msg
      };
    }

    const spec = buildMaterialTemplateSpec({
      chemicalSubcategories,
      filmSubcategories
    });
    const workbook = await buildTemplateWorkbook(spec);
    const fileBuffer = await workbook.xlsx.writeBuffer();
    const exportedAt = new Date();
    const timestamp = exportedAt.getTime();
    const fileName = buildMaterialTemplateFileName(exportedAt);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `templates/material-import-template_${timestamp}.xlsx`,
      fileContent: Buffer.from(fileBuffer)
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName,
      msg: '模板生成成功'
    };
  } catch (error) {
    console.error('导出动态模板失败', error);
    return {
      success: false,
      msg: error.message || '导出模板失败'
    };
  }
};
