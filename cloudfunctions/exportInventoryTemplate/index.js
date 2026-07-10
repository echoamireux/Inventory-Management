const cloud = require('wx-server-sdk');
const { assertActiveUserAccess } = require('./auth');
const {
  buildInventoryTemplateSpec
} = require('./inventory-template');
const {
  buildInventoryTemplateWorkbook
} = require('./inventory-template-workbook');
const {
  ensureBuiltinProductCodePrefixes
} = require('./product-code-prefixes');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEFAULT_ZONES = {
  chemical: ['防爆柜01', '防爆柜02', '防爆柜03', '防爆柜04', '防爆柜05', '防爆柜06', '防爆柜07'],
  film: ['研发仓1', '研发仓2', '研发仓3', '实验线']
};
const DEFAULT_LOCATION_DETAILS = ['F1', 'F2', 'F3', 'F4', 'F5'];
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

async function loadLocationDetailNames() {
  const names = DEFAULT_LOCATION_DETAILS.slice();
  const seen = new Set(names);

  try {
    let skip = 0;
    while (true) {
      const res = await db.collection('warehouse_location_details').skip(skip).limit(100).get();
      const batch = res.data || [];
      batch
        .filter(item => (item.status || 'active') === 'active')
        .sort((left, right) => {
          const leftOrder = Number(left.sort_order || 0);
          const rightOrder = Number(right.sort_order || 0);
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return String(left.detail_key || left.name || '').localeCompare(String(right.detail_key || right.name || ''));
        })
        .forEach((item) => {
          const name = String(item.name || '').trim();
          if (name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        });

      if (batch.length < 100) {
        break;
      }
      skip += 100;
    }
  } catch (_error) {
    // Keep builtin default F1-F5 when the collection does not exist yet.
  }

  return names;
}

async function loadProductCodePrefixes() {
  try {
    const records = await ensureBuiltinProductCodePrefixes(db);
    return records.filter(item => (item.status || 'active') === 'active');
  } catch (_error) {
    return ['J', 'S', 'Y', 'M'];
  }
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
    const locationDetails = await loadLocationDetailNames();
    const codePrefixes = await loadProductCodePrefixes();
    const spec = buildInventoryTemplateSpec({
      chemicalZones: zones.chemical,
      filmZones: zones.film,
      locationDetails,
      codePrefixes
    });
    const workbook = await buildInventoryTemplateWorkbook(spec);
    const fileBuffer = await workbook.xlsx.writeBuffer();
    const exportedAt = new Date();
    const fileName = buildInventoryTemplateFileName(exportedAt);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `templates/${OPENID}/inventory-import/current.xlsx`,
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
