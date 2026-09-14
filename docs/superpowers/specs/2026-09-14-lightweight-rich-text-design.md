# 轻量富文本图文混排 — 设计规格

日期：2026-09-14  
状态：待用户确认（已按内部评审修订一版）  
范围：简易任务看板 — 新建 / 编辑 / 详情 / 列表卡片  
相关讨论：`docs/mixed-content-approaches.html`

---

## 1. 背景与目标

### 现状

- 任务描述为纯文本字段 `text`，媒体为独立数组 `media` / `images` / `videos`。
- 新建、编辑 UI 为「上方 textarea + 下方缩略图区」；详情与卡片均为「文字在上、媒体在下」，无法「一段说明 → 图 → 再一段说明」。

### 目标

1. 采用**轻量富文本**（能力白名单），支持图文（及视频）在同一文档流中混排。
2. **详情**按文档流渲染。
3. **列表卡片**展示**迷你混排预览**（短文 + 文中小图），用户已明确选择该方案（非纯文本摘要）。
4. 旧数据只读兼容，打开/保存时平滑迁移，不要求用户手工迁移。
5. **不**重做整页信息架构（顶栏、筛选、左右栏骨架保持）。

### 非目标（第一期）

- 完整 Word 级排版（表格、字体色、任意字号、复杂嵌套）。
- 实时协作光标。
- 用任意 HTML 字符串作为唯一持久化格式。
- 强制卸载重装或破坏性数据迁移脚本（以读时兼容 + 写时升级为主）。
- 改剪贴板「快速建卡」/插件写入新建面板的既有入口行为以外的产品流程（若仍写入 textarea，实现期改为写入编辑器或等价 `doc`；**不**新做插件 API）。
- 重做 OCR 管线：OCR 继续消费派生后的 `images`/`media`（从 `doc` 同步），第一期不改识别触发逻辑。

---

## 2. 能力白名单与 Schema

### 2.1 产品能力

| 允许 | 禁止（第一期） |
|------|----------------|
| 段落、硬换行 | 表格 |
| 加粗、斜体 | 字体颜色、字号、高亮 |
| 无序 / 有序列表 | 标题层级（H1–H6；可后续加 H2） |
| 链接（http/https） | 从剪贴板保留任意 HTML 样式 |
| 图片、视频（块级节点） | 附件嵌入正文（PDF 等仍走 attachments） |

工具栏仅暴露白名单操作。粘贴须消毒到白名单；无法映射的样式丢弃。

### 2.2 锁定 Schema（实现不得漂）

节点：`doc`、`paragraph`、`text`、`hardBreak`、`bulletList`、`orderedList`、`listItem`、`image`、`video`  
Marks：`bold`、`italic`、`link`（attrs: `href`；仅 http/https）

`image` / `video` attrs：`src`（必填）、`alt`（可选，默认 `""`）。

### 2.3 编辑器库（拍板）

- **采用 TipTap**（ProseMirror）做编辑与（可选）只读；仅注册上述 schema 对应 extensions。
- 详情 / 卡片可用同一 schema 的只读渲染，或自研 JSON→DOM（须遵守同一节点表）。
- 关闭「保留任意粘贴 HTML」；自定义 paste 映射到白名单。

---

## 3. 数据模型

### 3.1 字段 `doc`

持久化 TipTap/PM JSON。落盘后的 `image`/`video`.`attrs.src` **必须是 `rel`**（如 `images/<id>/a.png`），禁止持久化 `data:`。

### 3.2 「有效 doc」判定

以下视为**无持久化 doc**（走旧字段合成）：

- 字段缺失、`null`、非对象
- `type !== 'doc'`
- `content` 缺失或非数组
- JSON 损坏无法解析

空文档 `{ type:'doc', content: [] }` 或仅空段落：**算有 doc 结构**，但是否「任务非空」见 §3.5。

### 3.3 读写权威

| 操作 | 规则 |
|------|------|
| 读展示 | 有效 `doc` → 用 `doc`；否则 `legacyDocFromTask(task)` 合成（不写盘） |
| 写保存（新编辑器路径） | **只以客户端提交的 `docDraft` + 待 ingest 媒体为准**；服务端产出最终 `doc`（src 全为 rel）及派生字段 |
| 旁路 | 第一期 UI 不再提供只改 `text`/`media` 而不带 `doc` 的正文编辑。若 IPC 更新**未**带 `doc`/`docDraft`：不得静默清空已有 `doc`；仅更新显式传入的字段（标签/附件/状态等） |

