# 新建区可收起（FAB + 固定）— 设计规格

日期：2026-09-17  
状态：规格已评审通过，实现已合入（见 plans/2026-09-17-create-panel-fab.md）  
范围：简易任务看板 — 主布局新建区、右下角 FAB、设置「默认视图」  
相关代码：`index.html`（`#createPanel` / `#layoutSplit`）、`layoutSplit.js`、`create.js`、`viewDefaults.js`、`settings.js`

---

## 1. 背景与目标

### 现状

- 主区为双栏：左侧任务列表 + 右侧常驻 `#createPanel`（富文本新建）。
- `#layoutSplit` 可拖宽，宽度存在 `localStorage`（`kanban-create-panel-width`）。
- 「默认视图」已有筛选 / 排序 / 时间范围 / 每页条数 / 筛选条展开，**没有**新建区布局偏好。

### 目标

1. 新建区支持两种持久化模式：**固定在右侧（docked）** 与 **收起为加号（collapsed）**。
2. collapsed 时右下角显示符合当前皮肤的圆形 **FAB「+」**；点击后以**与 docked 相同的双栏推开布局**临时展开（用户已否决浮层盖住列表、否决居中弹层）。
3. 面板提供 **固定（Pin）** 与 **收起** 两个入口；固定/收起写回同一偏好字段。
4. 设置 → 默认视图增加该项；面板操作与设置读写同一持久化字段（记住上次）。
5. 创建任务成功后**不**自动收起；未提交草稿在收起后再打开时保留。

### 非目标（第一期）

- FAB 可拖动位置、多 FAB 菜单。
- 创建成功后自动收起开关。
- 全局快捷键打开新建（可后续加）。
- 改成浮层 / 底部 sheet / 独立窗口。
- 重做新建编辑器内部能力或标签/附件逻辑。

---

## 2. 状态模型（拍板）

### 2.1 持久化偏好

字段名：`createPanelMode`（写入现有 `kanban-view-defaults`）。

| 值 | 含义 |
|------|------|
| `docked` | 启动即右栏常驻；无 FAB |
| `collapsed` | 启动仅 FAB；右栏默认关闭 |

出厂默认：`docked`（与当前产品行为一致，升级用户不突然丢右栏）。

### 2.2 运行时

| 变量 | 说明 |
|------|------|
| `createPanelMode` | 与偏好同步的当前模式 |
| `createPanelOpen` | 仅在 `collapsed` 下有意义：临时是否展开右栏 |

派生可见性：

- 显示右栏 + 分隔条：`mode === 'docked' || (mode === 'collapsed' && createPanelOpen)`
- 显示 FAB：`mode === 'collapsed' && !createPanelOpen`

### 2.2.1 `applyCreatePanelMode` 与设置保存

`applyCreatePanelMode(mode, opts)` 规则：

| 调用场景 | `createPanelOpen` |
|----------|-------------------|
| **冷启动** / `applySavedViewDefaults` | `docked` → 视为开；`collapsed` → `false`（只显示 FAB） |
| **`createPanelMode` 实际变更**（设置保存或面板固定/收起导致 mode 变了） | 按新 mode：切到 `docked` 则打开右栏；切到 `collapsed` 则关闭右栏（`open = false`） |
| **同 mode 的设置保存**（例如只改每页条数） | **保留**当前 `createPanelOpen`，不得把已展开的临时面板关掉 |

实现注意：`applyViewDefaultsToSession` 应比较新旧 `createPanelMode`；仅 mode 变化或冷启动时按上表重置 open，避免设置里改无关项时误收起面板。

### 2.3 操作真值表

| 用户操作 | mode | createPanelOpen | 持久化 |
|----------|------|-----------------|--------|
| 启动且偏好 docked | docked | （无关，视为开） | — |
| 启动且偏好 collapsed | collapsed | false | — |
| collapsed 下点 FAB | collapsed | true | 不改 mode |
| 点「收起」（含 docked 下收起） | collapsed | false | 保存 `collapsed` |
| 点「固定」（未钉 → 钉） | docked | true/开 | 保存 `docked` |
| 点「固定」（钉 → 取消钉） | collapsed | true（保持展开） | 保存 `collapsed` |
| 创建任务成功 | 不变 | 不变 | 不清 mode；表单按现逻辑清空 |

说明：取消固定后仍保持双栏展开，便于继续编辑；真正回到 FAB 需再点「收起」。

---

## 3. UI 规格

### 3.1 FAB

- 位置：主窗口内容区右下角（避开分页条；建议 `position: fixed` 相对 `#layout`/`main` 或窗口，预留下边距约分页高度 + 16px，右边距 16–20px）。
- 形态：圆形，主色填充，白色「+」；尺寸约 48×48（mario 可略方/像素边，仍保持圆形或皮肤约定的接近圆形）。
- 各皮肤（apple / night / eyecare / mario）使用现有 `--primary` 等 token，禁止另起一套紫色体系。
- `aria-label`：`新建任务`；`title` 同文案。
- 仅在「应显示 FAB」时出现；展开右栏时隐藏（避免与收起按钮双重入口混淆）。

