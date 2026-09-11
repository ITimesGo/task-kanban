const { app, BrowserWindow, ipcMain, dialog, clipboard, protocol, net, globalShortcut, shell } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
// 开发模式：监听 src 目录，渲染层文件（html/css/js）变化时自动刷新窗口
if (!app.isPackaged) {
  require('electron-reload')(path.join(__dirname, '..'), {
    ignored: /node_modules|\.git/,
  });
}
const fs = require('fs');
const { pathToFileURL } = require('url');
const FileStore = require('./fileStore');
const images = require('./images');
const videos = require('./videos');
const store = require('./store');
const tags = require('./tags');
const storage = require('./storage');
const { cleanupOrphans } = require('./cleanupOrphans');
const trash = require('./trash');
const backup = require('./backup');
const exportTasks = require('./exportTasks');
const mediaLayout = require('./mediaLayout');
const ocr = require('./ocr');
const plugins = require('./plugins');
const { normalizeMediaPayload } = require('../renderer/taskMedia');
const { UPDATE_FEED_URL, evaluateUpdate, buildHandoffScript, resolveUpdateTargetPath, isExtractedTempPath, writeHandoff, readHandoff, clearHandoff, copyPortableOverTarget } = require('./appUpdate');

// 自定义协议：taskimage://local/images/xxx.png -> 磁盘文件
// 注意：scheme 注册为 standard，taskimage:// 后第一段是 host，故 URL 形如 taskimage://local/<rel>
const APP_DATA_ROOT = app.getPath('appData'); // 配置记录的根目录
let APP_DATA = storage.resolveStoragePath(APP_DATA_ROOT); // 实际存储目录（可被设置更换）

let win = null;
let fsStore = null;

// stream + supportFetchAPI：HTML5 <video> 需要 Range / 流式读取；secure 便于 media-src
protocol.registerSchemesAsPrivileged([{
  scheme: 'taskimage',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}]);

/** 可重复注册的 IPC（开发热重载时避免旧进程缺 handler / 重复注册失败） */
function ipcHandle(channel, listener) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, listener);
}

function createWindow() {
  win = new BrowserWindow({
    width: 800, height: 600,
    title: '任务看板',
    // 启动时不立即显示，等渲染进程首次可交互（ready-to-show）再显示，
    // 避免出现"窗口已画出但点不动/滚不动"的未就绪窗口（治愈启动卡顿体验）
    show: false,
    // 半自绘标题栏（Window Controls Overlay）：
    // - 保留系统原生左侧拖动、原生最小化/最大化/关闭按钮，以及 Windows 绘制的圆角与边框（非透明，圆角稳定）
    // - 标题栏其余区域由 renderer 自绘，可在右侧窗口控制按钮旁放置自定义按钮（如“置顶”）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#303133',
      height: 40,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  // 渲染进程首次可交互后再显示窗口（见构造参数 show:false 注释）。
  // 增加兜底：若 ready-to-show 长期未触发（打包版冷启动偶发），最多等 4s 强制显示，
  // 避免窗口一直不可见让用户以为没启动成功。
  let windowShown = false;
  const showWin = () => {
    if (windowShown || win.isDestroyed()) return;
    windowShown = true;
    win.show();
  };
  win.once('ready-to-show', showWin);
  setTimeout(showWin, 4000);
  if (process.env.SHOT) {
    win.webContents.once('did-finish-load', async () => {
      setTimeout(async () => {
        win.webContents.executeJavaScript(`document.querySelector('#cards .card') && document.querySelector('#cards .card').click()`);
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          require('fs').writeFileSync(process.env.SHOT, img.toPNG());
          app.quit();
        }, 600);
      }, 600);
    });
  }
  win.removeMenu(); // 去掉默认的 File/Edit/View 应用菜单栏
  // 置顶状态：启动时从配置恢复
  win.setAlwaysOnTop(global.alwaysOnTop === true);
  // 从标题栏拖拽移动窗口时，通知渲染进程收起下拉（拖拽区本身收不到 click）
  win.on('will-move', () => {
    try { win.webContents.send('ui:close-popups'); } catch (_) {}
  });
  win.on('close', () => { app.quit(); });
  return win;
}