派生回写（每当正文经由新路径保存时强制执行）：

- `text = extractPlainText(doc)`
- `media = extractMedia(doc)` → `{ kind, rel }[]` 文档序、去重保留首次
- `images` / `videos` = 由 `media` 拆分（与现网一致）

### 3.4 旧数据合成 `legacyDocFromTask`

1. 媒体列表 = 现有 `taskMediaItems(task)`（`media` 优先；否则 `images` 后接 `videos`）。
2. 文本：将 `text` 按 `\n` 拆成多个 `paragraph`（连续空行合并为单个空段最多保留一段）；无文本则不插入段落（仅媒体时 `content` 可以只有 image/video）。
3. 其后按媒体序追加 `image`/`video` 节点（`src=rel`）。
4. 非法/缺失 rel：跳过该节点（不抛死）；卡片/详情对该 src 解析失败时显示占位或省略。

### 3.5 空任务规则（与现网对齐并写死）

定义 `isDocVisuallyEmpty(doc)`：

- `extractPlainText(doc).trim() === ''`
- 且不存在任何 `image` / `video` 节点  
（空列表、仅 hardBreak、仅空 paragraph、空 marks → 视为空文本。）

`isTaskContentEmpty({ doc, attachments })`：

- `isDocVisuallyEmpty(doc)` 且 attachments 长度为 0。

| API | 行为 |
|-----|------|
| **create** | `isTaskContentEmpty` → `EMPTY_TASK`（与现网「禁止空创建」一致；**附件-only 允许**） |
| **update** 且本次请求包含正文（`doc`/`docDraft`） | 同上，禁止把正文+媒体+附件更新成全空 |
| **update** 仅改标签/状态等 | 不因正文为空而拒（保持现网 update 较宽松的习惯）；但若带正文则校验 |

校验时机：渲染层禁用创建按钮 + 主进程在 ingest **成功之后**、写盘前再验一次（避免「图上传失败却当有内容」）。

### 3.6 `extractMedia` 与删文件

- 输出：`{ kind: 'image'|'video', rel: string }[]`，与现网 media 项兼容。
- 重复 `src`：保留文档序第一次。
- 保存前编辑器侧已按 `MAX_IMAGES=10`、`MAX_VIDEOS=3` 拦截；主进程 ingest 后再 slice 一次兜底。
- 更新时：对比旧 `media` rel 集合与新集合，**仍走现网 diff 删除**孤儿图片/视频文件（从 doc 去掉的媒体应被删）。

---

## 4. IPC / 保存管线（拍板）

### 4.1 原则

**保存前，客户端把所有新媒体变成可 ingest 的输入；主进程负责落盘并把 `doc` 内临时 src 换成 `rel`。**  
不在主进程解析巨大持久 `data:` 进 tasks.json。

### 4.2 Create / Update payload（正文路径）

```ts
{
  // 编辑器 JSON；其中尚未落盘的媒体 src 为临时 token，如 "pending:0"
  doc: PMNode,
  // 与 pending 下标对应；形状对齐现网 media 入参
  pendingMedia?: Array<{
    kind: 'image' | 'video',
    value: string | { srcPath: string }  // dataURL 或本地路径
  }>,
  attachments?: ...,  // 现网不变
  tags?: ...
}
```

主进程步骤：

1. 按文档序收集 `pending:*` 与已是 `rel` 的节点。
2. 对 pending 调用现有 ingest（等同今日 `ingestOrderedMedia`），得到 `rel`。
3. 重写 `doc` 中 src → `rel`。
4. 派生 `text` / `media` / `images` / `videos`。
5. 空内容校验 → 写 tasks.json；update 时 diff 删孤儿文件。

已是 `rel` 的节点：校验属于本任务或允许的路径规则（防随意指到他任务文件；实现时与现网 update 保留 rel 行为对齐）。

### 4.3 不接受的歧义

- 同一请求既传「权威旧版 `media` 数组改正文」又传 `doc` → **以 `doc` + `pendingMedia` 为准**，忽略用于正文的旧 media 数组（附件除外）。

---

## 5. 界面与交互