### 3.2 面板顶栏控件

在 `#createPanel` 增加轻量顶栏（或挂到现有 `createEditor` 工具行外侧），放置：

1. **固定**：图标按钮；`docked` 时为按下/实心态（`aria-pressed="true"`），`collapsed` 展开时为空心（`aria-pressed="false"`）。
2. **收起**：图标按钮（建议「向下收起」或面板收合图标，避免与详情 `×` 语义完全混用）；`aria-label`：`收起新建区`。

控件不遮挡富文本工具栏主操作；窄宽度下可与工具栏同一行右对齐。

### 3.3 布局与 `layoutSplit`

- 右栏可见时：行为与现网一致（含拖宽、双击恢复默认宽度）；`layoutSplit` 一并显示。
- 右栏隐藏时：列表占满主区；分隔条隐藏且不可拖。
- 从隐藏 → 显示：恢复上次保存的创建区宽度（已有 `kanban-create-panel-width`），列表被推开（非遮罩）。
- 动画：第一期允许简单宽/opacity 过渡；须尊重 `prefers-reduced-motion`。不要求与选中条同款动画。

### 3.4 草稿

- 收起 / 再打开：不销毁编辑器内容、已选标签、待传附件队列（与「创建成功清空」区分）。
- 切换 mode（固定 ↔ 取消固定）不清空草稿。

---

## 4. 设置

位置：设置 → 默认视图（与 `defFilter*` 等同一区块）。

- 控件：分段或下拉二选一  
  - `固定在右侧` → `docked`  
  - `收起为加号` → `collapsed`
- 与其它默认视图项一致：**变更时写入 localStorage**；**会话布局**仅在「立即应用」或冷启动 `applySavedViewDefaults` 时套用（避免每点一下设置就挤动主界面）。
- 保存默认视图时写入 `createPanelMode`；应用默认视图 / 启动时调用同一套 `applyCreatePanelMode`（遵守 §2.2.1）。
- 面板上固定/收起成功后：`saveViewDefaults({ ...loadViewDefaults(), createPanelMode })`（或等价局部更新），并刷新设置页若正打开则同步草稿展示。

重置默认视图：`createPanelMode` 回到出厂 `docked`。

---

## 5. 架构与文件边界

| 单元 | 职责 |
|------|------|
| `viewDefaults.js` | 扩展 `VIEW_FACTORY_DEFAULTS` / `normalize` / `clone`；`applyViewDefaultsToSession` 调用面板应用函数 |
| 新建模块（建议 `createPanelMode.js`，与 `layoutSplit.js` 并列） | mode / open 状态、FAB 显隐、面板/分隔条显隐、固定与收起绑定、对外 `applyCreatePanelMode(mode, { open?, reason? })` |
| `layoutSplit.js` | 继续管宽度记忆与拖拽；**显隐由 mode 模块驱动**（隐藏时 split 不接收指针）。两边初始化顺序：先挂 mode 再/或同步 apply，避免首屏先画出右栏再闪收起 |
| `create.js` | 创建成功路径**不**改 mode；保持现有清空表单 |
| `settings.js` + `index.html` 设置区 | 默认视图 UI 绑定 |
| `styles.css` | FAB、顶栏按钮、各皮肤；collapsed 时 `#layout` 单栏样式 |
| `index.html` | FAB 节点、面板固定/收起按钮 |

依赖方向：mode 模块可读 `loadViewDefaults`/`saveViewDefaults`；不反向依赖 settings 弹层。

---

## 6. 无障碍与边缘情况

- FAB 与收起/固定均为真实 `<button>`，可键盘聚焦。
- 窗口很窄：展开时仍遵守 `layoutSplit` 的 `MIN_LIST` / 最大创建区宽度；若无法满足最小列表宽，优先保证列表可滚动，创建区取 `clamp` 下限（与现逻辑一致）。
- 详情/设置/灯箱打开时：不强制收起新建区；z-index 保持现有 overlay 在上。
- 多皮肤切换：FAB 随 `data-skin` 即时换肤，无需重载。

---

## 7. 测试要点（实现期自测）

1. 默认 docked：启动即右栏，无 FAB；收起 → FAB；重启仍为 collapsed。  
2. collapsed 下 FAB → 双栏；创建成功后仍展开；收起回 FAB，草稿再打开仍在。  
3. 展开后点固定 → 重启为 docked、无 FAB。  
4. docked 下取消固定 → 仍展开；再收起 → FAB；重启为 collapsed。  
5. 设置改默认并保存 / 重置：与面板状态一致。  
6. collapsed 且临时展开时，仅改每页条数等无关项并「立即应用」→ 面板仍开、FAB 仍隐。  
7. 拖宽在隐藏后再展开仍恢复。  
8. apple / night / eyecare / mario 下 FAB 与按钮无明显违和。

---

## 8. 已确认决策摘要

| 项 | 决策 |
|----|------|
| 未固定时点 + | 临时推成双栏（非浮层） |
| 收回方式 | 面板「收起」按钮 |
| 创建成功 | 不自动收起 |
| 偏好 | 记住上次；设置与面板同一字段 |
| 出厂默认 | `docked` |
