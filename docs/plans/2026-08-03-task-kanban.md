# 简易任务看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Windows 桌面版简易任务看板（Electron），支持文字/图片任务录入、列表展示、详情编辑、状态管理与本地 JSON 持久化。

**Architecture:** Electron 三层结构：Main 进程负责文件系统、剪贴板、托盘与持久化；Preload 提供安全的 `window.taskAPI` 白名单桥接；Renderer 为纯 HTML/CSS/JS UI。数据与 UI 解耦，核心逻辑在可单测的纯模块中。

**Tech Stack:** Electron、原生 JavaScript（无框架）、Node 内建 `node:test` 单测、electron-builder 打包便携版。

**Spec:** `docs/specs/2026-08-03-task-kanban-design.md`

---

## 文件结构

```
record/简易任务看板/
├── package.json
├── electron-builder.yml          # 打包配置
├── .gitignore
├── src/
│   ├── main/
│   │   ├── main.js               # 窗口、IPC、托盘、自定义协议
│   │   ├── store.js              # 纯逻辑：任务 CRUD/状态/排序（可单测）
│   │   ├── fileStore.js          # 文件持久化：JSON 原子写 + 图片复制/删除/读取
│   │   └── images.js             # 图片读 dataUrl / 校验格式与大小
│   ├── preload.js                # contextBridge 暴露 taskAPI
│   └── renderer/
│       ├── index.html            # 主窗口骨架
│       ├── styles.css            # 全部样式
│       ├── api.js                # 封装 window.taskAPI 调用
│       ├── ui.js                 # DOM 渲染：列表/筛选/缩略图
│       └── app.js                # 事件绑定与业务流程入口
├── test/
│   └── store.test.js             # node:test 单测
├── assets/
│   └── icon.png                  # 应用/托盘图标（64x64 png）
└── docs/
    ├── specs/2026-08-03-task-kanban-design.md
    └── plans/2026-08-03-task-kanban.md
```

说明：`record/简易任务看板/` 既是文档目录也是应用源码根。从 Electron 意义上，源码根 = `record/简易任务看板/`，`src/` 下是各进程代码，如下所有路径均相对该根。

> **关于提交**：`record/简易任务看板/` 将 `git init`（独立仓库）。`d:/Code/Test` 本身不是 git 仓库，故每个 task 的提交都在该子仓库内进行。

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `electron-builder.yml`
- Create: `assets/icon.png`（先放占位 PNG）
- Create: `src/main/images.js`

- [ ] **Step 1: 初始化目录与 git**

Run:
```bash
cd "d:/Code/Test/record/简易任务看板" && git init && mkdir -p src/main src/renderer test assets docs
```
Expected: git 仓库初始化，目录创建成功。

- [ ] **Step 2: 创建 package.json**

Write `package.json`:
```json
{
  "name": "task-kanban",
  "productName": "简易任务看板",
  "version": "1.0.0",
  "description": "简易任务看板（桌面版）",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test test/",
    "build": "electron-builder --win portable"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0"
  }
}
```

- [ ] **Step 3: 创建 .gitignore**

Write `.gitignore`:
```gitignore
node_modules/
dist/
out/
build/
*.log
```

- [ ] **Step 4: 创建 electron-builder.yml**

Write `electron-builder.yml`:
```yaml
appId: com.local.taskkanban
productName: 简易任务看板
directories:
  output: dist
files:
  - src/**
  - assets/**
win:
  target:
    - portable
  icon: assets/icon.png
portable:
  artifactName: "简易任务看板-${version}.exe"
```

- [ ] **Step 5: 创建占位图标 assets/icon.png**

用任意 64x64 PNG（实施时生成一个简单彩色方块 PNG 即可，后续可替换）。确认文件存在：`ls assets/icon.png`。

- [ ] **Step 6: 安装依赖**

Run:
```bash
npm install
```
Expected: node_modules 生成，electron 与 electron-builder 安装成功。

- [ ] **Step 7: 初次提交**

```bash
git add -A && git commit -m "chore: scaffold electron project"
```

---

## Task 2: 纯逻辑任务存储模块（TDD）

