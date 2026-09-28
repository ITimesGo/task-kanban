# 创建 / 编辑标签下拉：全局顺序拖拽

## 目标
在新建、编辑任务的**可管理标签下拉**中，用左侧手柄拖动调整**全局标签库**顺序；顺序写入 `tags.json`，各处展示跟随数组顺序。

## 决策（已确认）
- 排序对象：**全局标签库**（非单任务已选标签顺序）
- 交互：左侧 **`⋮⋮` 手柄**拖动（非整行）
- 搜索：有搜索词时**禁用拖动并隐藏手柄**
- 实现：**HTML5 DnD**，对齐缩略图 `bindThumbReorder`；仅手柄 `draggable`
- 范围：仅 `#createTagWrap` / `#editTagWrap`；列表 `#tagFilter*` **不改**（仍只筛选）

## 交互

### 「无搜索」定义
- `q = search.value.trim()`；**仅当** `q.length === 0` 视为无搜索（可显示手柄）
- 仅空格的输入与「有搜索词」相同：隐藏手柄

### 手柄显示
| 条件 | 手柄 |
|------|------|
| `q.length > 0` | 隐藏，不可拖 |
| `tagList.length < 2` | 隐藏 |
| **任意**行正在改名，或改名提交 Promise 未结束 | **全部**隐藏手柄，且忽略 dragstart、dragover、drop（避免 `afterTagMutation` 重绘毁掉未提交改名）。**改名开始 / 取消 / 提交结束**须重绘选项（`syncCreateTag…` / `drawEditTags` 选项段，或等价），不能只靠 drag 守卫——今日改名是原地改 DOM，不重绘则手柄仍会留着 |
| 删除确认框打开中（`isConfirmOpen` 或等价） | `dragstart` / `dragover` / `drop` 全部忽略；若拖已开始则 `dragend` 清样式、不提交 |
| 其余 | 显示手柄 |

### 拖动
- 仅按住 `.ms-opt-handle` 可开始拖；勾选、改名、删除不受影响
- **DnD 载荷用标签 id**（勿用缩略图式 index）：`dataTransfer` 携带 `fromId`；drop 目标取行 `data-id` 为 `toId`
- **插入语义**（与媒体 `moveMediaItem` 一致：先记 **移除前** 的下标，再 remove + insert）：
  1. `fromIdx = indexOf(fromId)`，`toIdx = indexOf(toId)`；缺一或相等 → 原数组不变
  2. `item = splice(fromIdx, 1)[0]`；再 `splice(toIdx, 0, item)` —— **`toIdx` 用移除前记下的值**（勿在移除后再 `indexOf(toId)`）
  3. 例：`[A,B,C]` 把 C 拖到 A → `[C,A,B]`；把 A 拖到 C → `[B,C,A]`
- 拖动中：源行半透明（`is-dragging`）；目标行 `drop-target` 高亮（与缩略图一致即可）
- 成功：`reorderTag` → 用返回的 `tags` 更新内存 → `afterTagMutation`；**保持下拉打开**并重绘
- 失败（含 `{ ok:false }`、id 已不存在）：**不**改本地 `tagList` 顺序；`alert`；可按当前内存重绘或 `getAllTags` 对齐，与 create/rename/delete 失败一致；下拉保持打开

### 与现有管理交互
- 不改变创建 / 改名 / 删除契约（见 `2026-09-24-create-edit-tag-inline-manage-design.md`）
- `afterTagMutation` 增加 reorder 成功路径：与 create/rename/delete 相同刷新链（`tagList`、列表筛选、新建区、`refresh`、编辑打开态 redraw）

## 数据与 API

### `tags.js`
```js
function reorderTags(tags, fromId, toId) {
  // 缺 id → throw NOT_FOUND
  // fromId === toId → 返回原数组（或同引用拷贝），不抛
  // 否则：splice 取出 from，再插入到 to 的当前下标（见上「插入语义」）
}
```

### IPC / preload / API
- `tags:reorder` `(fromId, toId)` → `{ ok, tags }` 或 `{ ok:false, error }`
- `preload` / `api.js` 增加 `reorderTag`

## UI

### `ui.js` — `drawManageableTagOptions`
- 行结构：`[handle?][checkbox+name][rename][delete]`
- `cbs.onReorder?.(fromId, toId)`；可选 `cbs.canReorder?.()`（create/detail 在改名中 / 确认打开时返回 false）
- `q.length===0` 且 ≥2 且 `canReorder!==false`：绑定手柄 DnD（可抽 `bindTagOptionReorder`；事件模式对齐 `bindThumbReorder`，载荷用 id）

### `create.js` / `detail.js`
- `onReorder` → `API.reorderTag` → 成功则 `afterTagMutation()`；失败 alert、不改本地顺序
- `canReorder`：无改名态、无改名 Promise、无确认框

### CSS
- `.ms-opt-handle`：约 20px、灰色、`cursor: grab`；拖中 `grabbing`
- `.ms-option-manage.is-dragging` / `.drop-target`：与现有多选行风格协调，勿引入新卡片壳

## 测试
- `test/tags.test.js`：上述插入例、非法 id、from===to、首尾互拖
- 手工：无搜索可拖；空格搜索无手柄；排序后列表筛选顺序一致；改名中 / 确认删除中不可拖；失败后顺序不变

## 非目标
- 列表筛选下拉里排序
- 单任务 `task.tags` 数组顺序独立编辑
- 引入第三方 DnD 库
- 触控长按专用手势（HTML5 DnD 在桌面 Electron 即可）
