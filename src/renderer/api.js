// 薄封装，renderer 不直接依赖 window.taskAPI 细节
window.API = {};
for (const k of ['getAllTasks','createTask','toggleStatus','updateTask','deleteTask','pickImages','pickMedia','pasteImage','pasteImageSync','imageUrl','localFileUrl',
  'getAllTags','createTag','renameTag','deleteTag','setTaskTags',
  'getStoragePath','openStoragePath','changeStoragePath','resetStoragePath','cleanupStorage',
  'setAlwaysOnTop','setTitleBarOverlay',
  'pickAttachments','openAttachment','pathForFile',
  'listTrash','restoreTrash','purgeTrash','emptyTrash',
  'exportBackup','importBackup','exportTasks',
  'getAppVersion','checkForUpdate','downloadUpdate','openExternal']) {
  window.API[k] = (...a) => window.taskAPI[k](...a);
}
window.API.onUpdateDownloadProgress = (cb) => window.taskAPI.onUpdateDownloadProgress(cb);
window.API.onStorageChanged = (cb) => window.taskAPI.onStorageChanged(cb);
window.API.onAttachmentProgress = (cb) => window.taskAPI.onAttachmentProgress(cb);
window.API.onClosePopups = (cb) => window.taskAPI.onClosePopups(cb);
window.API.ocrStatus = () => window.taskAPI.ocrStatus();
window.API.ocrRecognize = (dataUrl) => window.taskAPI.ocrRecognize(dataUrl);
window.API.onOcrProgress = (cb) => window.taskAPI.onOcrProgress(cb);
window.API.listPlugins = () => window.taskAPI.listPlugins();
window.API.setPluginEnabled = (id, enabled) => window.taskAPI.setPluginEnabled(id, enabled);
window.API.installPlugin = (id) => window.taskAPI.installPlugin(id);
window.API.uninstallPlugin = (id) => window.taskAPI.uninstallPlugin(id);
window.API.onPluginProgress = (cb) => window.taskAPI.onPluginProgress(cb);
window.API.clipboardPeek = (opts) => window.taskAPI.clipboardPeek(opts);
window.API.ocrIndexGetAll = () => window.taskAPI.ocrIndexGetAll();
window.API.ocrIndexSet = (rel, text) => window.taskAPI.ocrIndexSet(rel, text);
window.API.ocrIndexClear = () => window.taskAPI.ocrIndexClear();
window.API.ocrIndexStats = () => window.taskAPI.ocrIndexStats();
window.API.ocrIndexBuild = (opts) => window.taskAPI.ocrIndexBuild(opts);
window.API.ocrIndexCancelBuild = () => window.taskAPI.ocrIndexCancelBuild();
window.API.onOcrIndexProgress = (cb) => window.taskAPI.onOcrIndexProgress(cb);
window.API.onOcrIndexUpdated = (cb) => window.taskAPI.onOcrIndexUpdated(cb);
window.API.onOcrIndexAutoProgress = (cb) => window.taskAPI.onOcrIndexAutoProgress(cb);

window.API.mediaFileUrl = (rel) => {
  try {
    return window.taskAPI.mediaFileUrlSync(rel) || '';
  } catch (_) {
    return '';
  }
};

/** 媒体可播放/可显示 URL（统一走 taskimage://，避免 file:// 跨目录被拦） */
window.API.mediaSrc = (item, kind) => {
  if (!item && item !== '') return '';
  const k = kind || (item && item.kind) || '';
  const value = item && typeof item === 'object' && item.value != null ? item.value : item;
  if (typeof value === 'string') {
    if (value.startsWith('data:') || value.startsWith('file:') || value.startsWith('taskimage:') || value.startsWith('blob:')) {
      return value;
    }
    if (value.startsWith('videos/') || value.startsWith('images/') || value.startsWith('attachments/') || k === 'video' || k === 'image') {
      return window.API.imageUrl(value);
    }
    return window.API.localFileUrl(value);
  }
  if (value && typeof value === 'object') {
    if (value.previewUrl) return value.previewUrl;
    if (value.srcPath) return window.API.localFileUrl(value.srcPath);
    if (value.dataUrl) return value.dataUrl;
  }
  return '';
};

/** 缩略图 src：已存相对路径 / dataUrl / 本地绝对路径 */
window.API.thumbSrc = (item) => window.API.mediaSrc(item);

/** 任务媒体混排（有 media 用其顺序；否则图片在前、视频在后） */
window.API.taskMediaItems = (task) => taskMediaItems(task);
