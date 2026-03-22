const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeDownloadFileName,
  buildUserDataFilePath,
  persistDownloadedFile,
  resolveOpenDocumentPath
} = require('../miniprogram/utils/download-file');

test('download helper keeps readable xlsx file names and strips path separators', () => {
  assert.equal(
    sanitizeDownloadFileName('库存明细报表_20260322_1530.xlsx'),
    '库存明细报表_20260322_1530.xlsx'
  );
  assert.equal(
    sanitizeDownloadFileName('../标准物料导入模板:测试?.xlsx'),
    '.._标准物料导入模板_测试_.xlsx'
  );
});

test('download helper falls back to a safe default file name when backend file name is empty', () => {
  assert.equal(
    sanitizeDownloadFileName(''),
    '导出文件.xlsx'
  );
});

test('download helper builds a user-data path with the readable file name', () => {
  assert.equal(
    buildUserDataFilePath('/user/data', '库存明细报表_20260322_1530.xlsx'),
    '/user/data/库存明细报表_20260322_1530.xlsx'
  );
});

test('download helper overwrites old local files and resolves the readable destination path', async () => {
  const calls = [];
  const fileSystemManager = {
    unlink({ filePath, fail, success }) {
      calls.push(['unlink', filePath]);
      fail(new Error('not found'));
      if (success) {
        success();
      }
    },
    copyFile({ srcPath, destPath, success }) {
      calls.push(['copyFile', srcPath, destPath]);
      success();
    }
  };

  const savedPath = await persistDownloadedFile({
    tempFilePath: '/tmp/random-name',
    fileName: '标准物料导入模板_20260322_1530.xlsx',
    fileSystemManager,
    userDataPath: '/user/data'
  });

  assert.equal(savedPath, '/user/data/标准物料导入模板_20260322_1530.xlsx');
  assert.deepEqual(calls, [
    ['unlink', '/user/data/标准物料导入模板_20260322_1530.xlsx'],
    ['copyFile', '/tmp/random-name', '/user/data/标准物料导入模板_20260322_1530.xlsx']
  ]);
});

test('download helper falls back to temp file path when local rename/save is not supported', async () => {
  const fileSystemManager = {
    unlink({ fail }) {
      fail(new Error('not found'));
    },
    copyFile({ fail }) {
      fail(new Error('copy not supported'));
    }
  };

  const openPath = await resolveOpenDocumentPath({
    tempFilePath: '/tmp/random-name.xlsx',
    fileName: '库存明细报表_20260322_1530.xlsx',
    fileSystemManager,
    userDataPath: '/user/data'
  });

  assert.equal(openPath, '/tmp/random-name.xlsx');
});
