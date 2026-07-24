const cloud = require('wx-server-sdk');
const { assertAdminMutationAccess } = require('./auth');
const {
  buildTestMaterialIdentityTemplateSpec,
  buildTestMaterialIdentityWorkbook
} = require('./identity-template-workbook');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildTemplateFileName(exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(date.getTime())) {
    return '测试料型号库导入模板.xlsx';
  }

  const cstDate = new Date(date.getTime() + OFFSET_MS);
  const year = cstDate.getUTCFullYear();
  const month = pad(cstDate.getUTCMonth() + 1);
  const day = pad(cstDate.getUTCDate());
  const hour = pad(cstDate.getUTCHours());
  const minute = pad(cstDate.getUTCMinutes());
  return `测试料型号库导入模板_${year}${month}${day}_${hour}${minute}.xlsx`;
}

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

async function loadActiveTestMaterials() {
  const records = [];
  let skip = 0;

  while (true) {
    const res = await db.collection('materials')
      .where({
        status: 'active',
        is_test_material: true
      })
      .skip(skip)
      .limit(100)
      .get();
    const batch = res.data || [];
    records.push(...batch);
    if (batch.length < 100) {
      break;
    }
    skip += 100;
  }

  return records;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertAdminMutationAccess(operator, '仅管理员可导出测试料型号库模板');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    const testMaterials = await loadActiveTestMaterials();
    const spec = buildTestMaterialIdentityTemplateSpec({ testMaterials });
    if (!spec.testMaterialCodes.length) {
      return {
        success: false,
        msg: '当前没有已启用测试料主数据，请先在主数据管理中新增测试料代码壳'
      };
    }

    const workbook = await buildTestMaterialIdentityWorkbook(spec);
    const fileBuffer = await workbook.xlsx.writeBuffer();
    const contentBuffer = Buffer.from(fileBuffer);
    const exportedAt = new Date();
    const fileName = buildTemplateFileName(exportedAt);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `templates/${OPENID}/test-material-identity/current.xlsx`,
      fileContent: contentBuffer
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName,
      fileContentBase64: contentBuffer.toString('base64'),
      msg: '模板生成成功'
    };
  } catch (error) {
    console.error('导出测试料型号库模板失败', error);
    return {
      success: false,
      msg: error.message || '导出测试料型号库模板失败'
    };
  }
};
