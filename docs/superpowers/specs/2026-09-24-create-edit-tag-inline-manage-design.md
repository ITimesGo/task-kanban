# 新建 / 编辑标签下拉：内联管理（方案 A）

## 目标
在**新建、编辑**任务的标签下拉里，除勾选外，可直接**创建 / 改名 / 删除**标签（Notion 多选型），减少跳转脚上「管理标签」弹窗。

## 决策（已确认）
- 方案：**A** — 行悬停改名/删除 + 搜索无精确匹配时底部「创建 “xxx”」并自动勾选
- 范围：**仅** `#createTagWrap` / `#editTagWrap`
- 列表 `#tagFilter*`：**不改**（仍只筛选，无建改删）
- 新建区 `#manTagBtn`：**隐藏**；内联管理为唯一入口；`#tagOverlay` 代码可保留但用户不可达
- **取代**此前 picker 规格中「创建只能走标签管理 / 本控件不做创建」的非目标（见 `2026-09-24-create-edit-tag-picker-design.md`）

## 市面参照（采纳点）
| 来源 | 采纳 |
|------|------|
| Notion Multi-select | 悬停操作改名/删；打字创建 |
| Linear / 飞书 | 底部「创建 “关键词”」 |
| 通用筛选器 | 筛选侧不做删改 |

## 交互

### 打开下拉
- **去掉**「无标签则不许打开」的守卫（`if (!tagList.length) return`）
- 无标签时仍可打开：聚焦搜索框，便于创建第一个标签

### 下拉结构
1. **搜索框**（现有）：按名称包含过滤
2. **选项列表**：checkbox + 名称；悬停右侧出现 **改名**、**删除**（图标按钮，`stopPropagation`，不触发行勾选）
3. **创建条**（条件见下）

### 绘制契约（唯一）
| 条件 | 选项区 |
|------|--------|
| `tagList.length===0` 且搜索为空 | 仅提示：「尚无标签，输入名称后可创建」（**不再**提「下方标签图标」） |
| 搜索非空，无大小写不敏感的同名标签 | **仅** `.ms-create-row`：`创建 “{trimmed}”`（不并排「无匹配标签」） |
| 有过滤结果（含精确同名） | 只画选项；若搜索非空且已有同名 → **无**创建条 |
| 搜索非空且 trimmed 超长 | 创建条仍可出现，但提交受 `maxlength=15` / API 校验（见下） |

### 创建
- 点击创建条：`name = search.trim()`；空则忽略
- 与弹窗一致：`maxlength` 语义 15；超长由 API / 前端截断或 `alert`（与 `createTag` 现行为一致，不另开规则）
- 成功：清空搜索、**保持下拉打开**、将新 id 勾进 `newTags` / `editTagIds`、重绘芯片与选项
- 失败：`alert`，下拉保持打开

### 改名
- 点击改名：该行名称 → `<input maxlength="15">`，聚焦选中
- **Enter** 或 **失焦**：同一提交路径 `commitRename(id, value)` → `renameTag`；成功则 `afterTagMutation`
- **Esc**：取消改名，恢复原名，**下拉保持打开**
- **点外部关闭下拉且正在改名**：必须在关下拉 / 拆 DOM **之前**同步走 `commitRename`（与失焦同一路径）；**禁止**只依赖偶然 blur（避免先销毁 input 未提交）。若提交**失败**：`alert` 后**不关下拉**，保持行内编辑（与失焦失败一致）
- 失败：`alert`，保持行内编辑（不关下拉）；重名（大小写不敏感撞车）由 API 失败处理，同样 `alert` + 保持编辑
- 编辑中：该行 checkbox 点击忽略

### 删除
- 点击删除：先 `showConfirm('删除标签「{name}」？将从所有任务中移除。')`
- **确认框打开期间**：忽略标签下拉的 document outside-click（确认 UI 在 wrap 外，否则会误关下拉）
- 确认后 `deleteTag` → `afterTagMutation`；**保持下拉打开**并重绘
- 取消确认：下拉保持打开

### 关闭下拉
- 默认仍：**仅点外部关闭**（与现 create/edit 一致）
- Esc：**只**取消行内改名；**不**关下拉
- 例外：确认框打开时不因外部点击关下拉（见上）

## 同步 `afterTagMutation`
每次 create/rename/delete 成功后必须：
1. `tagList` / `ui.setTagMap`
2. `renderTagFilter()`（列表筛选芯片）
3. `renderNewTagSelect()`（新建区）
4. `refresh()`（卡片）
5. **若编辑 UI 已挂载**：从 `editTagIds` 剔除已删 id；调用 `drawEditTags()`（改名刷新名称；删除刷新芯片）。通过 detail 注册回调或等价钩子实现，禁止只靠 list/create 刷新而漏掉打开中的编辑弹窗

（可替换/扩展现有 `syncAfterTagChange`，但编辑打开态 redraw **必做**。）

## 范围

| 位置 | 改动 |
|------|------|
| 新建 `#createTagWrap` | 可打开空列表；行操作 + 创建条；占位文案更新 |
| 编辑 `#editTagWrap` | 同上 |
| 列表 `#tagFilter*` | **不改** |
| `#manTagBtn` | **隐藏** |
| `#tagOverlay` | 代码保留，无入口 |

## 实现要点
- 扩展绘制：create/edit 使用可管理选项（`onRename` / `onDelete` / 创建条）；列表仍走现有 `drawOptions` / `renderTagFilter`
- 创建条：`.ms-create-row`，点击不关下拉
- 操作按钮：默认低可见，行 `:hover` / `:focus-within` 显示（兼顾键鼠；触控至少 focus-within 可点）
- 苹果皮肤：操作按钮加入通用 `button` 排除列表（同 `.ms-tag-x`）
- outside-click 处理器：若 `renaming` → 先 `commitRename`；若 `confirmOpen` → return

## 非目标
- 标签颜色、拖拽排序
- 列表筛选内建改删
- Esc 关闭整个下拉
- 搜索框 Enter 创建（可选增强，非必须；有创建条即可）

## 验收
1. 新建/编辑：搜索勾选不回归
2. **零标签**：可打开下拉 → 输入名称 → 出现创建条 → 创建后已勾选、芯片可见、下拉仍开
3. 有搜索且无同名 → 仅创建条；有同名 → 无创建条
4. 改名：Enter/失焦生效；Esc 取消且下拉仍开；**点外部**时先提交改名再关下拉
5. 删除：确认期间下拉不因外部点击关闭；确认后全局移除，当前芯片与列表筛选同步，下拉仍开
6. 编辑弹窗打开时：在新建或编辑下拉内 **创建 / 改名 / 删除** → 编辑芯片与 `editTagIds` 同步
7. 列表顶栏筛选无改名/删除/创建条
8. `#manTagBtn` 不可见；空态文案不再提「下方标签图标」
9. 操作按钮不触发行勾选；各皮肤可读可点
