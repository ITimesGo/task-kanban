const { app, BrowserWindow, ipcMain, dialog, clipboard, protocol, net, globalShortcut, shell } = require('electron');
const path = require('path');
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
const store = require('./store');
const tags = require('./tags');
const storage = require('./storage');
const { cleanupOrphans } = require('./cleanupOrphans');
const trash = require('./trash');
const backup = require('./backup');
const mediaLayout = require('./mediaLayout');

// 自定义协议：taskimage://local/images/xxx.png -> 磁盘文件
// 注意：scheme 注册为 standard，taskimage:// 后第一段是 host，故 URL 形如 taskimage://local/<rel>
const APP_DATA_ROOT = app.getPath('appData'); // 配置记录的根目录
let APP_DATA = storage.resolveStoragePath(APP_DATA_ROOT); // 实际存储目录（可被设置更换）

let win = null;
let fsStore = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'taskimage', privileges: { standard: true, secure: true } }]);

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
  if (!app.isPackaged) win.openDevTools({ mode: 'detach' }); // 开发时自动打开调试台，方便调试样式
  // 置顶状态：启动时从配置恢复
  win.setAlwaysOnTop(global.alwaysOnTop === true);
  // 从标题栏拖拽移动窗口时，通知渲染进程收起下拉（拖拽区本身收不到 click）
  win.on('will-move', () => {
    try { win.webContents.send('ui:close-popups'); } catch (_) {}
  });
  win.on('close', () => { app.quit(); });
  return win;
}

function setupStoreHandlers() {
  ipcHandle('tasks:getAll', () => fsStore.loadTasks());
  ipcHandle('tasks:create', async (event, { text, images: imgs, attachments, tags: tagIds }) => {
    try {
      const tagOpts = { tags: tagIds || [] };
      const task = store.createTask({ text, images: imgs || [], attachments: attachments || [] });
      const tasks = fsStore.loadTasks();
      const rels = (imgs || []).map((d, i) => fsStore.ingestImage(d, task.id, i, tagOpts));
      const atts = [];
      const attList = attachments || [];
      for (let i = 0; i < attList.length; i++) {
        const a = attList[i];
        const done = await fsStore.copyAttachmentAsync(a.srcPath, task.id, a.name, (pct) => {
          try { event.sender.send('attach:progress', { job: 'create', index: i, count: attList.length, pct }); } catch (_) {}
        }, tagOpts);
        atts.push(done);
      }
      const final = { ...task, images: rels, attachments: atts, tags: tagIds || [] };
      fsStore.saveTasks([...tasks, final]);
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
  ipcHandle('tasks:update', async (event, id, { text, images: imgs, attachments }) => {
    try {
      // imgs 数组每项：已有相对路径、{srcPath} 新增本地文件、或遗留 dataUrl
      const tasks = fsStore.loadTasks();
      const old = tasks.find((t) => t.id === id);
      if (!old) return { ok: false, error: '任务不存在' };
      const tagOpts = { tags: old.tags || [] };
      const existingRels = old.images;
      // 新增项需要写盘。分配一个未被占用的序号作为文件名后缀，
      // 避免编辑时删除/新增图片导致同名覆盖（丢数据）。
      const taken = mediaLayout.imageIndexTakenSet(existingRels, id);
      let nextIdx = 0;
      const alloc = () => { while (taken.has(nextIdx)) nextIdx++; taken.add(nextIdx); return nextIdx; };
      const rels = (imgs || []).map((item) => {
        const isNew = (typeof item === 'string' && item.startsWith('data:'))
          || (item && typeof item === 'object' && item.srcPath);
        return isNew ? fsStore.ingestImage(item, id, alloc(), tagOpts) : item;
      });
      const removed = existingRels.filter((r) => !rels.includes(r));
      fsStore.deleteImages(removed);
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
      const updated = store.updateTask(tasks, id, { text, images: rels, attachments: atts });
      fsStore.saveTasks(updated);
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
      fsStore.deleteAttachments(res.purged.attachments);
    }
    fsStore.saveTrash(res.trash);
    return { ok: true };
  });
  ipcHandle('trash:empty', () => {
    const res = trash.emptyTrash(fsStore.loadTrash());
    for (const t of res.purged) {
      fsStore.deleteImages(t.images);
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
  ipcHandle('image:paste', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return images.dataUrlForClipboard(img);
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
}

function setupProtocol() {
  protocol.handle('taskimage', (request) => {
    try {
      const url = new URL(request.url);
      // 形如 taskimage://local/images/xxx.png，rel 取 pathname 去掉首斜杠
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
      const abs = path.join(APP_DATA, rel);
      return netFetchIfExists(abs);
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
}
function netFetchIfExists(abs) {
  if (!fs.existsSync(abs)) return new Response('', { status: 404 });
  return net.fetch(pathToFileURL(abs).toString());
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
  // 注册 F12 切换 DevTools（removeMenu 后默认快捷键会失效，故用全局快捷键）
  globalShortcut.register('F12', () => { win.webContents.toggleDevTools(); });
  globalShortcut.register('Ctrl+Shift+I', () => { win.webContents.toggleDevTools(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

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
