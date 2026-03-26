const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  buildInventoryTemplateSpec
} = require('./inventory-template');
const {
  buildInventoryTemplateWorkbook
} = require('./inventory-template-workbook');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEFAULT_ZONES = {
  chemical: ['实验室1', '实验室2', '实验室3', '物料间'],
  film: ['研发仓1', '研发仓2', '实验线']
};
const OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildInventoryTemplateFileName(exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(date.getTime())) {
    return '库存入库模板.xlsx';
  }

  const cstDate = new Date(date.getTime() + OFFSET_MS);
  const year = cstDate.getUTCFullYear();
  const month = pad(cstDate.getUTCMonth() + 1);
  const day = pad(cstDate.getUTCDate());
  const hour = pad(cstDate.getUTCHours());
  const minute = pad(cstDate.getUTCMinutes());
  return `库存入库模板_${year}${month}${day}_${hour}${minute}.xlsx`;
}

async function getOperator(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  return res.data && res.data[0];
}

async function loadZoneNamesByCategory() {
  const state = {
    chemical: DEFAULT_ZONES.chemical.slice(),
    film: DEFAULT_ZONES.film.slice()
  };
  const seen = {
    chemical: new Set(state.chemical),
    film: new Set(state.film)
  };

  try {
    const records = [];
    let skip = 0;

    while (true) {
      const res = await db.collection('warehouse_zones').skip(skip).limit(100).get();
      const batch = res.data || [];
      records.push(...batch);
      if (batch.length < 100) {
        break;
      }
      skip += 100;
    }

    records
      .filter(item => (item.status || 'active') === 'active')
      .sort((left, right) => {
        const leftOrder = Number(left.sort_order || 0);
        const rightOrder = Number(right.sort_order || 0);
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return String(left.zone_key || left.name || '').localeCompare(String(right.zone_key || right.name || ''));
      })
      .forEach((item) => {
        const name = String(item.name || '').trim();
        const scope = String(item.scope || '').trim();
        if (!name) {
          return;
        }

        if ((scope === 'chemical' || scope === 'global') && !seen.chemical.has(name)) {
          seen.chemical.add(name);
          state.chemical.push(name);
        }
        if ((scope === 'film' || scope === 'global') && !seen.film.has(name)) {
          seen.film.add(name);
          state.film.push(name);
        }
      });
  } catch (_error) {
    // Keep builtin defaults when the collection does not exist yet.
  }

  return state;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();

  try {
    const operator = await getOperator(OPENID);
    const authResult = assertActiveUserAccess(operator, '仅已激活用户可导出最新库存入库模板');
    if (!authResult.ok) {
      return {
        success: false,
        msg: authResult.msg
      };
    }

    const zones = await loadZoneNamesByCategory();
    const spec = buildInventoryTemplateSpec({
      chemicalZones: zones.chemical,
      filmZones: zones.film
    });
    const workbook = await buildInventoryTemplateWorkbook(spec);
    const fileBuffer = await workbook.xlsx.writeBuffer();
    const exportedAt = new Date();
    const timestamp = exportedAt.getTime();
    const fileName = buildInventoryTemplateFileName(exportedAt);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `templates/inventory-import-template_${timestamp}.xlsx`,
      fileContent: Buffer.from(fileBuffer)
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName,
      msg: '模板生成成功'
    };
  } catch (error) {
    console.error('导出库存入库模板失败', error);
    return {
      success: false,
      msg: error.message || '导出模板失败'
    };
  }
};