function ingestOrderedMedia(fsStore, items, taskId, tagOpts, { existingImages = [], existingVideos = [] } = {}) {
  const taken = mediaLayout.imageIndexTakenSet(existingImages, taskId);
  let nextIdx = 0;
  const alloc = () => { while (taken.has(nextIdx)) nextIdx++; taken.add(nextIdx); return nextIdx; };
  const takenVid = mediaLayout.imageIndexTakenSet(existingVideos, taskId);
  let nextVid = 0;
  const allocVid = () => { while (takenVid.has(nextVid)) nextVid++; takenVid.add(nextVid); return nextVid; };
  const images = [];
  const videos = [];
  const media = [];
  for (const item of items || []) {
    if (item && item.kind === 'video') {
      const v = item.value;
      const isNew = v && typeof v === 'object' && v.srcPath;
      const rel = isNew ? fsStore.ingestVideo(v, taskId, allocVid(), tagOpts) : v;
      videos.push(rel);
      media.push({ kind: 'video', rel });
    } else {
      const v = item && item.value;
      const isNew = (typeof v === 'string' && v.startsWith('data:'))
        || (v && typeof v === 'object' && v.srcPath);
      const rel = isNew ? fsStore.ingestImage(v, taskId, alloc(), tagOpts) : v;
      images.push(rel);
      media.push({ kind: 'image', rel });
    }
  }
  return { images, videos, media };
}

