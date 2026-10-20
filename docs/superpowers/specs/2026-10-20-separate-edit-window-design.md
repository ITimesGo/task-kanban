# 独立编辑窗口 — 设计规格

日期：2026-10-20  
状态：规格已评审通过，待用户确认后写实现计划  
 
范围：简易任务看板 — 列表卡片 / 详情弹窗新增入口，Electron 多窗编辑  
相关代码：`src/main/main.js`、`src/preload.js`、`src/renderer/index.html`、`ui.js`、`detail.js`、`richEditor.js`、`state.js`、`filters.js`

---

## 1. 背景与目标

### 现状

- 仅一个 UI `BrowserWindow`（`win`）加载 `index.html`；隐藏 PDF 导出窗除外。
- 任务卡片点击 → `openDetail` 详情浮层（只读）；浮层内「编辑」→ 同层切换编辑态（`detail.js` + `createRichEditor`）。
- 卡片上仅有完成/待办 toggle（`data-action="toggle"`）；无独立编辑入口。
- Main 在 `win.on('close')` 时 `app.quit()`；`storage:changed` 等事件只 `send` 给主窗。
- 任务读写经 `FileStore` + IPC（`tasks:update` / `tasks:setTags` 等），对多窗天然共享主进程状态，但 renderer 内存（`tasks` / `editing`）不共享。

### 目标

1. **新增**「独立编辑」icon：任务列表每张卡片一份，详情弹窗一份。
2. 点击后打开**独立系统窗口**，**直接进入编辑态**（等同详情里点「编辑」后的能力：正文 / 标签 / 附件等）。
3. **可多开**：不同任务可同时开多个编辑窗；同一任务再次点击则 focus 已有窗，不重复开。
4. 关窗若有未保存改动 → 询问：保存 / 不保存 / 取消。
5. **其它逻辑保持不变**：卡片点开详情、详情内「编辑」按钮、新建区、筛选等均不改行为。

### 非目标（第一期）

- 不抽独立 `edit.html`（采用复用 `index.html?edit=<id>`）。
- 不做 BrowserView / 主窗内伪独立窗。
- 不做「外部已更新」冲突合并 UI（首版：非脏窗可静默刷新；脏窗不强制覆盖编辑器内容）。
- 不改完成/删除等详情其它按钮职责（编辑窗以编辑+保存为主；删除/切换状态可仍只在主详情）。
- 不持久化编辑窗位置/大小偏好（可用合理默认；OS 记忆可随 Electron 默认）。

---

## 2. 拍板决策

| 项 | 决策 |
|----|------|
| 入口 | **新增** icon，不替换现有交互 |
| 入口位置 | 列表卡片 + 详情弹窗 |
| 打开态 | 直接编辑态 |
| 多窗 | 允许；同 taskId 单例（focus） |
| 关窗脏数据 | 对话框：保存 / 不保存 / 取消 |
| 架构 | 复用 `index.html?edit=<taskId>` |
| 保存后 | 留在编辑态，可继续改；关窗才走脏检查 |
| 主窗关闭 | 仍退出整个应用（含所有编辑窗） |

---

## 3. 架构

### 3.1 窗口角色

| 角色 | URL | 职责 |
|------|-----|------|
| 主看板窗 `win` | `index.html`（无 edit 参数） | 现有全部 UI |
| 编辑窗 `editWins.get(taskId)` | `index.html?edit=<taskId>` | 仅编辑壳；不渲染看板列表/新建栏 |

### 3.2 Main 进程

- 维护 `Map<taskId, BrowserWindow>`（或等价结构）。
- 新 IPC（建议名）：
  - `window:openEdit` → `{ taskId }`：若 Map 有且未销毁则 `focus`；否则 `new BrowserWindow`，`loadURL`/`loadFile` 带 query，记入 Map；`closed` 时从 Map 删除。
  - （可选）`window:setEditTitle` → 编辑窗更新标题栏文案。
- **生命周期**：
  - 主窗 `close` → 仍 `app.quit()`（现有行为）。
  - 编辑窗 `close` → 仅销毁该窗；**不得**触发 `app.quit()`。
  - `window-all-closed`：保持现有策略（Windows 上通常随主窗 quit）；不得因关掉最后一个编辑窗而误关主窗。
- **多窗刷新事件（新行为，非仅扩大发送面）**：
  - 今日 `notifyStorageChanged()` / `storage:changed` **只在**换存储路径、导入、重置等场景触发，**不会**在 `tasks:update` / `tasks:setTags` / `tasks:toggle` 等常规 CRUD 后发出。
  - 独立编辑窗落地后，下列变更在成功写盘后必须通知「主窗 + 所有存活编辑窗」刷新任务数据（实现二选一，计划阶段定一种即可）：
    1. **复用** `storage:changed`：在相关 IPC 成功路径调用现有 notify，并改为 fan-out；或
    2. **新频道**（如 `tasks:changed`）：CRUD 专用，fan-out；`storage:changed` 仍表示存储根变更。
  - 首版至少覆盖：`tasks:update`、`tasks:setTags`、以及主窗侧会改同一任务列表展示的写操作（如 `tasks:toggle` / `tasks:add` / `tasks:remove` 若已有）。OCR 进度等可仍只推主窗。

### 3.3 Preload / Renderer API

- `API.openEditWindow(taskId)` → invoke `window:openEdit`。
- 编辑窗入口：启动脚本读 `URLSearchParams` 的 `edit`；若有：
  1. 给 `document.documentElement` / `body` 加 mode class（如 `edit-window`），CSS 隐藏看板/FAB/新建/筛选等。
  2. `await` 拉取任务（现有 list/get 路径），找不到则提示并关窗或显示错误。
  3. 挂载与 `renderEditDetail` 同构的编辑 UI（优先抽取/复用函数，避免复制一整份）。
  4. 接线保存、脏检查、关窗拦截。

