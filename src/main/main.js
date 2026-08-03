const { app, BrowserWindow, ipcMain, dialog, clipboard, Tray, Menu, protocol, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const FileStore = require('./fileStore');
const images = require('./images');
const store = require('./store');

// 自定义协议：taskimage://local/images/xxx.png -> 磁盘文件
// 注意：scheme 注册为 standard，taskimage:// 后第一段是 host，故 URL 形如 taskimage://local/<rel>
const APP_DATA = path.join(app.getPath('appData'), 'TaskApp');

let win = null;
let tray = null;
let fsStore = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'taskimage', privileges: { standard: true, secure: true } }]);

function createWindow() {
  win = new BrowserWindow({
    width: 800, height: 600,
    title: '简易任务看板',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  return win;
}

function setupStoreHandlers() {
  ipcMain.handle('tasks:getAll', () => store.sortByCreatedAtDesc(fsStore.loadTasks()));
  ipcMain.handle('tasks:create', async (_e, { text, images: imgs }) => {
    try {
      // 校验必须基于传入的图片数（允许纯图片任务），故传 imgs 给 createTask
      const task = store.createTask({ text, images: imgs || [] });
      const tasks = fsStore.loadTasks();
      const rels = (imgs || []).map((d, i) => fsStore.copyImage(d, task.id, i));
      const final = { ...task, images: rels };
      fsStore.saveTasks([...tasks, final]);
      return { ok: true, task: final };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('tasks:toggle', (_e, id) => {
    fsStore.saveTasks(store.toggleStatus(fsStore.loadTasks(), id));
    return fsStore.loadTasks().find((t) => t.id === id);
  });
  ipcMain.handle('tasks:update', async (_e, id, { text, images: imgs }) => {
    try {
      // imgs 数组每项：已存在相对路径 或 新增以 data: 开头的 dataUrl
      const tasks = fsStore.loadTasks();
      const old = tasks.find((t) => t.id === id);
      if (!old) return { ok: false, error: '任务不存在' };
      const existingRels = old.images;
      const rels = (imgs || []).map((item, i) =>
        typeof item === 'string' && item.startsWith('data:')
          ? fsStore.copyImage(item, id, i)
          : item
      );
      const removed = existingRels.filter((r) => !rels.includes(r));
      fsStore.deleteImages(removed);
      fsStore.saveTasks(store.updateTask(tasks, id, { text, images: rels }));
      return { ok: true, task: fsStore.loadTasks().find((t) => t.id === id) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('tasks:delete', (_e, id) => {
    const tasks = fsStore.loadTasks();
    const t = tasks.find((x) => x.id === id);
    if (t) fsStore.deleteImages(t.images);
    fsStore.saveTasks(store.removeTask(tasks, id));
  });

  ipcMain.handle('image:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp'] }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => images.dataUrlForPath(p));
  });
  ipcMain.handle('image:paste', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return images.dataUrlForClipboard(img);
  });
  ipcMain.handle('image:read', (_e, rel) => fsStore.readImageDataUrl(rel));
}

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { win.show(); win.focus(); } },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('简易任务看板');
  tray.setContextMenu(menu);
  tray.on('click', () => { win.show(); win.focus(); });
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

app.whenReady().then(() => {
  fsStore = new FileStore(APP_DATA);
  setupProtocol();
  createWindow();
  setupStoreHandlers();
  setupTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { /* 保持托盘常驻，不退出 */ });
app.on('before-quit', () => { app.isQuitting = true; });