function setupStoreHandlers() {
  ipcHandle('tasks:getAll', () => fsStore.loadTasks());
  ipcHandle('tasks:create', async (event, payload) => {
    try {
      const { text, attachments, tags: tagIds } = payload || {};
      const tagOpts = { tags: tagIds || [] };
      const mediaItems = normalizeMediaPayload(payload || {});
      const task = store.createTask({
        text,
        images: mediaItems.filter((m) => m.kind !== 'video').map((m) => m.value),
        videos: mediaItems.filter((m) => m.kind === 'video').map((m) => m.value),
        attachments: attachments || [],
      });
      const tasks = fsStore.loadTasks();
      const ingested = ingestOrderedMedia(fsStore, mediaItems, task.id, tagOpts);
      const rels = ingested.images;
      const atts = [];
      const attList = attachments || [];
      for (let i = 0; i < attList.length; i++) {
        const a = attList[i];
        const done = await fsStore.copyAttachmentAsync(a.srcPath, task.id, a.name, (pct) => {
          try { event.sender.send('attach:progress', { job: 'create', index: i, count: attList.length, pct }); } catch (_) {}
        }, tagOpts);
        atts.push(done);
      }
      const final = {
        ...task,
        images: ingested.images,
        videos: ingested.videos,
        media: ingested.media,
        attachments: atts,
        tags: tagIds || [],
      };
      fsStore.saveTasks([...tasks, final]);
      try {
        if (plugins.isEnabled('ocr-search') && plugins.assertOcrReady().ok) {
          plugins.ocrIndex.scheduleIndexRels(APP_DATA, rels, {
            taskId: task.id,
            onDone: () => {
              try {
                if (win && !win.isDestroyed()) win.webContents.send('ocrIndex:updated');
              } catch (_) { /* ignore */ }
            },
          });
        }
      } catch (_) { /* ignore */ }
      return { ok: true, task: final };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcHandle('tasks:toggle', (_e, id) => {
    const next = store.toggleStatus(fsStore.loadTasks(), id);
    fsStore.saveTasks(next);
    return next.find((t) => t.id === id);
  });
  ipcHandle('tasks:update', async (event, id, payload) => {
    try {
      const { text, attachments } = payload || {};
      const tasks = fsStore.loadTasks();
      const old = tasks.find((t) => t.id === id);
      if (!old) return { ok: false, error: '任务不存在' };
      const tagOpts = { tags: old.tags || [] };
      const existingRels = old.images || [];
      const existingVideos = old.videos || [];
      const mediaItems = normalizeMediaPayload({
        media: payload && payload.media,
        images: payload && payload.images !== undefined ? payload.images : existingRels,
        videos: payload && payload.videos !== undefined ? payload.videos : existingVideos,
      });
      const ingested = ingestOrderedMedia(fsStore, mediaItems, id, tagOpts, {
        existingImages: existingRels,
        existingVideos,
      });
      const rels = ingested.images;
      const videoRels = ingested.videos;
      const removed = existingRels.filter((r) => !rels.includes(r));
      fsStore.deleteImages(removed);
      const removedVids = existingVideos.filter((r) => !videoRels.includes(r));
      fsStore.deleteVideos(removedVids);

      // 附件：新增项 {srcPath,name} 拷贝入 attachments/，已存在的 rel 保留
      const oldAtts = old.attachments || [];
      const atts = [];
      const attList = attachments || [];
      const newItems = attList.filter((a) => typeof a !== 'string');
      for (let i = 0; i < attList.length; i++) {
        const a = attList[i];
        if (typeof a === 'string') { atts.push(a); continue; }
        // 详情里保留项有时是 {name,rel} 对象
        if (a && a.rel && !a.srcPath) { atts.push(a); continue; }
        const idx = newItems.indexOf(a);
        const done = await fsStore.copyAttachmentAsync(a.srcPath, id, a.name, (pct) => {
          try { event.sender.send('attach:progress', { job: 'update', index: idx, count: newItems.length, pct }); } catch (_) {}
        }, tagOpts);
        atts.push(done);
      }
      // oldAtts 内为 {name,rel} 对象，atts 内混合保留的字符串 rel 与新增对象；
      // 按 rel 判断哪些旧附件被移除，从而删除对应文件
      const attRel = (a) => (typeof a === 'string' ? a : (a && a.rel));
      const keptRels = atts.map(attRel).filter(Boolean);
      const removedAtts = oldAtts.filter((a) => !keptRels.includes(attRel(a)));
      fsStore.deleteAttachments(removedAtts);
      const updated = store.updateTask(tasks, id, {
        text,
        images: rels,
        videos: videoRels,
        media: ingested.media,
        attachments: atts,
      });
      fsStore.saveTasks(updated);
      try {
        if (plugins.isEnabled('ocr-search') && plugins.assertOcrReady().ok) {
          // 删除的图片清索引；新增/未入库的后台识别
          for (const r of removed) {
            try { plugins.ocrIndex.remove(r); } catch (_) { /* ignore */ }
          }
          plugins.ocrIndex.scheduleIndexRels(APP_DATA, rels, {
            taskId: id,
            onDone: () => {
              try {
                if (win && !win.isDestroyed()) win.webContents.send('ocrIndex:updated');
              } catch (_) { /* ignore */ }
            },
          });
        }
      } catch (_) { /* ignore */ }
      return { ok: true, task: updated.find((t) => t.id === id) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcHandle('tasks:delete', (_e, id) => {
    // 软删除：移入回收站，不删磁盘文件
    const res = trash.moveToTrash(fsStore.loadTasks(), fsStore.loadTrash(), id);
    if (!res.moved) return { ok: false, error: '任务不存在' };
    fsStore.saveTasks(res.tasks);
    fsStore.saveTrash(res.trash);
    return { ok: true };
  });

  ipcHandle('trash:list', () => fsStore.loadTrash());
  ipcHandle('trash:restore', (_e, id) => {
    try {
      const res = trash.restoreFromTrash(fsStore.loadTasks(), fsStore.loadTrash(), id);
      if (!res.restored) return { ok: false, error: '回收站中无此任务' };
      fsStore.saveTasks(res.tasks);
      fsStore.saveTrash(res.trash);
      return { ok: true, task: res.restored };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcHandle('trash:purge', (_e, id) => {
    const res = trash.purgeFromTrash(fsStore.loadTrash(), id);
    if (res.purged) {
      fsStore.deleteImages(res.purged.images);
      fsStore.deleteVideos(res.purged.videos);
      fsStore.deleteAttachments(res.purged.attachments);
    }
    fsStore.saveTrash(res.trash);
    return { ok: true };
  });
  ipcHandle('trash:empty', () => {
    const res = trash.emptyTrash(fsStore.loadTrash());
    for (const t of res.purged) {
      fsStore.deleteImages(t.images);
      fsStore.deleteVideos(t.videos);
      fsStore.deleteAttachments(t.attachments);
    }
    fsStore.saveTrash(res.trash);
    return { ok: true, count: res.purged.length };
  });

  ipcHandle('image:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp'] }],
    });
    if (res.canceled) return [];
    const out = [];
    for (const p of res.filePaths) {
      try {
        const dataUrl = images.dataUrlForPath(p);
        if (dataUrl) out.push(dataUrl);
      } catch (_) { /* 跳过非法项 */ }
    }
    return out;
  });
  // 图片 + 视频混合选取（新建/编辑「添加媒体」）
  ipcHandle('media:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片与视频', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'mp4', 'webm', 'mov'] },
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov'] },
      ],
    });
    if (res.canceled) return [];
    const out = [];
    for (const p of res.filePaths) {
      try {
        const ext = (path.extname(p) || '').slice(1).toLowerCase();
        if (videos.ALLOWED.has(ext)) {
          videos.assertVideoFile(p);
          out.push({ kind: 'video', srcPath: p });
        } else {
          const dataUrl = images.dataUrlForPath(p);
          if (dataUrl) out.push({ kind: 'image', dataUrl });
        }
      } catch (_) { /* 跳过非法项 */ }
    }
    return out;
  });
  ipcHandle('image:paste', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return images.dataUrlForClipboard(img);
  });
  // 同步读取，供 renderer 在 paste 事件里立刻 preventDefault
  try { ipcMain.removeAllListeners('image:pasteSync'); } catch (_) {}
  ipcMain.on('image:pasteSync', (event) => {
    try {
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        event.returnValue = images.dataUrlForClipboard(img);
        return;
      }
      // Windows：资源管理器复制图片文件时，剪贴板可能是文件路径文本
      const text = (clipboard.readText() || '').trim().replace(/^"(.*)"$/, '$1');
      if (text && /^([a-zA-Z]:\\|\\\\).+\.(jpe?g|png|bmp)$/i.test(text)) {
        try {
          images.assertImageFile(text);
          event.returnValue = { srcPath: text };
          return;
        } catch (_) { /* fall through */ }
      }
      event.returnValue = null;
    } catch (err) {
      event.returnValue = { error: err.message || String(err) };
    }
  });

  // 附件文件：选择（返回路径列表）与打开（用外部软件）
  ipcHandle('file:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择附件文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return res.filePaths;
  });
  ipcHandle('file:open', (_e, rel) => {
    const abs = path.join(APP_DATA, rel);
    if (fs.existsSync(abs)) shell.openPath(abs);
  });
  // 同步：视频播放需要 file://（自定义协议常不支持 Range）
  try { ipcMain.removeAllListeners('media:fileUrlSync'); } catch (_) {}
  ipcMain.on('media:fileUrlSync', (event, rel) => {
    try {
      const clean = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
      if (!clean || clean.includes('..')) {
        event.returnValue = '';
        return;
      }
      const abs = path.join(APP_DATA, clean);
      event.returnValue = fs.existsSync(abs) ? pathToFileURL(abs).href : '';
    } catch (_) {
      event.returnValue = '';
    }
  });
}

