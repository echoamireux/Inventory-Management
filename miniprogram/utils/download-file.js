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

function isRemoteFilePath(filePath = '') {
  return /^https?:\/\//i.test(String(filePath || '').trim());
}

function callDownloadFile(downloadFile, url) {
  return new Promise((resolve, reject) => {
    downloadFile({
      url,
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

  try {
    await callFsMethod(fileSystemManager, 'copyFile', {
      srcPath: tempFilePath,
      destPath: targetPath
    });
    return targetPath;
  } catch (copyError) {
    try {
      const saveResult = await callFsMethod(fileSystemManager, 'saveFile', {
        tempFilePath,
        filePath: targetPath
      });
      return (saveResult && saveResult.savedFilePath) || targetPath;
    } catch (saveError) {
      try {
        await callFsMethod(fileSystemManager, 'rename', {
          oldPath: tempFilePath,
          newPath: targetPath
        });
        return targetPath;
      } catch (_renameError) {
        throw saveError || copyError;
      }
    }
  }
}

async function persistBase64File({
  fileContentBase64 = '',
  fileName = '',
  fileSystemManager = null,
  userDataPath = '',
  fallbackFileName = '导出文件.xlsx'
} = {}) {
  const content = String(fileContentBase64 || '').trim();
  if (!content) {
    throw new Error('文件内容为空');
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

  await callFsMethod(fileSystemManager, 'writeFile', {
    filePath: targetPath,
    data: content,
    encoding: 'base64'
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
  let tempFilePath = String(options.tempFilePath || '').trim();
  if (!tempFilePath) {
    throw new Error('文件下载失败');
  }

  if (isRemoteFilePath(tempFilePath)) {
    const downloadFile = options.downloadFile
      || (typeof wx !== 'undefined' && wx && typeof wx.downloadFile === 'function' ? wx.downloadFile.bind(wx) : null);
    let downloadError = null;

    if (downloadFile) {
      try {
        const downloaded = await callDownloadFile(downloadFile, tempFilePath);
        if (downloaded && downloaded.statusCode === 200 && downloaded.tempFilePath) {
          tempFilePath = String(downloaded.tempFilePath || '').trim() || tempFilePath;
        }
      } catch (error) {
        downloadError = error;
      }
    }

    if (isRemoteFilePath(tempFilePath)) {
      const detail = downloadError && (downloadError.errMsg || downloadError.message)
        ? `：${downloadError.errMsg || downloadError.message}`
        : '';
      throw new Error(`本地下载失败，请重新点击导出后再试${detail}`);
    }
  }

  return getOpenDocumentPath({
    ...options,
    tempFilePath,
    allowTempFallback: true
  });
}

module.exports = {
  sanitizeDownloadFileName,
  buildUserDataFilePath,
  persistBase64File,
  persistDownloadedFile,
  getOpenDocumentPath,
  resolveOpenDocumentPath
};