**Files:**
- Create: `src/main/store.js`
- Test: `test/store.test.js`

- [ ] **Step 1: 写失败测试**

Write `test/store.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTask, sortByCreatedAtDesc, toggleStatus, updateTask, removeTask,
} = require('../src/main/store');

test('createTask 空文字且无图时报错并带 EMPTY_TASK 码', () => {
  assert.throws(() => createTask(), (e) => e.code === 'EMPTY_TASK');
  assert.throws(() => createTask({ text: '   ' }), (e) => e.code === 'EMPTY_TASK');
});

test('createTask 生成 id/status/时间并裁剪超过5张的图', () => {
  const t = createTask({ text: 'hello', images: ['a','b','c','d','e','f'] });
  assert.ok(t.id);
  assert.equal(t.status, 'pending');
  assert.equal(t.images.length, 5);
  assert.equal(t.createdAt, t.updatedAt);
  assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}/);
});

test('sortByCreatedAtDesc 按创建时间倒序', () => {
  const a = createTask({ text: 'old' });   // te: fixed
  a.createdAt = '2020-01-01T00:00:00.000Z';
  const b = createTask({ text: 'new' });
  b.createdAt = '2024-01-01T00:00:00.000Z';
  assert.deepEqual(sortByCreatedAtDesc([a, b]).map(t => t.text), ['new', 'old']);
});

test('toggleStatus 在 done/pending 间切换并更新时间', () => {
  const t = createTask({ text: 'x' });
  let list = toggleStatus([t], t.id);
  assert.equal(list[0].status, 'done');
  list = toggleStatus(list, t.id);
  assert.equal(list[0].status, 'pending');
});

test('updateTask 修改文字并在超限时裁剪图片', () => {
  const t = createTask({ text: 'x', images: ['i1'] });
  const list = updateTask([t], t.id, { text: 'y', images: ['n1','n2','n3','n4','n5','n6'] });
  assert.equal(list[0].text, 'y');
  assert.equal(list[0].images.length, 5);
});

test('removeTask 仅移除匹配 id', () => {
  const a = createTask({ text: 'a' });
  const b = createTask({ text: 'b' });
  assert.equal(removeTask([a, b], a.id).length, 1);
});

test('createTask 缺失引用不抛错', () => {
  const t = createTask({ images: ['i1'] });
  assert.equal(t.text, '');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/main/store'`（store 尚不存在）。

- [ ] **Step 3: 写实现 store.js**

Write `src/main/store.js`:
```js
const crypto = require('crypto');

const MAX_IMAGES = 5;

function createTask({ text = '', images = [] } = {}) {
  if (!String(text || '').trim() && !images.length) {
    const err = new Error('请至少输入文字或添加图片');
    err.code = 'EMPTY_TASK';
    throw err;
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    text: String(text || ''),
    images: images.slice(0, MAX_IMAGES),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

function sortByCreatedAtDesc(tasks) {
  return [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function toggleStatus(tasks, id) {
  return tasks.map((t) =>
    t.id === id
      ? { ...t, status: t.status === 'done' ? 'pending' : 'done', updatedAt: new Date().toISOString() }
      : t
  );
}

function updateTask(tasks, id, { text, images }) {
  return tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          text: text !== undefined ? String(text) : t.text,
          images: images !== undefined ? images.slice(0, MAX_IMAGES) : t.images,
          updatedAt: new Date().toISOString(),
        }
      : t
  );
}

function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

module.exports = { createTask, sortByCreatedAtDesc, toggleStatus, updateTask, removeTask };
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 7 项全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/store.js test/store.test.js && git commit -m "feat: pure task store logic with tests"
```

---

## Task 3: 文件持久化模块 fileStore

**Files:**
- Create: `src/main/fileStore.js`（新增一个 FakeFileStore 用于后续集成测试思路，但本 task 聚焦实现）

- [ ] **Step 1: 实现 fileStore**