### 5.1 新建 / 编辑

- 去掉主路径上的大 textarea + 独立 thumbs 条。
- TipTap 编辑器 + 白名单工具栏（加粗、斜体、列表、链接、图片/视频）。
- 底部保留：标签、附件、管理标签、添加附件、提交。
- 拖放：图/视频插入选区或末尾；其它 → 附件。
- 粘贴图：插入正文并占 pending 额度。

### 5.2 详情

- 只读渲染 `resolveTaskDoc(task)`；图灯箱、视频控件不低于现网。
- 附件仍在文末。

### 5.3 卡片迷你混排（数值拍板）

| 项 | 值 |
|----|-----|
| 预览区最大高度 | **120px**（约 5 行正文视觉；CSS `max-height` + `overflow: hidden` + 底部渐隐） |
| 媒体缩略图上限 | **4**（图片+视频合计，按文档出现顺序截取） |
| 超出媒体 | 第 4 张后不渲染；若文档中媒体总数 `total > 4`，在预览区末尾显示 **`+{total-4}`** |
| 截断方式 | **DOM 全量按白名单渲染进预览容器，靠 CSS 裁切高度**；媒体节点超过 4 个则根本不插入 DOM（降卡片成本） |
| 标记 | 加粗/斜体可见；链接**不可点**（`pointer-events: none` 或渲染为 span） |
| 点击卡片 | 仍打开详情（与现网一致）；预览区内不单独抢视频点击（第一期整卡进详情） |

旧任务：用合成 doc 走同一预览器。

### 5.4 布局非目标

不改顶栏、筛选、分页、设置结构；编辑器样式跟现有 CSS 变量，三皮肤至少不崩。

---

## 6. 搜索、导出、限额

- 搜索：`text` 派生字段 + 无 doc 时旧 text；保证不低于现网命中。
- 导出：优先 `doc`；否则旧 text+media；第一期不崩溃，保真渐进。
- 限额：`MAX_IMAGES=10`、`MAX_VIDEOS=3`、附件上限现网不变；插入前 UI 拦截 + 主进程兜底。

---

## 7. 迁移与兼容

| 场景 | 行为 |
|------|------|
| 只读旧任务 | 合成 doc，不写盘 |
| 首次编辑保存 | 持久化 doc + 派生字段 |
| 旧客户端读新数据 | 仍可读 text+media（顺序可能丢失混排）— 接受 |

损坏 doc：回退合成路径（若有 text/media），否则显示「内容无法解析」占位且不崩溃。

---

## 8. 验收标准

1. 新建：文字中插入图后再输入文字；详情顺序正确。  
2. 编辑保存后重启应用，混排仍在。  
3. 粘贴图片进正文并计入限额。  
4. 旧任务详情/卡片不报错；表现为「多段文本 + 其后原媒体序」。  
5. 卡片：120px 限高 + 最多 4 个媒体缩略图 + 必要时 `+N`；列表不错位。  
6. 工具栏仅有白名单；无表格/颜色。  
7. 附件-only 可创建；全空不可创建。  
8. 从正文删除的图片，保存后磁盘孤儿文件被清理（与现网 update 行为一致）。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| TipTap 体积 | 最小 extension 集；打包后看增量 |
| 粘贴脏 HTML | schema + 自定义 paste |
| 卡片过高 | 120px + 媒体≤4 |
| 双源分叉 | 正文保存单向 doc → text/media |
| pending 映射错误 | 单测 rewrite pending→rel |

---

## 10. 实现分期

1. Schema 工具模块 + legacy 合成 + extract* + 空判定（单测）  
2. 主进程 create/update 管线（pendingMedia + 派生 + 删孤儿）  
3. 新建/编辑 TipTap + 工具栏 + 粘贴拖放  
4. 详情只读  
5. 卡片迷你预览  
6. 搜索/导出回归  

---

## 11. 已拍板决策

- 轻量富文本（TipTap + 固定 schema），非纯块编辑、非完整 Word、非 Markdown 主路径。  
- 整页骨架不动；内容区改为编辑器。  
- 卡片选项 **2**：迷你混排；高度 120px；媒体最多 4；`+N`。  
- 保存：`doc` + `pendingMedia`；落盘后 src 全为 rel。  
- 附件独立；OCR/插件不作为本期范围扩张。
