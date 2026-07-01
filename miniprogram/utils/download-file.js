function sanitizeDownloadFileName(fileName = '', fallbackFileName = '导出文件.xlsx') {
  const trimmed = String(fileName || '').trim();
  const normalized = trimmed
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');

  return normalized || fallbackFileName;
}

function buildUserDataFilePath(userDataPath = '', fileName = '', fallbackFileName = '导出文件.xlsx') {
  const basePath = String(userDataPath || '').replace(/\/+$/, '');
  const safeFileName = sanitizeDownloadFileName(fileName, fallbackFileName);
  return `${basePath}/${safeFileName}`;
}

function callFsMethod(fileSystemManager, method, payload) {
  return new Promise((resolve, reject) => {
    fileSystemManager[method]({
      ...payload,
      success: resolve,
      fail: reject
    });
  });
}

async function persistDownloadedFile({
  tempFilePath = '',
  fileName = '',
  fileSystemManager = null,
  userDataPath = '',
  fallbackFileName = '导出文件.xlsx'
} = {}) {
  if (!tempFilePath) {
    throw new Error('文件下载失败');
  }
  if (!fileSystemManager) {
    throw new Error('文件系统不可用');
  }
  if (!userDataPath) {
    throw new Error('本地存储路径不可用');
  }

  const targetPath = buildUserDataFilePath(userDataPath, fileName, fallbackFileName);

  try {
    await callFsMethod(fileSystemManager, 'unlink', {
      filePath: targetPath
    });
  } catch (_error) {
    // Ignore missing-file errors so export can overwrite previous local copies safely.
  }

  await callFsMethod(fileSystemManager, 'copyFile', {
    srcPath: tempFilePath,
    destPath: targetPath
  });

  return targetPath;
}

async function getOpenDocumentPath(options = {}) {
  const tempFilePath = String(options.tempFilePath || '').trim();
  if (!tempFilePath) {
    throw new Error('文件下载失败');
  }
  const allowTempFallback = options.allowTempFallback !== false;

  try {
    return await persistDownloadedFile(options);
  } catch (error) {
    if (!allowTempFallback) {
      throw new Error('本地重命名失败，请重试下载打开');
    }
    return tempFilePath;
  }
}

async function resolveOpenDocumentPath(options = {}) {
  return getOpenDocumentPath({
    ...options,
    allowTempFallback: true
  });
}

module.exports = {
  sanitizeDownloadFileName,
  buildUserDataFilePath,
  persistDownloadedFile,
  getOpenDocumentPath,
  resolveOpenDocumentPath
};
