const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('taskAPI', {
  getAllTasks: () => ipcRenderer.invoke('tasks:getAll'),
  createTask: (data) => ipcRenderer.invoke('tasks:create', data),
  toggleStatus: (id) => ipcRenderer.invoke('tasks:toggle', id),
  updateTask: (id, data) => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  pasteImage: () => ipcRenderer.invoke('image:paste'),
  pasteImageSync: () => ipcRenderer.sendSync('image:pasteSync'),
  imageUrl: (rel) => 'taskimage://local/' + rel,
  /** 视频用 file://，保证 HTML5 video 的 Range 请求可用 */
  mediaFileUrlSync: (rel) => ipcRenderer.sendSync('media:fileUrlSync', rel),
  localFileUrl: (absPath) => pathToFileURL(absPath).href,
  getAllTags: () => ipcRenderer.invoke('tags:getAll'),
  createTag: (name) => ipcRenderer.invoke('tags:create', name),
  renameTag: (id, name) => ipcRenderer.invoke('tags:rename', id, name),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  setTaskTags: (id, tagIds) => ipcRenderer.invoke('tasks:setTags', id, tagIds),
  getStoragePath: () => ipcRenderer.invoke('storage:get'),
  openStoragePath: () => ipcRenderer.invoke('storage:open'),
  cleanupStorage: () => ipcRenderer.invoke('storage:cleanup'),
  changeStoragePath: () => ipcRenderer.invoke('storage:change'),
  resetStoragePath: () => ipcRenderer.invoke('storage:reset'),
  onStorageChanged: (cb) => { ipcRenderer.on('storage:changed', cb); },
  onClosePopups: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('ui:close-popups', handler);
    return () => { ipcRenderer.removeListener('ui:close-popups', handler); };
  },
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('window:setTitleBarOverlay', opts),
  pickAttachments: () => ipcRenderer.invoke('file:pick'),
  openAttachment: (rel) => ipcRenderer.invoke('file:open', rel),
  pathForFile: (file) => {
    if (!file) return '';
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      }
    } catch (_) { /* Electron <32 无此 API */ }
    // Electron 31 及更早：拖放 File 仍带 path
    return String(file.path || '');
  },
  onAttachmentProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('attach:progress', handler);
    return () => { ipcRenderer.removeListener('attach:progress', handler); };
  },
  // 回收站
  listTrash: () => ipcRenderer.invoke('trash:list'),
  restoreTrash: (id) => ipcRenderer.invoke('trash:restore', id),
  purgeTrash: (id) => ipcRenderer.invoke('trash:purge', id),
  emptyTrash: () => ipcRenderer.invoke('trash:empty'),
  // 备份
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  // 任务导出
  exportTasks: (options) => ipcRenderer.invoke('export:tasks', options),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (url) => ipcRenderer.invoke('update:download', url),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onUpdateDownloadProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('update:downloadProgress', handler);
    return () => { ipcRenderer.removeListener('update:downloadProgress', handler); };
  },
  // 离线 OCR
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),
  ocrRecognize: (dataUrl) => ipcRenderer.invoke('ocr:recognize', dataUrl),
  onOcrProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('ocr:progress', handler);
    return () => { ipcRenderer.removeListener('ocr:progress', handler); };
  },
  // 插件
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
  installPlugin: (id) => ipcRenderer.invoke('plugins:install', id),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  clipboardPeek: (opts) => ipcRenderer.invoke('plugins:clipboardPeek', opts || {}),
  ocrIndexGetAll: () => ipcRenderer.invoke('ocrIndex:getAll'),
  ocrIndexSet: (rel, text) => ipcRenderer.invoke('ocrIndex:set', rel, text),
  ocrIndexClear: () => ipcRenderer.invoke('ocrIndex:clear'),
  ocrIndexStats: () => ipcRenderer.invoke('ocrIndex:stats'),
  ocrIndexBuild: (opts) => ipcRenderer.invoke('ocrIndex:build', opts || {}),
  ocrIndexCancelBuild: () => ipcRenderer.invoke('ocrIndex:cancelBuild'),
  onOcrIndexProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('ocrIndex:progress', handler);
    return () => { ipcRenderer.removeListener('ocrIndex:progress', handler); };
  },
  onOcrIndexUpdated: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('ocrIndex:updated', handler);
    return () => { ipcRenderer.removeListener('ocrIndex:updated', handler); };
  },
  onOcrIndexAutoProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('ocrIndex:autoProgress', handler);
    return () => { ipcRenderer.removeListener('ocrIndex:autoProgress', handler); };
  },
  onPluginProgress: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('plugins:progress', handler);
    return () => { ipcRenderer.removeListener('plugins:progress', handler); };
  },
});
