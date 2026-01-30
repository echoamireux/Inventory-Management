// cloudfunctions/exportData/index.js
const cloud = require('wx-server-sdk');
const xlsx = require('node-xlsx');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { searchVal, category } = event;

  try {
    const dbCmd = db.command;
    let match = {};

    // 1. Filter Logic
    if (category) {
        match.category = category;
    }

    if (searchVal) {
        // Regex Match on Inventory Fields
        match.$or = [
            { material_name: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { product_code: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { unique_code: db.RegExp({ regexp: searchVal, options: 'i' }) },
            { batch_number: db.RegExp({ regexp: searchVal, options: 'i' }) }
        ];
    }

    // 2. 聚合查询 (Join Materials to get Supplier/Model)
    const result = await db.collection('inventory').aggregate()
        .match(match)
        .lookup({
            from: 'materials',
            localField: 'material_id',
            foreignField: '_id',
            as: 'material_info'
        })
        .sort({ create_time: -1 }) // Newest first
        .limit(3000) // Increase limit, max 3000 usually safe for memory
        .end();

    const dataList = result.list;

    // 3. 构建 Excel 表头 (Professional Headers)
    const header = [
        '物料名称',        // 0
        '产品代码 (SKU)',  // 1
        '唯一编码 (Label)',// 2
        '一级分类',        // 3
        '详细分类',        // 4
        '供应商',          // 5
        '原厂型号',        // 6
        '生产批号',        // 7
        '引用日期 (Exp)',  // 8
        '规格/净含量',     // 9
        '当前库存',        // 10
        '单位',           // 11
        '存放位置',        // 12
        '状态',           // 13
        '入库时间'         // 14
    ];

    const sheetData = [header];

    // 4. 填充数据
    dataList.forEach(item => {
      // Extract joined material info
      const mat = (item.material_info && item.material_info[0]) || {};

      // Basic Fields
      const name = item.material_name || mat.name || '--';
      const sku = item.product_code || mat.product_code || '--';
      const uniqueCode = item.unique_code || '--';
      const categoryStr = item.category === 'chemical' ? '化材' : (item.category === 'film' ? '膜材' : '其他');
      const subCategory = item.sub_category || mat.sub_category || '--';
      const supplier = mat.supplier || '--';
      const supplierModel = mat.supplier_model || '--';
      const batchNo = item.batch_number || '--';

      // Date Formatting
      const formatDate = (d) => {
          if (!d) return '--';
          let date;
          if (typeof d === 'string') {
               // Try parsing ISO/Date string
               date = new Date(d);
          } else {
               date = d;
          }
          if (isNaN(date.getTime())) return '--'; // Invalid Date

          return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      };

      // Expiry Logic: Robust Check (Root -> Dynamic)
      let expRaw = item.expiry_date;
      if (!expRaw && item.dynamic_attrs) expRaw = item.dynamic_attrs.expiry_date;
      const expiry = formatDate(expRaw);

      const inboundTime = item.create_time ? new Date(item.create_time).toLocaleString() : '--';

      // Spec Logic
      let specStr = '';
      let qty = 0;
      let unit = '';

      if (item.category === 'chemical') {
          // Chemical
          qty = item.quantity && item.quantity.val ? item.quantity.val : 0;
          unit = item.quantity && item.quantity.unit ? item.quantity.unit : 'kg';
          // Spec string: e.g. "25kg/桶"
          specStr = `${qty}${unit}`;
          // Actually spec should be "25kg/barrel" if defined in specs, otherwise current qty isn't spec.
          // User wants "规格/净含量". Let's use current Stock Qty as Net Content for now, or Mat Spec.
      } else {
          // Film
          qty = item.dynamic_attrs && item.dynamic_attrs.current_length_m ? item.dynamic_attrs.current_length_m : 0;
          unit = 'm';
          const thickness = (item.dynamic_attrs && item.dynamic_attrs.thickness_um) || (mat.specs && mat.specs.thickness_um) || 0;
          const width = (item.dynamic_attrs && item.dynamic_attrs.width_mm) || (mat.specs && mat.specs.standard_width_mm) || 0;
          specStr = `${width}mm * ${thickness}μm`;
      }

      // Status
      let status = '在库';
      if (item.status === 'out_of_stock') status = '已用完';
      else if (item.category === 'chemical' && qty <= 0) status = '已用完';
      else if (item.category === 'film' && qty <= 0) status = '已用完';

      const row = [
          name,
          sku,
          uniqueCode,
          categoryStr,
          subCategory,
          supplier,
          supplierModel,
          batchNo,
          expiry,
          specStr,
          qty,
          unit,
          item.location || '--',
          status,
          inboundTime
      ];

      sheetData.push(row);
    });

    // 5. Generate Excel
    const buffer = xlsx.build([{ name: "Inventory_Report", data: sheetData }]);

    // 6. Upload
    const timestamp = new Date().getTime();
    const fileName = `exports/Inventory_Report_${timestamp}.xlsx`;

    const uploadRes = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: buffer,
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      msg: '生成成功'
    };

  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: err.message
    };
  }
};
