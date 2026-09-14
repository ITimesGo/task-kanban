# Electron Windows 自动更新落地手册（可复用）

> 目标：别的 Electron 桌面项目按本文一次做对「检查更新 → 下载 → 静默安装 → 自动重启」，避免再走便携自替换、安装向导反复弹窗等弯路。  
> 平台范围：**Windows**（NSIS + `electron-updater` + GitHub Release）。  
> 参考实现：本仓库「任务看板」`src/main/autoUpdate.js`、`electron-builder.yml`。

---

## 1. 选型结论（先记住）

| 方案 | 结论 |
|------|------|
| 便携版（portable）自己下载并覆盖正在运行的 `.exe` | **不要做**。Windows 会锁文件（EBUSY）、NSIS/SFX 临时目录、接力脚本易闪退循环 |
| 打开浏览器下安装包 | 体验差，不算自动更新 |
| **NSIS 安装版 + electron-updater** | **推荐且应作为唯一正式通道** |

产品承诺应写成：

> **首次**用 setup 安装（可选目录）；**之后**应用内一键更新，静默覆盖原目录并自动打开，不再问安装路径。

---

## 2. 依赖与产物

### 2.1 npm

```bash
npm i electron-updater
npm i -D electron-builder
# 若 Windows 无法开 signAndEditExecutable（见 §5），另装：
npm i -D resedit
```

### 2.2 一次成功打包应产出

| 文件 | 是否必须 | 作用 |
|------|----------|------|
| `{name}-setup-{version}.exe` | 必须 | 用户安装 / updater 下载的安装包 |
| `latest.yml` | **必须** | electron-updater 检查更新的清单；缺了检查必失败 |
| `{name}-setup-{version}.exe.blockmap` | 建议 | 差量更新；不传也能整包更新 |

`package.json` 的 `"version"` 必须与 Release / `latest.yml` 一致。

---

## 3. electron-builder 推荐配置

把下面占位符换成你的项目：

- `YOUR_APP_ID` / `YOUR_PRODUCT_NAME`
- `YOUR_GITHUB_OWNER` / `YOUR_GITHUB_REPO`
- `your-app-setup-${version}.exe`

```yml
# electron-builder.yml
appId: YOUR_APP_ID
productName: YOUR_PRODUCT_NAME
directories:
  output: dist
files:
  - src/**
  - assets/**
  - package.json

win:
  target:
    - nsis
  icon: assets/icon.ico
  # 见 §5：多数国内开发机建议 false，图标用 afterPack 写入
  signAndEditExecutable: false

afterPack: ./after-pack.js

nsis:
  # 首次：可选手动选目录
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  # 不弹「所有用户 / 仅我」；始终当前用户（与 perMachine:false 一致）
  allowElevation: false
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: YOUR_PRODUCT_NAME
  installerIcon: assets/icon.ico
  uninstallerIcon: assets/icon.ico
  installerHeaderIcon: assets/icon.ico
  deleteAppDataOnUninstall: false
  artifactName: "your-app-setup-${version}.exe"

publish:
  provider: github
  owner: YOUR_GITHUB_OWNER
  repo: YOUR_GITHUB_REPO
  releaseType: release
```

`package.json`：

```json
{
  "version": "1.0.0",
  "scripts": {
    "build": "electron-builder --win nsis --publish never"
  }
}
```

### 3.1 配置要点（易错）

| 配置 | 推荐 | 原因 |
|------|------|------|
| `win.target: nsis` | 是 | 安装版才能被 updater 安静升级 |
| `oneClick: false` + `allowToChangeInstallationDirectory: true` | 是 | 首次可选目录 |
| `allowElevation: false` | 若只需当前用户 | 避免升级/重装再问「为谁安装」 |
| `signAndEditExecutable: true` | 慎用 | 会拉 `winCodeSign`；无「创建符号链接」权限时打包失败 |
| `publish.provider: github` | 常用 | 与 Release 附件对齐 |

应用内升级**不要**依赖用户再跑一遍安装向导；静默参数见 §4。

---

## 4. 主进程更新逻辑（必做行为）

### 4.1 流程

```
检查更新 (checkForUpdates)
  → 有新版本：展示版本号 + Release 说明
  → 用户点「立即更新」
  → downloadUpdate（可推送进度）
  → update-downloaded
  → quitAndInstall(true, true)   // 静默 + 装完强制启动
```

### 4.2 关键 API 约定

```js
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;          // 先让用户确认
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'YOUR_GITHUB_OWNER',
  repo: 'YOUR_GITHUB_REPO',
});

// 安装完成并自动打开 —— 第一个参数必须为 true（静默）
autoUpdater.quitAndInstall(true, true);
```

| 调用 | 效果 |
|------|------|
| `quitAndInstall(false, true)` | 会弹出 NSIS 向导，用户又要选用户/目录 → **错误用法** |
| `quitAndInstall(true, true)` | 静默装到**已有安装目录**并启动 → **正确用法** |

### 4.3 IPC 建议

| Channel | 方向 | 作用 |
|---------|------|------|
| `update:check` | renderer → main | 返回 `{ status: 'available'\|'latest', current, latest, notes }` |
| `update:download` | renderer → main | 下载并在完成后 `quitAndInstall` |
| `update:downloadProgress` | main → renderer | `{ percent }` |
| `app:getVersion` | renderer → main | 展示当前版本 |

### 4.4 开发模式与便携版

- **未打包**（`!app.isPackaged`）：不要打远程更新，直接提示开发模式。
- **若仍发 portable**：检测到便携环境时明确提示「请改装 setup，之后才能自动更新」，不要尝试自覆盖。

便携检测可参考：`process.env.PORTABLE_EXECUTABLE_FILE` 或安装目录特征；本仓库见 `src/main/appUpdate.js`。

