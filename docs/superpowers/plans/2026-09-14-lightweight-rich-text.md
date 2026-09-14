# 轻量富文本图文混排 Implementation Plan

> **For agentic workers:** Use executing-plans / implement task-by-task. Steps use checkbox syntax.

**Goal:** 任务正文改为白名单轻量富文本（PM JSON `doc`），支持图文混排；详情按文档流；卡片 120px 迷你混排预览。

**Architecture:** 共享 `taskDoc.js` 负责合成/抽取/空判定/pending→rel；主进程 create/update 接受 `doc`+`pendingMedia`；渲染层用 contenteditable 白名单编辑器（产出与 TipTap 兼容的 PM JSON，避免为现有无打包 renderer 强上完整 TipTap 工具链）。只读渲染同一套 JSON→DOM。

**Tech Stack:** 现有 Electron + 原生 JS；`node --test`；可选后续替换为 TipTap 同 schema。

**Spec:** `docs/superpowers/specs/2026-09-14-lightweight-rich-text-design.md`

---

### Task 1: taskDoc 模型层 + 单测
- Create: `src/renderer/taskDoc.js`
- Test: `test/taskDoc.test.js`
- [ ] extractPlainText / extractMedia / isDocVisuallyEmpty / isValidDoc / legacyDocFromTask / rewritePendingSrcs / cap media in doc

### Task 2: store + main IPC
- Modify: `src/main/store.js`, `src/main/main.js`, preload/api as needed
- [ ] create/update 正文路径走 doc+pendingMedia；派生 text/media；空校验；删孤儿

### Task 3: 编辑器 UI
- Create: `src/renderer/richEditor.js`
- Modify: `index.html`, `create.js`, `detail.js`, styles
- [ ] 工具栏 + contenteditable；序列化 doc；pending 媒体

### Task 4: 详情 + 卡片预览
- Modify: `ui.js`, styles
- [ ] 只读渲染；卡片 max-height 120px、媒体≤4、+N

### Task 5: 搜索回归
- Modify: search 使用派生 text
- [ ] 跑现有 test