function setupTagHandlers() {
  ipcHandle('tags:getAll', () => fsStore.loadTags());
  ipcHandle('tags:create', (_e, name) => {
    const tags2 = tags.createTag(fsStore.loadTags(), name);
    fsStore.saveTags(tags2);
    return { ok: true, tags: tags2 };
  });
  ipcHandle('tags:rename', (_e, id, name) => {
    try {
      const before = fsStore.loadTags();
      const tags2 = tags.renameTag(before, id, name);
      fsStore.renameTagFolders(id, before, tags2);
      fsStore.saveTags(tags2);
      return { ok: true, tags: tags2 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcHandle('tags:delete', (_e, id) => {
    const had = (list) => (list || []).filter((t) => (t.tags || []).includes(id));
    const affectedTasks = had(fsStore.loadTasks());
    const affectedTrash = had(fsStore.loadTrash());
    const list = tags.deleteTag(fsStore.loadTags(), id);
    fsStore.saveTags(list);
    // 从所有任务与回收站的 tags 引用中移除该 id
    let nextTasks = tags.stripDeletedFromTasks(fsStore.loadTasks(), id);
    let nextTrash = tags.stripDeletedFromTasks(fsStore.loadTrash(), id);
    const tagList = list;
    const relocate = (t) => fsStore.moveMediaForTask(t, tagList);
    const affectedIds = new Set([...affectedTasks, ...affectedTrash].map((t) => t.id));
    nextTasks = nextTasks.map((t) => (affectedIds.has(t.id) ? relocate(t) : t));
    nextTrash = nextTrash.map((t) => (affectedIds.has(t.id) ? relocate(t) : t));
    fsStore.saveTasks(nextTasks);
    fsStore.saveTrash(nextTrash);
    fsStore.rmEmptyMediaDirs();
    return { ok: true, tags: list };
  });
  ipcHandle('tasks:setTags', (_e, id, tagIds) => {
    const now = new Date().toISOString();
    let next = fsStore.loadTasks().map((t) =>
      t.id === id ? { ...t, tags: tagIds || [], updatedAt: now } : t
    );
    const task = next.find((t) => t.id === id);
    if (task) {
      const moved = fsStore.moveMediaForTask(task, fsStore.loadTags());
      next = next.map((t) => (t.id === id ? moved : t));
    }
    fsStore.saveTasks(next);
    return { ok: true, task: next.find((t) => t.id === id) };
  });
}

function setupSettingsHandlers() {
  // 返回当前存储路径
  ipcHandle('storage:get', () => APP_DATA);

  // 在资源管理器中打开存储目录
  ipcHandle('storage:open', async () => {
    try {
      fs.mkdirSync(APP_DATA, { recursive: true });
      const err = await shell.openPath(APP_DATA);
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 一键清理孤儿文件（未被任务或回收站引用的图片/附件）
  ipcHandle('storage:cleanup', () => {
    const res = cleanupOrphans(APP_DATA);
    return { deleted: res.deleted };
  });

  ipcHandle('backup:export', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出备份',
      defaultPath: `任务看板备份_${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, error: '已取消' };
    try {
      backup.exportZip(APP_DATA, res.filePath);
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcHandle('export:tasks', async (_e, options = {}) => {
    const format = options.format === 'markdown' || options.format === 'html' ? options.format : 'pdf';
    const filters =
      format === 'markdown' ? [{ name: 'Markdown', extensions: ['md'] }]
        : format === 'html' ? [{ name: 'HTML', extensions: ['html'] }]
          : [{ name: 'PDF', extensions: ['pdf'] }];
    const res = await dialog.showSaveDialog(win, {
      title: '导出任务',
      defaultPath: exportTasks.defaultExportName(format),
      filters,
    });
    if (res.canceled || !res.filePath) return { ok: false, error: '已取消' };
    const opts = {
      tagIds: Array.isArray(options.tagIds) ? options.tagIds : [],
      status: options.status || 'all',
      sortKey: options.sortKey || 'createdAt',
      includeImages: !!options.includeImages,
      format,
    };
    try {
      const tasks = fsStore.loadTasks();
      const tags = fsStore.loadTags();
      if (format === 'html') return exportTasks.writeHtmlFile(res.filePath, tasks, tags, opts, APP_DATA);
      if (format === 'markdown') return exportTasks.writeMarkdownFile(res.filePath, tasks, tags, opts, APP_DATA);
      return await exportTasks.writePdfFile(res.filePath, tasks, tags, opts, APP_DATA, BrowserWindow);
    } catch (err) {
      return { ok: false, error: err.message || '导出失败' };
    }
  });

  ipcHandle('backup:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '导入备份',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, error: '已取消' };
    try {
      const result = backup.importZip(res.filePaths[0], APP_DATA);
      if (!result.ok) return result;
      fsStore.reloadAll();
      fsStore.migrateMediaLayout();
      notifyStorageChanged();
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 选择新目录（迁移并切换），返回结果
  ipcHandle('storage:change', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择数据存储目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, error: '已取消' };
    const newDir = res.filePaths[0];
    const oldDir = APP_DATA;
    if (path.resolve(newDir) === path.resolve(oldDir)) return { ok: true, changed: false, path: newDir };
    try {
      // 迁移旧数据（复制，同名跳过，不覆盖）
      const { copied } = storage.migrateData(oldDir, newDir);
      // 记录新路径后切换
      storage.saveStoragePath(APP_DATA_ROOT, newDir);
      APP_DATA = newDir;
      fsStore = new FileStore(newDir);
      fsStore.migrateMediaLayout();
      notifyStorageChanged();
      return { ok: true, changed: true, added: copied, path: newDir };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 重置为默认目录（迁移并切换）
  ipcHandle('storage:reset', () => {
    const def = storage.defaultDir(APP_DATA_ROOT);
    const oldDir = APP_DATA;
    if (path.resolve(def) === path.resolve(oldDir)) return { ok: true, changed: false, path: def };
    storage.migrateData(oldDir, def);
    storage.saveStoragePath(APP_DATA_ROOT, def);
    APP_DATA = def;
    fsStore = new FileStore(def);
    fsStore.migrateMediaLayout();
    notifyStorageChanged();
    return { ok: true, changed: true, path: def };
  });

  ipcHandle('app:getVersion', () => app.getVersion());

  ipcHandle('update:check', async () => {
    const current = app.getVersion();
    try {
      const res = await net.fetch(UPDATE_FEED_URL, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        return { ok: false, error: `无法获取更新信息（HTTP ${res.status}）`, current };
      }
      let feed;
      try {
        feed = JSON.parse(await res.text());
      } catch (_) {
        return { ok: false, error: '更新信息格式错误', current };
      }
      const result = evaluateUpdate(current, feed);
      if (result.status === 'invalid') {
        return { ok: false, error: result.error || '更新信息不完整', current };
      }
      return { ok: true, current, ...result };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '网络错误，请稍后重试', current };
    }
  });

  ipcHandle('shell:openExternal', async (_e, url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: '无效链接' };
    try {
      await shell.openExternal(u);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '无法打开链接' };
    }
  });

  /**
   * 下载新版到 userData/updates，退出旧进程后【启动新 exe】（不先覆盖旧路径）。
   * 新进程启动后再把新包复制回用户原来的桌面/快捷方式路径，避免再点旧图标还是旧版。
   */
  ipcHandle('update:download', async (_e, url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: '无效链接' };

    const sendProgress = (payload) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:downloadProgress', payload);
    };

    const targetPath = resolveUpdateTargetPath({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      env: process.env,
    });
    const targetIsTemp = isExtractedTempPath(targetPath, os.tmpdir());
    const hasPortableEnv = !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);

    const canWriteDir = (dir) => {
      const probe = path.join(dir, `.kanban-write-test-${process.pid}`);
      try {
        fs.writeFileSync(probe, '1');
        fs.unlinkSync(probe);
        return true;
      } catch (_) {
        return false;
      }
    };

    const canHandoff = app.isPackaged && hasPortableEnv && targetPath && !targetIsTemp && canWriteDir(path.dirname(targetPath));

    const uniqueDest = (dir, name) => {
      let dest = path.join(dir, name);
      if (!fs.existsSync(dest)) return dest;
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(dir, `${stem} (${n})${ext}`);
        n += 1;
      }
      return dest;
    };

    let fileName = 'task-kanban-update.exe';
    try {
      const base = path.basename(new URL(u).pathname);
      if (base) fileName = decodeURIComponent(base);
    } catch (_) { /* keep default */ }
    if (!/\.exe$/i.test(fileName)) fileName = `${fileName || 'task-kanban-update'}.exe`;

    const updatesDir = path.join(app.getPath('userData'), 'updates');
    try { fs.mkdirSync(updatesDir, { recursive: true }); } catch (_) { /* ignore */ }
    const destDir = canHandoff ? updatesDir : app.getPath('downloads');
    const dest = uniqueDest(destDir, canHandoff ? `task-kanban-${app.getVersion()}-to-update.exe` : fileName);

    async function downloadTo(destPath) {
      const res = await net.fetch(u, { method: 'GET' });
      if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
      const total = Number(res.headers.get('content-length') || 0) || 0;
      if (!res.body || typeof res.body.getReader !== 'function') {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(destPath, buf);
        sendProgress({ received: buf.length, total: buf.length, percent: 100 });
        return;
      }
      const reader = res.body.getReader();
      const out = fs.createWriteStream(destPath);
      let received = 0;
      sendProgress({ received: 0, total, percent: total ? 0 : null });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.length) continue;
          const buf = Buffer.from(value);
          received += buf.length;
          if (!out.write(buf)) {
            await new Promise((r) => out.once('drain', r));
          }
          const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
          sendProgress({ received, total, percent });
        }
        await new Promise((resolve, reject) => {
          out.end(() => resolve());
          out.on('error', reject);
        });
        sendProgress({ received, total: total || received, percent: 100 });
      } catch (err) {
        try { out.destroy(); } catch (_) { /* ignore */ }
        throw err;
      }
    }

    try {
      await downloadTo(dest);
    } catch (err) {
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (_) { /* ignore */ }
      return { ok: false, error: (err && err.message) || '下载失败' };
    }

    if (!canHandoff) {
      try { shell.showItemInFolder(dest); } catch (_) { /* ignore */ }
      let why;
      if (!app.isPackaged) {
        why = '开发模式不支持自动切换；已下载到「下载」文件夹。请用正式打包的 portable 版升级。';
      } else if (!hasPortableEnv || targetIsTemp) {
        why = `无法定位你双击的那个程序文件。已下载到：${dest}。请完全退出后，用这个新文件替换原来的 exe。`;
      } else {
        why = `无法写入程序目录（${path.dirname(targetPath)}），已下载到：${dest}。请退出后手动替换。`;
      }
      return { ok: true, applied: false, path: dest, targetPath, message: why };
    }

    const getParentPid = (pid) => {
      try {
        const out = require('child_process').execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`],
          { encoding: 'utf8', windowsHide: true, timeout: 8000 }
        );
        const n = parseInt(String(out).trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      } catch (_) {
        return 0;
      }
    };

    try {
      writeHandoff(app.getPath('userData'), {
        replaceTarget: targetPath,
        newExe: dest,
        fromVersion: app.getVersion(),
        createdAt: new Date().toISOString(),
      });

      const parentPid = getParentPid(process.pid);
      const logPath = path.join(os.tmpdir(), `kanban-handoff-${Date.now()}.log`);
      const scriptPath = path.join(os.tmpdir(), `kanban-handoff-${Date.now()}.ps1`);
      const script = buildHandoffScript({
        pid: process.pid,
        parentPid,
        newExePath: dest,
        logPath,
      });
      fs.writeFileSync(scriptPath, '\uFEFF' + script, 'utf8');
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
        { detached: true, stdio: 'ignore', windowsHide: true }
      );
      child.unref();
      setTimeout(() => {
        try { app.quit(); } catch (_) { /* ignore */ }
      }, 400);
      return { ok: true, applied: true, path: dest, targetPath, logPath };
    } catch (err) {
      try { shell.showItemInFolder(dest); } catch (_) { /* ignore */ }
      return {
        ok: true,
        applied: false,
        path: dest,
        targetPath,
        message: `无法自动打开新版本：${(err && err.message) || '未知错误'}。请退出后运行：${dest}`,
      };
    }
  });
}

function notifyStorageChanged() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('storage:changed');
}

// 置顶（系统标题栏下仅保留此窗口设置；其余窗口控制由系统原生提供）
function setupWindowHandlers() {
  ipcHandle('window:setAlwaysOnTop', (_e, flag) => {
    win.setAlwaysOnTop(!!flag);
    return !!flag;
  });
  ipcHandle('window:setTitleBarOverlay', (_e, opts = {}) => {
    if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') {
      return { ok: false };
    }
    try {
      win.setTitleBarOverlay({
        color: opts.color || '#ffffff',
        symbolColor: opts.symbolColor || '#303133',
        height: 40,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function setupOcrHandlers() {
  plugins.ocrIndex.setScheduleProgressHandler((p) => {
    try {
      if (win && !win.isDestroyed()) win.webContents.send('ocrIndex:autoProgress', p);
    } catch (_) { /* ignore */ }
  });
  ipcHandle('ocr:status', () => ocr.langStatus());
  ipcHandle('ocr:recognize', async (event, dataUrl) => {
    const gate = plugins.assertOcrReady();
    if (!gate.ok) return gate;
    const onProgress = (p) => {
      try { event.sender.send('ocr:progress', p); } catch (_) { /* ignore */ }
    };
    return ocr.recognize(dataUrl, onProgress);
  });
  ipcHandle('ocrIndex:getAll', () => plugins.ocrIndex.getAllTexts());
  ipcHandle('ocrIndex:set', (_e, rel, text) => plugins.ocrIndex.setText(rel, text));
  ipcHandle('ocrIndex:clear', () => plugins.ocrIndex.clear());
  ipcHandle('ocrIndex:stats', () => {
    try {
      return { ok: true, ...plugins.ocrIndex.stats(fsStore.loadTasks(), APP_DATA) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcHandle('ocrIndex:build', async (event, opts) => {
    const gate = plugins.assertOcrReady();
    if (!gate.ok) return gate;
    if (!plugins.isEnabled('ocr-search')) {
      return { ok: false, error: '请先开启「图内文字搜索」插件', code: 'DISABLED' };
    }
    const onProgress = (p) => {
      try { event.sender.send('ocrIndex:progress', p); } catch (_) { /* ignore */ }
    };
    try {
      return await plugins.ocrIndex.buildIndex({
        storageRoot: APP_DATA,
        tasks: fsStore.loadTasks(),
        force: !!(opts && opts.force),
        onProgress,
      });
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcHandle('ocrIndex:cancelBuild', () => {
    plugins.ocrIndex.cancelBuild();
    return { ok: true };
  });
}

function setupPluginHandlers() {
  ipcHandle('plugins:list', () => plugins.listPlugins());
  ipcHandle('plugins:setEnabled', (_e, id, enabled) => plugins.setEnabled(id, enabled));
  ipcHandle('plugins:install', async (event, id) => {
    const onProgress = (p) => {
      try { event.sender.send('plugins:progress', { id, ...p }); } catch (_) { /* ignore */ }
    };
    return plugins.install(id, onProgress);
  });
  ipcHandle('plugins:uninstall', (_e, id) => plugins.uninstall(id));
  ipcHandle('plugins:clipboardPeek', (_e, opts) => plugins.clipboardPeek(opts || {}));
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function setupProtocol() {
  protocol.handle('taskimage', (request) => {
    try {
      const url = new URL(request.url);
      // 形如 taskimage://local/images/xxx.png，rel 取 pathname 去掉首斜杠
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (!rel || rel.includes('..')) return new Response('', { status: 404 });
      const abs = path.join(APP_DATA, rel);
      return netFetchIfExists(abs, request);
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
}
async function netFetchIfExists(abs, request) {
  if (!fs.existsSync(abs)) return new Response('', { status: 404 });
  const fwd = {};
  try {
    const range = request && request.headers && request.headers.get('Range');
    if (range) fwd.Range = range;
  } catch (_) { /* ignore */ }
  const res = await net.fetch(pathToFileURL(abs).href, { headers: fwd });
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return res;
  const headers = new Headers(res.headers);
  headers.set('Content-Type', mime);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// 单实例锁：防止残留的重复进程同时读写 tasks.json / 争抢 Chromium 缓存，
// 否则新启动的窗口会因缓存锁冲突而长时间卡在"未就绪"状态（启动即迟钝）。
// 二次启动时聚焦已有窗口而不是另开新进程。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
setupSingleInstanceGuard();
app.whenReady().then(() => {
  fsStore = new FileStore(APP_DATA);
  fsStore.migrateMediaLayout();
  setupProtocol();
  createWindow();
  setupStoreHandlers();
  setupTagHandlers();
  setupSettingsHandlers();
  setupWindowHandlers();
  setupOcrHandlers();
  setupPluginHandlers();
  // 若刚从旧版切换过来：后台把新包覆盖回用户原来的 exe 路径
  schedulePortableHandoffReplace();
  // 注册 F12 切换 DevTools（removeMenu 后默认快捷键会失效，故用全局快捷键）
  globalShortcut.register('F12', () => { win.webContents.toggleDevTools(); });
  globalShortcut.register('Ctrl+Shift+I', () => { win.webContents.toggleDevTools(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

/** 新版本启动后：把 updates 里的新 portable 复制到用户原来的桌面/快捷方式文件 */
function schedulePortableHandoffReplace() {
  if (!app.isPackaged) return;
  const handoff = readHandoff(app.getPath('userData'));
  if (!handoff || !handoff.replaceTarget) return;

  const src =
    process.env.PORTABLE_EXECUTABLE_FILE ||
    handoff.newExe ||
    '';
  const dst = String(handoff.replaceTarget || '');
  if (!src || !dst) return;

  const logFile = path.join(app.getPath('userData'), 'update-handoff.log');
  const log = (m) => {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`, 'utf8');
    } catch (_) { /* ignore */ }
  };
  log(`begin copy ${src} -> ${dst}`);

  let tries = 0;
  const tick = () => {
    tries += 1;
    const res = copyPortableOverTarget(src, dst);
    if (res.ok) {
      log(`ok tries=${tries} bytes=${res.bytes || 0} skipped=${!!res.skipped}`);
      clearHandoff(app.getPath('userData'));
      return;
    }
    log(`fail try=${tries} ${res.error || ''}`);
    if (tries < 60) setTimeout(tick, 500);
    else log('give up');
  };
  setTimeout(tick, 1500);
}
function setupSingleInstanceGuard() {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => { app.quit(); });
}