Write `src/main/fileStore.js`:
```js
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.imagesDir = path.join(appDataDir, 'images');
    this.tasksFile = path.join(appDataDir, 'tasks.json');
    fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  loadTasks() {
    try {
      const data = JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      // JSON 损坏：备份原文件，以空列表启动
      try { fs.renameSync(this.tasksFile, this.tasksFile + '.bak'); } catch (_) {}
      return [];
    }
  }

  saveTasks(tasks) {
    const tmp = this.tasksFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    fs.renameSync(tmp, this.tasksFile); // 原子写
  }

  // dataUrl -> 写文件，返回相对路径 images/{id}_{i}.{ext}
  copyImage(dataUrl, taskId, index) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error('无效图片数据');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const rel = `images/${taskId}_${index}.${ext}`;
    fs.writeFileSync(path.join(this.appDataDir, rel), Buffer.from(m[2], 'base64'));
    return rel;
  }

  readImageDataUrl(rel) {
    const abs = path.join(this.appDataDir, rel);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    const ext = path.extname(rel).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  }

  deleteImages(rels) {
    for (const rel of rels || []) {
      try { fs.unlinkSync(path.join(this.appDataDir, rel)); } catch (_) {}
    }
  }
}

module.exports = FileStore;
```

- [ ] **Step 2: 添加 fileStore 集成测试**

Append to `test/store.test.js`（在文件顶部追加以下 require，`store` 用于新测试）:
```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const store2 = require('../src/main/store');
const FileStore = require('../src/main/fileStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
}

test('FileStore 空目录 loadTasks 返回 []', () => {
  const fs2 = new FileStore(tmpDir());
  assert.deepEqual(fs2.loadTasks(), []);
});

test('FileStore 保存后能读回，原子写无 .tmp 残留', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const t = store2.createTask({ text: 'hi' });
  fs2.saveTasks([t]);
  assert.equal(fs2.loadTasks()[0].text, 'hi');
  assert.ok(!fs.existsSync(path.join(dir, 'tasks.json.tmp')));
});

test('FileStore 损坏 JSON 备份并以空启动', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  fs.writeFileSync(path.join(dir, 'tasks.json'), 'not json{');
  assert.deepEqual(fs2.loadTasks(), []);
  assert.ok(fs.existsSync(path.join(dir, 'tasks.json.bak')));
});

test('FileStore copyImage/readImageDataUrl/deleteImages 往返', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const png = 'data:image/png;base64,' + Buffer.from([1,2,3,4]).toString('base64');
  const rel = fs2.copyImage(png, 'abc', 0);
  assert.equal(rel, 'images/abc_0.png');
  assert.ok(fs2.readImageDataUrl(rel).startsWith('data:image/png'));
  fs2.deleteImages([rel]);
  assert.equal(fs2.readImageDataUrl(rel), null);
});
```

- [ ] **Step 3: 运行确认通过**

Run: `npm test`
Expected: 原有 7 项 + 新增 4 项全部 PASS（新测试用顶部追加的 `require('../src/main/store')`，别名为 `store2`，与 Task 2 的具名导出 `createTask` 不冲突）。

- [ ] **Step 4: 提交**

```bash
git add src/main/fileStore.js test/store.test.js && git commit -m "feat: file persistence with atomic writes and image management"
```

---

## Task 4: 图片读取模块 images.js

**Files:**
- Create: `src/main/images.js`

- [ ] **Step 1: 实现图片校验与读取**

Write `src/main/images.js`:
```js
const fs = require('fs');

const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'bmp']);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function dataUrlForPath(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const ext = (absPath.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg');
  if (!ALLOWED.has(ext)) throw new Error('不支持的文件类型，仅支持 jpg/png/bmp');
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  const buf = fs.readFileSync(absPath);
  return `data:image/${ext === 'bmp' ? 'bmp' : ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
}