### 3.4 UI 入口

**列表卡片（`ui.js` `buildCardEl`）**

- 在现有 toggle 旁（或卡片动作区）增加 `button`：`data-action="open-edit"`，独立 SVG icon，`title`/`aria-label` 如「独立窗口编辑」。
- 点击委托：`open-edit` → `API.openEditWindow(t.id)` + `stopPropagation`，**不**调用 `onOpen` / `openDetail`。

**详情弹窗（`detail.js` 只读 footer）**

- 在「编辑」旁增加同语义按钮/icon；点击 → `API.openEditWindow(editing.id)`。
- 不强制关闭详情浮层。

### 3.5 编辑窗内容与能力

复用现有编辑能力边界：

- 富文本正文（`createRichEditor`）
- 标签选择
- 附件增删 / 媒体预览（与详情编辑一致，含放大镜/删除等已有行为）
- 保存：`API.updateTask` + `API.setTaskTags`（与 `#saveBtn` 同路径）
- 保存成功后：刷新本地任务副本、清除 dirty、**保持编辑态**（可继续改）

首版编辑窗可不提供：详情里的删除、完成切换、仅只读浏览模式（用户已选直接编辑）。

### 3.6 脏数据与关窗

- **产品要求**：编辑窗关闭时若脏 → **三选一**：保存 / 不保存 / 取消。
- **与现网差异**：详情浮层的 `confirmLeaveEditIfDirty` 是 **二选一**（离开并丢弃 / 留下），**不得**直接复用该 helper 充当编辑窗关窗流程。
- 编辑窗实现独立的三按钮确认（可用 `dialog.showMessageBox` 由 main 弹出，或 renderer 自建等价 UI）；详情浮层脏检查保持现有二进制行为不变。
- 拦截关闭：`BrowserWindow` `close` + `e.preventDefault`，向该窗 renderer 询脏 / 出对话框，再 `destroy` 或取消；保存失败 → 不关窗。

### 3.7 多窗同步

- 任一窗（或主窗）完成 §3.2 所列写操作 → main **fan-out** 刷新事件（见 §3.2 频道选择）→ 各窗按现有 `refreshLocal` 类逻辑拉最新任务。
- **脏编辑窗**：收到刷新事件时**不**用远端内容覆盖正在编辑的编辑器；标题或轻提示可选，首版可不做。
- **非脏编辑窗 / 主列表 / 打开的详情**：按现有刷新路径更新。
- 同一任务：编辑窗与详情就地编辑、或两个编辑窗并行 → **后保存覆盖**（不做锁）；详情与编辑窗可同时打开。

---

## 4. 数据流（简图）

```text
[卡片 icon / 详情 icon]
        │
        ▼
 API.openEditWindow(taskId)
        │
        ▼
 main: Map focus | new BrowserWindow(?edit=id)
        │
        ▼
 renderer(edit mode): load task → renderEdit*
        │
   save / close
        │
        ├─ updateTask/setTags → FileStore
        │         │
        │         ▼
        │   emit + fan-out refresh (§3.2: storage:changed 或 tasks:changed)
        │         │
        │         ▼
        │   main + other windows refresh
        │
        └─ dirty close → 三选一 dialog → save | discard | cancel
```


---

## 5. 错误处理

| 情况 | 行为 |
|------|------|
| taskId 不存在 | 编辑窗显示错误文案 + 关闭按钮；或 dialog 后关窗 |
| 保存 IPC 失败 | toast/提示，保持编辑态与脏标记 |
| 开窗时主进程异常 | invoke reject，主界面提示失败 |
| 编辑窗加载中重复点击 | focus 已有窗或排队；不得开出第二个同 id 窗 |

---

## 6. 测试要点

1. 卡片 icon 开窗 → 直接可编辑；卡片其它区域仍开详情。
2. 详情 icon 开窗；详情「编辑」仍就地编辑。
3. 两任务可同时开两窗；同任务二次点击 focus。
4. 编辑后关窗 → 三选一；取消则窗仍在；不保存则丢改动；保存后列表可见更新。
5. 编辑窗保存后主列表刷新；主列表改任务后，非脏编辑窗内容更新（若已实现刷新）。
6. 关主窗 → 应用退出；只关编辑窗 → 主窗仍在。
7. 回归：新建区、剪贴板快捷条、详情编辑保存/取消不受影响。

---

## 7. 实现分期建议

1. Main：`editWins` Map + `window:openEdit` + 编辑窗关闭不 quit；CRUD 成功后按 §3.2 **emit + fan-out** 刷新事件。
2. Preload API + renderer `?edit=` 启动分支 + 最小编辑壳 + 保存 + **三选一**脏关窗。
3. 卡片 + 详情 icon 与样式。
4. 同步策略细调与手工回归；主窗 quit 时默认随 `app.quit()` 结束编辑窗（首版可不逐窗询问脏数据）。


---

## 8. 开放项（实现时可定默认）

- Icon 视觉：外框「弹出」类简笔 SVG，与现有 `card-action` 尺寸体系统一。
- 编辑窗默认尺寸：约 720×640 或贴近详情编辑可用宽度；居中。
- 编辑窗标题：`编辑 · {纯文本摘要截断}`，摘要变更可在保存后更新。
- 编辑窗 chrome：可与主窗相同 `titleBarStyle` / overlay，或普通系统标题栏；计划阶段选一种并全编辑窗一致。
- 文件/图片选择等 dialog：必须 `BrowserWindow.fromWebContents(e.sender)` 作为 parent，避免从编辑窗触发时挂到主看板窗。
