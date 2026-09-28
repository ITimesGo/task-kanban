# 图片 / 视频右键菜单

## 目标
对任务正文中的图片、视频右键，弹出应用内自定义菜单，提供复制、另存为、在外部打开、打开所在文件夹、删除等基础操作。覆盖新建/编辑、详情、列表卡片。

## 范围

### 出现位置
- 新建 / 编辑富文本中的 `figure.doc-media`
- 详情 `.doc-view` 中的 `figure.doc-media`
- 列表卡片 `.doc-preview` 中的 `figure.doc-media`（含视频占位）

### 命中与 kind
- 一律 `const fig = e.target.closest('figure.doc-media')`；无 fig 则忽略（不 `preventDefault`）
- 实际点击可能在 `img` / `video` / `.doc-play` / `.doc-video-ph` / chrome 上，均靠 `closest` 收束到 figure
- 解析一律以 `figure[data-src]`（及 class / `data-kind`）为准，**不依赖**子元素 `src`（列表视频占位无真实 `<video src>`）
- `kind = (data-kind === 'video' || fig.classList.contains('doc-video')) ? 'video' : 'image'`

### 菜单项

| 项 | 新建/编辑 | 详情 / 列表 | 说明 |
|---|---|---|---|
| 复制 | ✓ | ✓ | 见下方「复制约定」 |
| 另存为… | ✓ | ✓ | 系统保存对话框 |
| 在外部打开 | ✓* | ✓* | `shell.openPath` |
| 打开所在文件夹 | ✓* | ✓* | `shell.showItemInFolder` |
| 删除 | ✓ | — | 复用 `removeMediaFig`；列表/详情无此项 |

\*「在外部打开 / 打开所在文件夹」：**存在可访问本地路径时启用**（已保存相对路径，或 pending 的 `srcPath`）；仅纯 `data:` / 无路径时**禁用（仍可见）**，`title` 统一为「无本地文件」。不做额外 toast。

### 非目标
- 附件行（`.att-item`）不做本菜单
- 列表 / 详情不提供删除
- 不使用系统原生 `Menu.popup`

## 交互
- 应用内浮层菜单，贴鼠标位置，贴边防溢出；Esc / 点击外部关闭
- 样式跟随当前皮肤（默认 / apple / night / eyecare / mario）
- **仅**命中 `figure.doc-media` 时 `preventDefault` 并弹菜单；点在正文其它处不拦截默认右键菜单
- 列表卡片上对命中事件 `stopPropagation`，避免冒泡到卡片其它委托
- 编辑区右键删除与角标 `.doc-media-del` 行为一致（仅改 DOM，保存时才落盘）
- 菜单文案统一：「复制」「另存为…」「在外部打开」「打开所在文件夹」「删除」

## 架构
共用模块 `src/renderer/mediaContextMenu.js`：
1. 从 `figure.doc-media` 解析 `{ kind, dataSrc, displayUrl, relPath?, srcPath?, canDelete }`（**不**把未校验的 `absPath` 交给渲染层乱传）
2. 按场景生成菜单项（编辑可删 / 只读不可删；无本地路径则 open* 禁用）
3. 动作：
   - 复制 / 另存为 / 打开 → 经 `API` → preload → IPC
   - 删除 → 注入的 `onDelete(fig)`（编辑器内为 `removeMediaFig`）

挂载点：
- `richEditor.js`：`surface` 委托 `contextmenu`（按 closest 过滤）
- `ui.js` `renderDetail`：`.doc-view` 委托
- `ui.js` `renderCards`：列表容器委托 `.doc-preview figure.doc-media`

## IPC / preload

| preload API | IPC | 作用 |
|---|---|---|
| `copyMedia` | `media:copy` | 复制 |
| `saveMediaAs` | `media:saveAs` | 另存为 |
| `openMedia` | `media:open` | 在外部打开 |
| `showMediaInFolder` | `media:showInFolder` | 打开所在文件夹 |

渲染层只走 `API` / preload，不直接 `ipcRenderer`。

### 入参信任（安全）
IPC 入参只允许：
1. **存储根下相对路径**（拒绝 `..`、绝对路径、越界；与现有 `media:fileUrlSync` 同等校验）
2. **`data:`**（仅图片复制 / 另存为）
3. **本会话 pending 的本地 `srcPath`**（主进程 `fs.existsSync`；须落在用户可选路径语义内，不允许任意盘符乱指——实现时与创建/粘贴写入的 pending 路径同源）

禁止渲染进程直接传未校验的 `absPath`。

### 复制约定
- **图片**：`clipboard.writeImage`（来自 `data:` 或由相对路径读入 buffer）
- **视频（目标平台 Windows）**：主进程将**已存在的本地文件路径**写入剪贴板的文件列表格式（CF_HDROP / `Shell IDListArray`；实现可用 Electron 可用的 `clipboard` 扩展或短暂原生辅助，须在实现计划中钉死一种）。失败返回错误，不静默成功。
- 视频仅有路径时才能复制；无法得到文件路径时该项禁用，`title`「无本地文件」

### 另存为约定
- 默认文件名：已保存 → `path.basename(rel)`；pending `srcPath` → 其 basename；`data:` 图 → `image.png`（或按 MIME：`image/jpeg` → `.jpg` 等）
- 过滤器：`kind === 'image'` → Images；`video` → Videos
- 写入：相对路径 / `srcPath` → 文件复制；`data:` → 写 buffer

### 失败
- 文件不存在、`openPath` 返回非空错误、复制失败、另存为取消以外的写失败：关闭菜单，用现有 `alert` / 应用内提示短文案（如「无法打开文件」「复制失败」「保存失败」）；不静默成功
- 用户取消「另存为」对话框：仅关闭菜单，不提示错误

## 验收
1. 新建/编辑：对图、视频右键可见完整菜单；删除后图消失且可保存
2. 详情 / 列表：右键无「删除」；复制图片后可粘贴到画图/微信等
3. 已落盘视频复制后，可粘贴到资源管理器
4. 纯 `data:` / 无本地路径时：「在外部打开」「打开所在文件夹」禁用且可见，`title` 为「无本地文件」；有 pending `srcPath` 时这两项可用
5. 另存为：对 `data:` 图与已落盘视频均可写出文件；取消对话框不报错
6. 打开 / 打开文件夹对已保存（及有 `srcPath` 的 pending）媒体可用；缺失文件或复制/保存失败有错误提示
7. 正文非媒体处右键仍可用默认菜单；列表右键不误触其它卡片行为
8. 五种皮肤下菜单可读、可点