### 4.5 更新说明（Release Notes）

- 来源优先：`updateInfo.releaseNotes`（GitHub Release 正文）。
- 若为空：可用 GitHub API 再拉  
  `GET /repos/{owner}/{repo}/releases/tags/v{version}` 的 `body`。
- UI：单独「更新内容」列表；正文建议每行一条，可用 `-` 开头。
- **不要**再维护一份并行的 `latest.json` 当安装版更新源（易与 `latest.yml` 双源不一致）。

---

## 5. Windows 图标（打包常踩坑）

### 5.1 准备

1. 准备近似正方形的 PNG。
2. 生成多尺寸 **`.ico`**（16/32/48/256 等），例如用 `png-to-ico` + `sharp`。
3. `win.icon` / NSIS `installerIcon` 等指向 **`assets/icon.ico`**。

### 5.2 写入 exe

若 `signAndEditExecutable: false`（避免 winCodeSign 符号链接权限问题），electron-builder **不会**把图标写进 exe，快捷方式会变成 Electron 默认原子图标。

在 `afterPack` 里用纯 JS **`resedit`** 写入图标（本仓库 `after-pack.js`）：

1. 读取 `{productFilename}.exe`
2. `NtExecutable.from(..., { ignoreCert: true })`
3. `IconGroupEntry.replaceIconsForResource(...)`
4. 写回 exe

也可顺带裁剪 `locales`，只留中/英，略减体积。

### 5.3 winCodeSign 报错特征

```
Cannot create symbolic link : 客户端没有所需的特权
... winCodeSign ... darwin ... libcrypto.dylib
```

→ 保持 `signAndEditExecutable: false`，用 resedit；不要靠「以管理员运行」当长期方案。

---

## 6. GitHub Release 发版清单

1. 改 `package.json` → `"version"`
2. `npm run build`
3. 提交并推送版本号
4. 新建 Release：Tag 建议 `v{version}`
5. **Release 正文**：写清更新点（应用内会展示）
6. 上传附件（文件名建议英文，避免中文附件名）：
   - [ ] `*-setup-*.exe`
   - [ ] `latest.yml`
   - [ ] `*.blockmap`（建议）
7. 设为 Latest 并 Publish
8. 用**安装版**验证：检查更新 → 立即更新 → 自动重启且版本号变化

仓库若为私有：需配置 token / `GH_TOKEN`，且客户端要能访问 Release 资源（公开仓库最省事）。

---

## 7. 用户体验约定

| 场景 | 期望行为 |
|------|----------|
| 首次安装 | 可改安装目录；装完有桌面/开始菜单快捷方式 |
| 应用内更新 | 不弹目录/用户向导；进度可显示；结束后自动打开新版本 |
| 手动再跑 setup | 可升级；已装路径应被识别；仍可能点几下「下一步」（可接受） |
| 数据 | 放 `%APPDATA%\{产品名}`（或你统一的 userData），升级不删用户数据（`deleteAppDataOnUninstall: false`） |
| 体积预期 | 安装包常约 **70–100MB**；落地常约 **200–300MB**（Electron/Chromium），属正常 |

关于页建议：

- 当前版本
- 「检查更新」/「立即更新」
- 有新版本时列出 **更新内容**
- 有更新时设置入口可打红点

---

## 8. 验收用例

- [ ] 新机器：setup 可选目录安装成功，图标正确（非 Electron 默认）
- [ ] 低版本安装版 → 检查到高版本 → 展示 notes → 立即更新 → 静默完成并自动打开 → `app.getVersion()` 已变
- [ ] 更新过程中杀毒软件拦截时有可读错误提示（可选优化）
- [ ] 缺 `latest.yml` 时检查失败，错误文案能指向「Release 附件」
- [ ] 便携版（若仍存在）不会误触发覆盖，而是引导改装 setup

---

## 9. 故障速查

| 现象 | 排查 |
|------|------|
| 检查更新失败 | Release 是否有 `latest.yml`；owner/repo 是否写错；网络/代理 |
| 有版本但无更新说明 | Release 正文是否为空；notes 解析是否只吃 HTML |
| 立即更新又弹出安装向导 | 是否误用 `quitAndInstall(false, …)` |
| 桌面图标是原子标 | 是否未生成 `.ico` / 未 afterPack 写图标 / 快捷方式缓存（删快捷方式重装） |
| 打包失败 winCodeSign 符号链接 | `signAndEditExecutable: false` + resedit |
| 升级装到别的盘/目录 | 静默升级应沿用卸载信息里的 InstallLocation；确认用户不是手动选了新目录 |

---

## 10. 明确不要做的事（经验总结）

1. 用 portable 单文件做「正式自动更新」主通道  
2. 下载到临时目录再覆盖 `process.execPath`  
3. 用自定义 `latest.json` 替代 `latest.yml` 当 electron-updater 源（可另做说明页，但不要双源）  
4. 为了图标强开 `signAndEditExecutable` 却不处理 winCodeSign 权限  
5. 首次要选目录，却把应用内更新也做成非静默安装向导  
6. 假设「安装包几十兆 = 占用几十兆」——提示的是**解压后**体积  

---

## 11. 新项目最小落地步骤

1. 定产品：只支持 Windows 安装版自动更新  
2. 加 `electron-builder` NSIS 配置（§3）+ `electron-updater`（§4）  
3. 准备 `icon.ico` + afterPack 写图标（§5）  
4. 关于页：检查 / 立即更新 / 更新说明列表（§7）  
5. 按 §6 发一版，用两台版本号差一档的安装包跑通 §8  

按本文做，通常可一次到位；本仓库中与发版操作对应的短文见 `docs/发版简易.md`，面向终端用户的说明见 `docs/更新说明.md`。
