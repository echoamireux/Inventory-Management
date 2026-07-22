const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeDownloadFileName,
  buildUserDataFilePath,
  persistBase64File,
  persistDownloadedFile,
  getOpenDocumentPath,
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

test('download helper writes base64 workbooks directly to a readable local path', async () => {
  const calls = [];
  const fileSystemManager = {
    unlink({ filePath, fail }) {
      calls.push(['unlink', filePath]);
      fail(new Error('not found'));
    },
    writeFile({ filePath, data, encoding, success }) {
      calls.push(['writeFile', filePath, data, encoding]);
      success();
    }
  };

  const savedPath = await persistBase64File({
    fileContentBase64: Buffer.from('xlsx-content').toString('base64'),
    fileName: '库存入库模板_20260322_1530.xlsx',
    fileSystemManager,
    userDataPath: '/user/data',
    fallbackFileName: '库存入库模板.xlsx'
  });

  assert.equal(savedPath, '/user/data/库存入库模板_20260322_1530.xlsx');
  assert.deepEqual(calls, [
    ['unlink', '/user/data/库存入库模板_20260322_1530.xlsx'],
    ['writeFile', '/user/data/库存入库模板_20260322_1530.xlsx', Buffer.from('xlsx-content').toString('base64'), 'base64']
  ]);
});

test('download helper tries saveFile with the readable destination when copyFile is unavailable', async () => {
  const calls = [];
  const fileSystemManager = {
    unlink({ filePath, fail }) {
      calls.push(['unlink', filePath]);
      fail(new Error('not found'));
    },
    copyFile({ srcPath, destPath, fail }) {
      calls.push(['copyFile', srcPath, destPath]);
      fail(new Error('copy not supported'));
    },
    saveFile({ tempFilePath, filePath, success }) {
      calls.push(['saveFile', tempFilePath, filePath]);
      success({ savedFilePath: filePath });
    }
  };

  const savedPath = await persistDownloadedFile({
    tempFilePath: '/tmp/random-name',
    fileName: '标签打印_膜材信息标签_L000001_20260702_004959.xlsx',
    fileSystemManager,
    userDataPath: '/user/data'
  });

  assert.equal(savedPath, '/user/data/标签打印_膜材信息标签_L000001_20260702_004959.xlsx');
  assert.deepEqual(calls, [
    ['unlink', '/user/data/标签打印_膜材信息标签_L000001_20260702_004959.xlsx'],
    ['copyFile', '/tmp/random-name', '/user/data/标签打印_膜材信息标签_L000001_20260702_004959.xlsx'],
    ['saveFile', '/tmp/random-name', '/user/data/标签打印_膜材信息标签_L000001_20260702_004959.xlsx']
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

test('download helper can require readable file names instead of opening random temp paths', async () => {
  const fileSystemManager = {
    unlink({ fail }) {
      fail(new Error('not found'));
    },
    copyFile({ fail }) {
      fail(new Error('copy not supported'));
    }
  };

  await assert.rejects(
    () => getOpenDocumentPath({
      tempFilePath: '/tmp/random-name.xlsx',
      fileName: '标签打印_膜材信息标签_L000001_20260702_004959.xlsx',
      fileSystemManager,
      userDataPath: '/user/data',
      fallbackFileName: '信息标签.xlsx',
      allowTempFallback: false
    }),
    /本地重命名失败/
  );
});

test('download helper re-downloads remote temp paths before opening them locally', async () => {
  const calls = [];
  const fileSystemManager = {
    unlink({ filePath, fail }) {
      calls.push(['unlink', filePath]);
      fail(new Error('not found'));
    },
    copyFile({ srcPath, destPath, success }) {
      calls.push(['copyFile', srcPath, destPath]);
      success();
    }
  };
  const downloadFile = ({ url, success }) => {
    calls.push(['downloadFile', url]);
    success({
      statusCode: 200,
      tempFilePath: '/tmp/local-downloaded.xlsx'
    });
  };

  const openPath = await resolveOpenDocumentPath({
    tempFilePath: 'https://example.com/template.xlsx',
    fileName: '标准物料导入模板_20260322_1530.xlsx',
    fileSystemManager,
    userDataPath: '/user/data',
    downloadFile
  });

  assert.equal(openPath, '/user/data/标准物料导入模板_20260322_1530.xlsx');
  assert.deepEqual(calls, [
    ['downloadFile', 'https://example.com/template.xlsx'],
    ['unlink', '/user/data/标准物料导入模板_20260322_1530.xlsx'],
    ['copyFile', '/tmp/local-downloaded.xlsx', '/user/data/标准物料导入模板_20260322_1530.xlsx']
  ]);
});

test('download helper never returns a remote path to openDocument when local download fails', async () => {
  const fileSystemManager = {
    unlink({ fail }) {
      fail(new Error('not found'));
    },
    copyFile({ fail }) {
      fail(new Error('copy not supported'));
    }
  };
  const downloadFile = ({ fail }) => {
    fail(new Error('download domain blocked'));
  };

  await assert.rejects(
    () => resolveOpenDocumentPath({
      tempFilePath: 'https://example.com/template.xlsx',
      fileName: '库存入库模板_20260322_1530.xlsx',
      fileSystemManager,
      userDataPath: '/user/data',
      downloadFile
    }),
    /本地下载失败/
  );
});
