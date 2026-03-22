const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEGACY_TEMPLATE_EXPORT_HINT,
  normalizeTemplateExportResult
} = require('../miniprogram/utils/material-template-export');

test('template export result accepts successful responses with a file id', () => {
  assert.deepEqual(
    normalizeTemplateExportResult({
      result: {
        success: true,
        fileID: 'cloud://template.xlsx',
        fileName: '物料导入模板.xlsx'
      }
    }),
    {
      success: true,
      fileID: 'cloud://template.xlsx',
      fileName: '物料导入模板.xlsx'
    }
  );
});

test('template export result surfaces a deploy hint when the cloud function is outdated', () => {
  assert.throws(
    () => normalizeTemplateExportResult({
      result: {
        success: true,
        msg: '生成成功'
      }
    }),
    new RegExp(LEGACY_TEMPLATE_EXPORT_HINT)
  );
});

test('template export result keeps backend business errors intact when export is rejected', () => {
  assert.throws(
    () => normalizeTemplateExportResult({
      result: {
        success: false,
        msg: '化材当前没有可用子类别，请先在子类别管理中维护后再导出模板'
      }
    }),
    /化材当前没有可用子类别/
  );
});
