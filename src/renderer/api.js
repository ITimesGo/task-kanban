// 薄封装，renderer 不直接依赖 window.taskAPI 细节
window.API = {};
for (const k of ['getAllTasks','getTask','createTask','toggleStatus','updateTask','deleteTask','pickImages','pickMedia','pasteImage','pasteImageSync','imageUrl','localFileUrl',
  'getAllTags','createTag','renameTag','deleteTag','countTagUsage','reorderTag','setTaskTags',
  'getStoragePath','openStoragePath','changeStoragePath','resetStoragePath','cleanupStorage',
  'setAlwaysOnTop','setTitleBarOverlay',
  'pickAttachments','openAttachment','pathForFile',
  'allowMediaSrcPath','copyMedia','saveMediaAs','openMedia','showMediaInFolder',
  'listTrash','restoreTrash','purgeTrash','emptyTrash',
  'exportBackup','importBackup','exportTasks',
  'getAppVersion','checkForUpdate','downloadUpdate','cancelUpdate','openExternal']) {
  window.API[k] = (...a) => window.taskAPI[k](...a);
}
window.API.onUpdateDownloadProgress = (cb) => window.taskAPI.onUpdateDownloadProgress(cb);
window.API.onStorageChanged = (cb) => window.taskAPI.onStorageChanged(cb);
window.API.onTasksChanged = (cb) => window.taskAPI.onTasksChanged(cb);
window.API.openEditWindow = (taskId) => window.taskAPI.openEditWindow(taskId);
window.API.focusEditWindow = (taskId) => window.taskAPI.focusEditWindow(taskId);
window.API.dirtyOpenEditChoice = (opts) => window.taskAPI.dirtyOpenEditChoice(opts);

/** 入口 icon 转 loading，直到独立编辑窗显示（或失败） */
window.API.openEditWindowFromButton = async (btn, taskId) => {
  if (taskId == null || typeof window.taskAPI.openEditWindow !== 'function') return;
  if (btn && btn.dataset && btn.dataset.loading === '1') return;
  const spin = '<svg class="editwin-spin-ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="22 12"/></svg>';
  const prevHtml = btn ? btn.innerHTML : '';
  const prevTitle = btn ? btn.getAttribute('title') : '';
  if (btn) {
    btn.dataset.loading = '1';
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('title', '正在打开编辑窗口…');
    btn.setAttribute('aria-label', '正在打开编辑窗口…');
    if (btn.classList.contains('card-action')) {
      btn.innerHTML = `<span class="card-action-ico" aria-hidden="true">${spin}</span>`;
    } else {
      btn.innerHTML = spin;
    }
  }
  try {
    return await window.taskAPI.openEditWindow(taskId);
  } finally {
    if (btn && btn.isConnected) {
      btn.dataset.loading = '';
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
      btn.innerHTML = prevHtml;
      if (prevTitle != null) {
        btn.setAttribute('title', prevTitle);
        btn.setAttribute('aria-label', prevTitle);
      }
    }
  }
};
window.API.getTaskSync = (id) => {
  try {
    return typeof window.taskAPI.getTaskSync === 'function'
      ? window.taskAPI.getTaskSync(id)
      : null;
  } catch (_) {
    return null;
  }
};
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
window.API.clipboardProbe = (opts) => window.taskAPI.clipboardProbe(opts);
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
