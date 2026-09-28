# 新建 / 编辑标签选择器优化

## 目标
标签一多时，新建与编辑里能快速**搜索已有标签**并勾选；一眼能看出当前已选。不再用整墙胶囊 +「更多」。

## 决策（已确认）
- 痛点优先：**查找**（搜索），不是在本控件里创建标签
- 布局：**下拉多选**（与列表顶栏「选择标签」同类）
- 创建新标签：仍走现有**标签管理**入口，本控件不做「创建并选中」

## 交互

### 控件形态
- 触发框：展示已选标签芯片；可点芯片上的 **×** 取消选中
- 点击框体打开下拉：顶部搜索框 + 可勾选列表（checkbox）
- 搜索：按名称包含匹配（大小写不敏感）；无结果文案「无匹配标签」
- 勾选/取消勾选立即反映到芯片与状态数组
- **关闭下拉：仅点外部关闭**（与列表 `#tagFilter*` 一致；本需求不另加 Esc，也不改列表行为）

### 已选芯片（相对列表筛选的差异）
- 列表筛选可继续「最多 2 个 +N」以省空间
- **新建 / 编辑**：芯片可换行展示全部已选，并带 ×（编辑场景更需要完整可见）

### 空态
- 全局尚无标签：框内占位「尚无标签」+ 提示去标签管理（新建侧保留管理入口）

## 范围
| 位置 | 改动 |
|------|------|
| 新建 `#createTags` | 胶囊墙 → 下拉多选控件 |
| 编辑 `#editTags` | 同上 |
| 列表 `#tagFilter*` | **不改**交互语义（可继续复用底层绘制函数） |
| 标签管理弹窗 | **不改** |

## 实现要点
- 复用 / 扩展 `ui.js` 中 `renderTagFilter` / `drawOptions` / `resolveTagEls`：支持传入自定义 `els`，并为 create/edit 增加「可移除芯片」渲染模式（例如 `renderTagSelectedRemovable`）
- **独立 DOM 与开关逻辑**：`#createTags` / `#editTags` 各自挂载与 `#tagFilterWrap` 同构的 markup（`.multi-select` + `.ms-dropdown` + search + options）；各自绑定打开与**点外部关闭**，**不要**复用列表对 `#tagFilterWrap` 的 document 监听
- `create.js`：`renderNewTagSelect` 改为挂接上述控件 + `newTags` 状态
- `detail.js`：`drawEditTags` 改为同一控件 + `editTagIds`
- 去掉 create 的 `LIMIT=6` / `newTagExpanded` / `.tag-expand`（该路径不再需要）
- **溢出**：`#createSide` 及中间祖先不得裁切下拉。对包裹 multi-select 的路径设 `overflow: visible`（或把 dropdown 挂到不裁切层）；不能只加高 `#createSide` 的 max-height
- 样式：`#createTags` / `#editTags` 使用 `.multi-select` / `.ms-dropdown` 体系；新建侧不再按矮胶囊条限高
- 皮肤：跟随现有 multi-select 的 apple / mario / night 规则

## 非目标
- 不在搜索框创建新标签
- 不排序「已选置顶」（下拉里勾选状态已足够；若后续需要再加）
- 不改任务保存时的 `setTaskTags` 数据流

## 验收
1. 新建 / 编辑可用搜索过滤标签并勾选
2. 已选芯片全部可见且可 × 移除
3. 无匹配时显示「无匹配标签」
4. 创建新标签仍只能通过标签管理
5. 列表顶栏标签筛选行为与改前一致
6. 新建侧打开下拉不被 `#createSide` 裁切
7. 各皮肤下控件可读、可点
