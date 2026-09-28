# 标签全局顺序拖拽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在创建/编辑可管理标签下拉中，用左侧手柄拖动调整全局 `tags.json` 顺序。

**Architecture:** `reorderTags` 纯函数（pre-removal toIdx，对齐 `moveMediaItem`）→ IPC `tags:reorder` → UI 手柄 HTML5 DnD（载荷 id）→ `afterTagMutation` 刷新。

**Tech Stack:** Electron IPC、现有 multi-select / `bindThumbReorder` 模式、node:test

**Spec:** `docs/superpowers/specs/2026-09-24-tag-reorder-design.md`

---

### Task 1: `reorderTags` + 单测

**Files:** `src/main/tags.js`, `test/tags.test.js`

- [x] 实现并导出 `reorderTags`
- [x] 测试：C→A、A→C、from===to、缺 id、首尾

### Task 2: IPC 管道

**Files:** `src/main/main.js`, `src/preload.js`, `src/renderer/api.js`

- [x] `tags:reorder` try/catch → `{ ok, tags }` / `{ ok:false, error }`
- [x] `reorderTag` 暴露到 preload + API

### Task 3: UI 手柄 + DnD

**Files:** `src/renderer/ui.js`, `src/renderer/styles.css`

- [x] 行左侧 handle；`cbs.onReorder` / `cbs.canReorder`
- [x] `bindTagOptionReorder`（id 载荷）
- [x] CSS：grab / dragging / drop-target

### Task 4: create / edit 接线

**Files:** `src/renderer/create.js`, `src/renderer/detail.js`

- [x] `onReorder` → API → `afterTagMutation`
- [x] `canReorder`：无改名 / 无 Promise / 无 confirm
- [x] 改名开始/取消/提交结束重绘选项（藏手柄）

### Task 5: 验证

- [x] `node --test test/tags.test.js`
- [ ] 手工清单见 spec