function dataUrlForClipboard(image) {
  // image: Electron NativeImage
  const png = image.toPNG();
  if (!png || !png.length) return null;
  if (png.length > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { dataUrlForPath, dataUrlForClipboard, ALLOWED, MAX_BYTES };
```

- [ ] **Step 2: 提交**

```bash
git add src/main/images.js && git commit -m "feat: image validation and data-url conversion"
```

---

## Task 5: Main 进程、IPC、托盘与自定义协议

**Files:**
- Create: `src/main/main.js`

- [ ] **Step 1: 实现 main.js**

Write `src/main/main.js`:
```js
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
  ipcMain.handle('tasks:create', (_e, { text, images: imgs }) => {
    // 校验必须基于传入的图片数（允许纯图片任务），故传 imgs 给 createTask
    const task = store.createTask({ text, images: imgs || [] }); // 先占位 id
    const tasks = fsStore.loadTasks();
    const rels = (imgs || []).map((d, i) => fsStore.copyImage(d, task.id, i));
    const final = { ...task, images: rels };
    fsStore.saveTasks([...tasks, final]);
    return final;
  });
  ipcMain.handle('tasks:toggle', (_e, id) => {
    fsStore.saveTasks(store.toggleStatus(fsStore.loadTasks(), id));
    return fsStore.loadTasks().find((t) => t.id === id);
  });
  ipcMain.handle('tasks:update', (_e, id, { text, images: imgs }) => {
    // imgs 数组每项：已存在相对路径 或 新增 logo 以 data: 开头的 dataUrl
    const tasks = fsStore.loadTasks();
    const old = tasks.find((t) => t.id === id);
    const existingRels = old.images; // 现有相对路径
    const rels = (imgs || []).map((item, i) =>
      typeof item === 'string' && item.startsWith('data:')
        ? fsStore.copyImage(item, id, i)
        : item
    );
    const removed = existingRels.filter((r) => !rels.includes(r));
    fsStore.deleteImages(removed);
    fsStore.saveTasks(store.updateTask(tasks, id, { text, images: rels }));
    return fsStore.loadTasks().find((t) => t.id === id);
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

app.on('window-all-closed', (e) => { /* 保持托盘常驻，不退出 */ });
app.on('before-quit', () => { app.isQuitting = true; });
```

- [ ] **Step 2: 提交**

```bash
git add src/main/main.js && git commit -m "feat: main process with ipc, tray, custom protocol"
```

---

## Task 6: Preload 桥接

**Files:**
- Create: `src/preload.js`

- [ ] **Step 1: 实现 preload**

Write `src/preload.js`:
```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  getAllTasks: () => ipcRenderer.invoke('tasks:getAll'),
  createTask: (data) => ipcRenderer.invoke('tasks:create', data),
  toggleStatus: (id) => ipcRenderer.invoke('tasks:toggle', id),
  updateTask: (id, data) => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  pasteImage: () => ipcRenderer.invoke('image:paste'),
  readImage: (rel) => ipcRenderer.invoke('image:read', rel),
  imageUrl: (rel) => 'taskimage://local/' + rel,
});
```

- [ ] **Step 2: 提交**

```bash
git add src/preload.js && git commit -m "feat: preload context bridge exposing taskAPI"
```

---

## Task 7: Renderer 骨架与样式

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`
- Create: `src/renderer/api.js`

- [ ] **Step 1: 编写 index.html**

Write `src/renderer/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; img-src 'self' data: taskimage: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'" />
  <title>简易任务看板</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header id="toolbar">
    <h1>简易任务看板</h1>
    <nav id="filters">
      <button class="filter active" data-filter="all">全部</button>
      <button class="filter" data-filter="pending">待执行</button>
      <button class="filter" data-filter="done">已执行</button>
    </nav>
  </header>

  <main id="layout">
    <section id="list">
      <div id="cards"></div>
    </section>

    <section id="createPanel">
      <h2>创建任务</h2>
      <textarea id="newText" rows="8" placeholder="输入任务描述或备注…"></textarea>
      <div id="newThumbs" class="thumbs"></div>
      <div id="createActions">
        <button id="addImageBtn">添加图片</button>
        <button id="createBtn" class="primary">创建任务</button>
      </div>
      <p class="hint">支持 Ctrl+V 粘贴图片（jpg/png/bmp，≤10MB，最多5张）</p>
    </section>
  </main>

  <div id="detailOverlay" class="overlay hidden">
    <div id="detailModal" class="modal">
      <div id="detailBody"></div>
      <div id="detailActions"></div>
    </div>
  </div>

  <div id="lightboxOverlay" class="overlay hidden">
    <img id="lightboxImg" />
  </div>

  <script src="api.js"></script>
  <script src="ui.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 styles.css**

Write `src/renderer/styles.css`（要点：左右分栏 flex、白色圆角卡片 + 左侧状态色条、已执行删除线/灰化、缩略图行、模态框、提示）：
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: "Microsoft YaHei", sans-serif; background: #f0f2f5; color: #333; }

#toolbar { display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e3e6ea; }
#toolbar h1 { font-size: 18px; margin: 0; }
#filters { display: flex; gap: 8px; }
.filter { border: 1px solid #d4d8dd; background: #fff; padding: 6px 14px; border-radius: 16px; cursor: pointer; }
.filter.active { background: #2563eb; color: #fff; border-color: #2563eb; }

#layout { display: flex; height: calc(100vh - 57px); }
#list { flex: 3; overflow-y: auto; padding: 16px; }
#createPanel { flex: 2; border-left: 1px solid #e3e6ea; padding: 20px; overflow-y: auto; }
#createPanel h2 { margin-top: 0; }

.card { position: relative; background: #fff; border-radius: 10px; padding: 14px 14px 10px 18px; margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 4px solid #2563eb; }
.card.done { border-left-color: #9ca3af; opacity: .6; }
.card.done .text { text-decoration: line-through; }
.card .text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.card .time { font-size: 12px; color: #9ca3af; }
.card .thumb { max-width: 120px; max-height: 80px; border-radius: 6px; margin-top: 8px; }
.card .quick { position: absolute; top: 8px; right: 8px; border: none; background: #eef2ff; color: #2563eb; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.card .quick.done { background: #e5e7eb; color: #555; }

.thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.thumbs .thumb-tile { position: relative; }
.thumbs img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; }
.thumbs .remove { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: none; background: #ef4444; color: #fff; cursor: pointer; line-height: 18px; padding: 0; }

textarea { width: 100%; resize: vertical; border: 1px solid #d4d8dd; border-radius: 6px; padding: 10px; font: inherit; }
#createActions { display: flex; gap: 10px; }
#createActions button { padding: 8px 16px; border-radius: 6px; cursor: pointer; border: 1px solid #d4d8dd; background: #fff; }
#createActions .primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.hint { font-size: 12px; color: #9ca3af; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.overlay.hidden { display: none; }
.modal { background: #fff; border-radius: 10px; width: 560px; max-width: 92vw; max-height: 86vh; overflow: auto; padding: 24px; }
.modal .text { white-space: pre-wrap; }
.modal .meta { font-size: 12px; color: #9ca3af; margin: 8px 0; }
.modal img { max-width: 100%; border-radius: 6px; margin: 4px 0; }
#detailActions { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
#lightboxImg { max-width: 90vw; max-height: 88vh; border-radius: 6px; }
.status-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; }
.status-badge.pending { background: #eef2ff; color: #2563eb; }
.status-badge.done { background: #e5e7eb; color: #555; }
```

- [ ] **Step 3: 编写 api.js**

Write `src/renderer/api.js`:
```js
// 薄封装，renderer 不直接依赖 window.taskAPI 细节
window.API = {};
for (const k of ['getAllTasks','createTask','toggleStatus','updateTask','deleteTask','pickImages','pasteImage','readImage','imageUrl']) {
  window.API[k] = (...a) => window.taskAPI[k](...a);
}
```

- [ ] **Step 4: 提交**

```bash
git add src/renderer/index.html src/renderer/styles.css src/renderer/api.js && git commit -m "feat: renderer skeleton, styles, api wrapper"
```

---

## Task 8: 渲染器业务逻辑 app.js + ui.js

**Files:**
- Create: `src/renderer/ui.js`
- Create: `src/renderer/app.js`

- [ ] **Step 1: 编写 ui.js（DOM 渲染）**

Write `src/renderer/ui.js`:
```js
const ui = (() => {
  const cardsEl = document.getElementById('cards');
  const thumbsEl = document.getElementById('newThumbs');
  const detailBody = document.getElementById('detailBody');
  const detailActions = document.getElementById('detailActions');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function renderCards(tasks, { onQuickToggle, onOpen }) {
    cardsEl.innerHTML = '';
    if (!tasks.length) {
      cardsEl.innerHTML = '<p style="color:#9ca3af;text-align:center;margin-top:40px">暂无任务</p>';
      return;
    }
    for (const t of tasks) {
      const card = document.createElement('div');
      card.className = 'card' + (t.status === 'done' ? ' done' : '');
      const done = t.status === 'done';
      let thumb = '';
      if (t.images.length) {
        thumb = `<img class="thumb" loading="lazy" src="${esc(API.imageUrl(t.images[0]))}">`;
      }
      card.innerHTML = `
        <button class="quick${done ? ' done' : ''}">${done ? '取消完成' : '完成'}</button>
        <div class="text">${esc(t.text) || '<span style="color:#9ca3af">（无文字）</span>'}</div>
        ${thumb}
        <div class="time">${fmtTime(t.createdAt)}</div>`;
      card.querySelector('.quick').addEventListener('click', (e) => { e.stopPropagation(); onQuickToggle(t); });
      card.addEventListener('click', () => onOpen(t));
      cardsEl.appendChild(card);
    }
  }

  function renderNewThumbs({ images, onRemove, onPreview }) {
    thumbsEl.innerHTML = '';
    images.forEach((d, i) => {
      const tile = document.createElement('div');
      tile.className = 'thumb-tile';
      const img = document.createElement('img');
      img.src = d; // dataUrl
      img.title = '点击放大';
      img.addEventListener('click', () => onPreview(d));
      const btn = document.createElement('button');
      btn.className = 'remove'; btn.textContent = '×';
      btn.addEventListener('click', () => onRemove(i));
      tile.append(img, btn);
      thumbsEl.appendChild(tile);
    });
  }

  function renderDetail(t) {
    const done = t.status === 'done';
    detailBody.innerHTML = `
      <h2>任务详情</h2>
      <div class="status-badge ${done ? 'done' : 'pending'}">${done ? '已执行' : '待执行'}</div>
      <div class="text">${esc(t.text) || '<span style="color:#9ca3af">（无文字）</span>'}</div>
      ${t.images.map((r) => `<img class="detail-img" data-src="${esc(API.imageUrl(r))}" src="${esc(API.imageUrl(r))}">`).join('')}
      <div class="meta">创建于 ${fmtTime(t.createdAt)}</div>
      <div class="meta">更新于 ${fmtTime(t.updatedAt)}</div>`;
    detailBody.querySelectorAll('.detail-img').forEach((im) =>
      im.addEventListener('click', () => window.showLightbox(im.src)));
  }

  return { esc, fmtTime, renderCards, renderNewThumbs, renderDetail, detailBody, detailActions, thumbsEl };
})();
```

- [ ] **Step 2: 编写 app.js（事件与流程）**

Write `src/renderer/app.js`:
```js
let tasks = [];
let filter = 'all';
let newImages = []; // dataUrl[] 待建任务的新图，最多5
let editing = null; // 正在编辑的任务对象

const $ = (sel) => document.querySelector(sel);

async function refresh() {
  tasks = await API.getAllTasks();
  const list = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  ui.renderCards(list, {
    onQuickToggle: toggleStatus,
    onOpen: openDetail,
  });
}

async function toggleStatus(t) {
  const updated = await API.toggleStatus(t.id);
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) tasks[idx] = updated;
  await refresh();
  if (editing && editing.id === t.id) { editing = updated; updateOpenDetail(); }
}

// ---- 创建面板 ----
function renderThumbs() {
  ui.renderNewThumbs({
    images: newImages,
    onRemove: (i) => { newImages.splice(i, 1); renderThumbs(); },
    onPreview: window.showLightbox,
  });
}

window.onAddImage = async () => {
  const dataUrls = await API.pickImages();
  for (const d of dataUrls) {
    if (newImages.length >= 5) { alert('最多添加5张图片'); break; }
    newImages.push(d);
  }
  renderThumbs();
};

async function createTask() {
  const text = $('#newText').value;
  if (!text.trim() && !newImages.length) { alert('请至少输入文字或添加图片'); return; }
  const created = await API.createTask({ text, images: newImages });
  $('#newText').value = '';
  newImages = [];
  ui.renderNewThumbs({ images: [], onPreview: () => {} });
  // 若刚创建的是待执行，切到 all 时自动可见
  await refresh();
}

// ---- 详情 ----
let detailState = { mode: 'view', dataUrl: [] };

async function openDetail(t) {
  editing = t;
  detailState = { mode: 'view', dataUrl: [] };
  updateOpenDetail();
  $('#detailOverlay').classList.remove('hidden');
}

function updateOpenDetail() {
  if (detailState.mode === 'edit') {
    renderEditDetail();
  } else {
    ui.renderDetail(editing);
    const done = editing.status === 'done';
    ui.detailActions.innerHTML = `
      <button id="toggleBtn">${done ? '取消完成' : '标记完成'}</button>
      <button id="editBtn">编辑</button>
      <button id="delBtn" style="background:#ef4444;color:#fff;border:none">删除</button>`;
    document.getElementById('toggleBtn').addEventListener('click', () => toggleStatus(editing));
    document.getElementById('editBtn').addEventListener('click', () => {
      detailState.mode = 'edit';
      detailState.dataUrl = [];
      updateOpenDetail();
    });
    document.getElementById('delBtn').addEventListener('click', deleteTask);
  }
}

function renderEditDetail() {
  ui.detailBody.innerHTML = `
    <h2>编辑任务</h2>
    <textarea id="editText" rows="6">${ui.esc(editing.text)}</textarea>
    <div id="editThumbs" class="thumbs"></div>
    <button id="editAdd">添加图片</button>`;
  const current = editing.images.slice(); // rel 路径 或 新增 dataUrl（新建独立副本，避免污染原任务）
  // 展示：已存在(rel) + 新增(dataUrl)
  function drawEditThumbs() {
    const box = document.getElementById('editThumbs');
    box.innerHTML = '';
    current.forEach((item, i) => {
      const tile = document.createElement('div'); tile.className = 'thumb-tile';
      const img = document.createElement('img');
      // 新增图为 data: 前缀的 dataUrl，已存在为相对路径；按内容区分
      img.src = (typeof item === 'string' && item.startsWith('data:')) ? item : API.imageUrl(item);
      const btn = document.createElement('button'); btn.className = 'remove'; btn.textContent = '×';
      btn.addEventListener('click', () => { current.splice(i, 1); drawEditThumbs(); });
      tile.append(img, btn); box.appendChild(tile);
    });
  }
  drawEditThumbs();
  document.getElementById('editAdd').addEventListener('click', async () => {
    const dataUrls = await API.pickImages();
    for (const d of dataUrls) {
      if (current.length >= 5) { alert('最多添加5张图片'); break; }
      current.push(d);
    }
    drawEditThumbs();
  });
  ui.detailActions.innerHTML = `
    <button id="saveBtn" class="primary" style="background:#2563eb;color:#fff;border:none">保存</button>
    <button id="cancelEditBtn">取消</button>`;
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const text = document.getElementById('editText').value;
    const updated = await API.updateTask(editing.id, { text, images: current });
    const idx = tasks.findIndex((x) => x.id === editing.id);
    if (idx >= 0) tasks[idx] = updated;
    editing = updated;
    detailState.mode = 'view';
    await refresh();
    updateOpenDetail();
  });
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    detailState.mode = 'view';
    updateOpenDetail();
  });
}

async function deleteTask() {
  if (!confirm('确定删除该任务及其图片吗？')) return;
  await API.deleteTask(editing.id);
  $('#detailOverlay').classList.add('hidden');
  editing = null;
  await refresh();
}

// ---- lightbox ----
window.showLightbox = (src) => {
  $('#lightboxImg').src = src;
  $('#lightboxOverlay').classList.remove('hidden');
};
$('#lightboxOverlay').addEventListener('click', () => $('#lightboxOverlay').classList.add('hidden'));
$('#detailOverlay').addEventListener('click', (e) => { if (e.target.id === 'detailOverlay') $('#detailOverlay').classList.add('hidden'); });

// ---- 筛选 ----
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    refresh();
  });
});

// ---- 事件 ----
document.getElementById('addImageBtn').addEventListener('click', window.onAddImage);
document.getElementById('createBtn').addEventListener('click', createTask);

// Ctrl+V 粘贴到创建面板
document.addEventListener('paste', async (e) => {
  const target = e.target;
  const inCreate = target.id === 'newText' || target.closest('#createPanel');
  if (!inCreate) return;
  const img = await API.pasteImage();
  if (!img) return; // 非图片
  if (newImages.length >= 5) { alert('最多添加5张图片'); return; }
  newImages.push(img);
  renderThumbs();
});

refresh();
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/ui.js src/renderer/app.js && git commit -m "feat: renderer ui rendering and app flow"
```

---

## Task 9: 手动验收与联调

**Files:** 无新增

- [ ] **Step 1: 启动应用**

Run: `npm start`
Expected: 800×600 中文主窗口打开，左侧空列表（显示"暂无任务"），右侧创建面板。

- [ ] **Step 2: 逐条验收（对照 spec §7 验收标准）**

1. 输入文字 + [添加图片] 选一张 → [创建任务] → 列表出现白底卡片（蓝色左条）。
2. Ctrl+V 粘贴一张截图到输入框（焦点在文本框）→ 缩略图出现在创建面板下方。
3. 无文字无图片点 [创建任务] → 提示"请至少输入文字或添加图片"。
4. 添加第 6 张图 → 提示"最多添加5张图片"。
5. 双击/单击卡片 → 详情弹窗显示全文与所有图片，可点图放大。
6. 详情 [编辑] → 改文字/删图/加图 → [保存] → 内容更新。
7. 卡片右上角 [完成] → 卡片灰化、文字加删除线、左条变灰；[取消完成] 恢复。
8. 顶部筛选切 [已执行]/[待执行]/[全部] 正确过滤。
9. 详情 [删除] → 二次确认 → 卡片消失，`%APPDATA%/TaskApp/images/` 下该任务图片被删除。
10. 关闭应用重开 → 所有任务与状态仍在（持久化验证）。查 `%APPDATA%/TaskApp/tasks.json` 存在且内容正确。
11. 点窗口 X → 应用隐藏到托盘；托盘图标点击恢复；托盘菜单 [退出] 结束进程。
12. 非图片内容粘贴（如一段文字 Ctrl+C 再 Ctrl+V 到输入框）→ 静默忽略，不报错（spec §4）。
13. 手动把某任务的图片文件从 `%APPDATA%/TaskApp/images/` 删除后刷新 → 列表/详情显示 404 占位而不崩溃（spec §4 优雅降级；占位由 taskimage 协议 404 + 卡片缺失图时压测，若卡片 img 加载失败显示占位图标）。

- [ ] **Step 3: 修复联调中发现的问题**

若任何验收项失败，用 systematic-debugging 修复后重跑该验收项。验收全部通过后继续。

---

## Task 10: 打包便携版

**Files:** 无新增

- [ ] **Step 1: 构建**

Run: `npm run build`
Expected: `dist/简易任务看板-1.0.0.exe` 生成（单文件便携版）。

- [ ] **Step 2: 验证产物**

Run: 双击 `dist/简易任务看板-1.0.0.exe`，确认：无需安装运行、无需管理员权限、能正常创建/查看/编辑/删除任务、数据落到 `%APPDATA%/TaskApp/`。

- [ ] **Step 3: 最终提交**

```bash
git add -A && git commit -m "docs: finalize portable build"
```

---

## 备注

- 所有变更立即调用 `saveTasks` 原子写，满足崩溃不丢数据。
- 图片严格归属单一任务（复制而非引用），删除任务时清理其图片文件（spec §2）。
- 路径解析基准 `%APPDATA%/TaskApp/`，见 spec §2 补充。
- 5 张图片上限在创建与编辑两路径均强制。
