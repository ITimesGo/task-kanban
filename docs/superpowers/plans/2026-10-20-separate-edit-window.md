# Separate Edit Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new “独立窗口编辑” icon on each task card and in the detail footer that opens a dedicated Electron window in edit mode; multiple windows allowed; dirty close asks save / discard / cancel.

**Architecture:** Main keeps `Map<taskId, BrowserWindow>` and opens `index.html?edit=<taskId>`. Renderer detects the query, applies `body.edit-window`, and boots a full-window edit shell that reuses `renderEditDetail` / `createRichEditor`. Task CRUD success emits a new fan-out channel `tasks:changed` to the main window and all edit windows. Dirty close uses a three-button `dialog.showMessageBox` owned by main (not `confirmLeaveEditIfDirty`).

**Tech Stack:** Electron (`BrowserWindow`, `ipcMain`/`ipcRenderer`, `dialog`), vanilla renderer JS/CSS, existing `FileStore` IPC.

**Spec:** `docs/superpowers/specs/2026-10-20-separate-edit-window-design.md`

---

## Locked defaults (from spec §8)

| Item | Choice |
|------|--------|
| Refresh channel | **New** `tasks:changed` (keep `storage:changed` for storage-root only) |
| Edit window chrome | Same as main: `titleBarStyle: 'hidden'` + `titleBarOverlay` |
| Default size | 720×640, centered; minWidth 480, minHeight 400 |
| Title | `编辑 · {text slice ≤24}` |
| Main quit + dirty editors | First version: `app.quit()` without per-edit-window prompts |
| Dialog parent | Always `BrowserWindow.fromWebContents(e.sender) \|\| win` for pickers |

---

## File map

| File | Responsibility |
|------|----------------|
| Modify: `src/main/main.js` | `editWins` Map, `createEditWindow`, `window:openEdit`, close intercept + 3-button dialog, `notifyTasksChanged` fan-out, dialog parent fix for pickers |
| Modify: `src/preload.js` | `openEditWindow`, `onTasksChanged` (dirty close is main-side; no close-ask IPC) |
| Modify: `src/renderer/api.js` | Mirror new preload methods onto `API` |
| Create: `src/renderer/editWindow.js` | Detect `?edit=`, boot shell, save-stay-edit, dirty close reply, non-dirty refresh on `tasks:changed` |
| Modify: `src/renderer/detail.js` | Export/reuse hooks for edit mount; detail footer “独立窗口” button; optional small extract of save payload helper |
| Modify: `src/renderer/ui.js` | Card `open-edit` button + click delegation |
| Modify: `src/renderer/styles.css` | `.edit-window` layout; card/detail pop-out icon |
| Modify: `src/renderer/index.html` | Script tag for `editWindow.js` (before `app.js`); optional `#editWindowRoot` if not reusing overlay |
| Modify: `src/renderer/app.js` | Skip board boot when edit-window mode |
| Modify: `src/renderer/filters.js` / `settings.js` | Main board listens `onTasksChanged` → `refresh()` (or fold into existing refresh path) |
| Create: `test/editWindowBoot.test.js` | Pure helpers: parse edit id, title truncate, dirty-close decision table |
| Docs: update spec status after ship | — |

**Script order:** `editWindow.js` after `detail.js` / `api.js` / `ui.js`, before `app.js`.

---

### Task 1: Pure helpers + unit tests

**Files:**
- Create: `src/renderer/editWindowHelpers.js` (Node-requireable pure functions)
- Create: `test/editWindowBoot.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEditTaskIdFromSearch,
  editWindowTitle,
  resolveDirtyCloseAction,
} = require('../src/renderer/editWindowHelpers');

test('parseEditTaskIdFromSearch reads edit param', () => {
  assert.equal(parseEditTaskIdFromSearch('?edit=abc'), 'abc');
  assert.equal(parseEditTaskIdFromSearch('?foo=1&edit=x%2Fy'), 'x/y');
  assert.equal(parseEditTaskIdFromSearch(''), null);
  assert.equal(parseEditTaskIdFromSearch('?edit='), null);
});

test('editWindowTitle truncates', () => {
  assert.equal(editWindowTitle('短'), '编辑 · 短');
  assert.match(editWindowTitle('一二三四五六七八九十一二三四五六七八九十超长'), /^编辑 · /);
  assert.ok(editWindowTitle('一二三四五六七八九十一二三四五六七八九十超长').length < 40);
});

test('resolveDirtyCloseAction maps dialog response', () => {
  // buttons: ['保存', '不保存', '取消'] → indices 0,1,2
  assert.equal(resolveDirtyCloseAction({ dirty: false }), 'close');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 0 }), 'save');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 1 }), 'discard');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 2 }), 'cancel');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: undefined }), 'cancel');
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/editWindowBoot.test.js`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement helpers**

```js
function parseEditTaskIdFromSearch(search) {
  const q = String(search || '');
  const sp = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
  const id = String(sp.get('edit') || '').trim();
  return id || null;
}

function editWindowTitle(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim() || '未命名';
  const slice = raw.length > 24 ? raw.slice(0, 24) + '…' : raw;
  return `编辑 · ${slice}`;
}

function resolveDirtyCloseAction({ dirty, response }) {
  if (!dirty) return 'close';
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseEditTaskIdFromSearch, editWindowTitle, resolveDirtyCloseAction };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/editWindowBoot.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/editWindowHelpers.js test/editWindowBoot.test.js
git commit -m "test: add edit-window pure helpers"
```

---

### Task 2: Main — edit window Map + open IPC + lifecycle

**Files:**
- Modify: `src/main/main.js`

- [ ] **Step 1: Add module-level state near `let win = null`**

```js
/** @type {Map<string, Electron.BrowserWindow>} */
const editWins = new Map();
```

- [ ] **Step 2: Implement `createEditWindow(taskId)`**

- Same `webPreferences` / icon / `titleBarStyle` / overlay as `createWindow`.
- `width: 720, height: 640`, min 480×400, `show: false` then `ready-to-show`.
- `loadFile(index.html, { query: { edit: String(taskId) } })` (Electron `loadFile` supports `query`).
- `removeMenu()`, do **not** attach `close → app.quit`.
- On `closed`: `editWins.delete(taskId)` (compare by id captured in closure).
- Register in Map **before** load completes (so double-open focuses the same instance).

- [ ] **Step 3: Dirty-close intercept on each edit window**

```js
let allowDestroy = false;
bw.on('close', async (e) => {
  if (allowDestroy || bw.isDestroyed()) return;
  e.preventDefault();
  try {
    const result = await bw.webContents.executeJavaScript(
      'window.__editWindowPrepareClose && window.__editWindowPrepareClose()'
    );
    // Prefer IPC round-trip if executeJavaScript is awkward; see Step 3b
  } catch (_) { /* fall through destroy */ }
});
```

**Preferred pattern (use this):**

1. `close` → `e.preventDefault()` unless `bw._allowClose === true`.
2. `bw.webContents.send('window:editCloseAsk')`.
3. Renderer replies via `ipcRenderer.invoke('window:editCloseReply', { action: 'save'|'discard'|'cancel', payload? })` **or** simpler: renderer calls `invoke('window:editCloseDecision')` which:
   - Asks renderer dirty via `webContents.executeJavaScript('!!(window.__editWindowIsDirty && window.__editWindowIsDirty())')`
   - If dirty, `dialog.showMessageBox(bw, { type: 'question', buttons: ['保存','不保存','取消'], defaultId: 0, cancelId: 2, message: '有未保存的修改' })`
   - Returns action to… actually keep dialog **in main** after dirty probe:

```js
bw.on('close', (e) => {
  if (bw._allowClose) return;
  e.preventDefault();
  if (bw._closing) return;
  bw._closing = true;
  (async () => {
    let dirty = false;
    try {
      dirty = !!(await bw.webContents.executeJavaScript(
        'typeof window.__editWindowIsDirty==="function"&&!!window.__editWindowIsDirty()'
      ));
    } catch (_) {}
    // Inline mapping (do NOT call renderer helper — would ReferenceError in main)
    let action = 'close';
    if (dirty) {
      const { response } = await dialog.showMessageBox(bw, {
        type: 'question',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        message: '有未保存的修改',
        detail: '保存后关闭，或不保存丢弃更改。',
      });
      action = response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
    }
    if (action === 'cancel') { bw._closing = false; return; }
    if (action === 'save') {
      const ok = await bw.webContents.executeJavaScript(
        'window.__editWindowSave && window.__editWindowSave()'
      );
      if (!ok) { bw._closing = false; return; }
    }
    bw._allowClose = true;
    bw.close();
  })().catch(() => { bw._closing = false; });
});
```

Also pass `center: true` when constructing the edit `BrowserWindow`.

- [ ] **Step 4: `window:openEdit` in `setupWindowHandlers`**

```js
ipcHandle('window:openEdit', (_e, taskId) => {
  const id = String(taskId || '').trim();
  if (!id) return { ok: false, error: '缺少任务 id' };
  const existing = editWins.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true, focused: true };
  }
  const bw = createEditWindow(id);
  editWins.set(id, bw);
  return { ok: true, focused: false };
});
```

- [ ] **Step 5: Manual smoke (dev)**

Run app, from DevTools on main:  
`require('electron').ipcRenderer` not available — instead temporarily call from renderer after Task 3, or invoke via a one-line test harness.  
At this stage: unit-less; proceed after code review that Map + close path look correct.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js
git commit -m "feat(main): open per-task edit BrowserWindow"
```

---

### Task 3: `tasks:changed` emit + fan-out

**Files:**
- Modify: `src/main/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/api.js`
- Modify: `src/renderer/settings.js` and/or `filters.js` / boot refresh listener

- [ ] **Step 1: Add notifier**

```js
function notifyTasksChanged() {
  const send = (bw) => {
    if (!bw || bw.isDestroyed()) return;
    try { bw.webContents.send('tasks:changed'); } catch (_) {}
  };
  send(win);
  for (const bw of editWins.values()) send(bw);
}
```

- [ ] **Step 2: Call after successful writes**

At end of success paths (before `return`), call `notifyTasksChanged()` for at least:

- `tasks:create` (ok)
- `tasks:update` (ok)
- `tasks:setTags` (ok)
- `tasks:toggle`
- `tasks:delete` (ok)
- `trash:restore` / `trash:purge` / `trash:empty` (ok) — list shape changes

Do **not** remove existing `notifyStorageChanged` usages.

- [ ] **Step 3: Preload + API**

```js
// preload
openEditWindow: (taskId) => ipcRenderer.invoke('window:openEdit', taskId),
onTasksChanged: (cb) => {
  const handler = () => cb();
  ipcRenderer.on('tasks:changed', handler);
  return () => ipcRenderer.removeListener('tasks:changed', handler);
},
```

```js
// api.js — add to forwarded list or explicit lines
window.API.openEditWindow = (taskId) => window.taskAPI.openEditWindow(taskId);
window.API.onTasksChanged = (cb) => window.taskAPI.onTasksChanged(cb);
```

- [ ] **Step 4: Main board subscription**

Where `API.onStorageChanged` already refreshes (`settings.js` ~1322), also:

```js
if (typeof API.onTasksChanged === 'function') {
  API.onTasksChanged(() => { loadTags(); refresh(); });
}
```

Avoid double-refresh storms: `onTasksChanged` should **not** call `renderTrashList` unless trash APIs fired — calling `refresh()` + `loadTags()` is enough for board. Keep trash refresh on storage/trash actions only if already covered by those IPC return paths in UI.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js src/preload.js src/renderer/api.js src/renderer/settings.js
git commit -m "feat: fan-out tasks:changed after CRUD"
```

---

### Task 4: Dialog parent = sender window

**Files:**
- Modify: `src/main/main.js` (`image:pick`, `media:pick`, `file:pick`, and any other `showOpenDialog(win, …)` used from editors)

- [ ] **Step 1: Helper**

```js
function dialogParent(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender) || win;
  } catch (_) {
    return win;
  }
}
```

- [ ] **Step 2: Pick handlers currently have NO event arg** (`async () => { … showOpenDialog(win, …) }`). Change each to accept `event` and parent on the sender:

```js
// BEFORE
ipcHandle('image:pick', async () => {
  const res = await dialog.showOpenDialog(win, { … });
});

// AFTER
ipcHandle('image:pick', async (event) => {
  const res = await dialog.showOpenDialog(dialogParent(event), { … });
});
```

Same for `media:pick` and `file:pick`. If you forget to add `(event)`, `dialogParent(event)` falls back to `win` and edit-window pickers stay wrong.

- [ ] **Step 3: `window:setTitleBarOverlay` must target sender**

Today it always mutates `win`. Change to:

```js
ipcHandle('window:setTitleBarOverlay', (event, opts = {}) => {
  const bw = dialogParent(event);
  if (!bw || bw.isDestroyed() || typeof bw.setTitleBarOverlay !== 'function') {
    return { ok: false };
  }
  try {
    bw.setTitleBarOverlay({
      color: opts.color || '#ffffff',
      symbolColor: opts.symbolColor || '#303133',
      height: 40,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
```

Same idea if `window:setAlwaysOnTop` should stay main-only — leave always-on-top on `win` only (edit windows need not pin).

- [ ] **Step 4: Commit**

```bash
git add src/main/main.js
git commit -m "fix: parent dialogs and titleBarOverlay on invoking window"
```

---

### Task 5: Renderer edit-window boot shell

**Files:**
- Create: `src/renderer/editWindow.js`
- Modify: `src/renderer/editWindowHelpers.js` (dual export → `window.EditWindowHelpers` when in browser)
- Modify: `src/renderer/index.html` (script tags: helpers then editWindow, both before `app.js`)
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/detail.js` (save stay-in-edit; edit-window chrome; no view/delete/toggle)

- [ ] **Step 1: CSS — hide board in edit mode**

```css
/* Real ids from index.html — do not invent #fabCreate / #clipboardQuick */
body.edit-window #toolbar,
body.edit-window #layout,
body.edit-window #createFab {
  display: none !important;
}
/* Also hide clipboard quick bar if present (class/id as in clipboardQuick.js DOM) */
body.edit-window .clip-quick-bar,
body.edit-window #clipQuickBar {
  display: none !important;
}
body.edit-window #detailOverlay {
  display: flex !important;
  position: fixed;
  inset: 40px 0 0 0; /* below titlebar overlay */
  /* full window; no dim click-away */
}
body.edit-window #detailClose {
  display: none; /* OS close → dirty intercept; or map to window.close() */
}
```

Verify clipboard node id/class in `clipboardQuick.js` when implementing; hide that node too.

- [ ] **Step 2: `index.html` scripts + helpers global**

Add before `app.js`:

```html
<script src="editWindowHelpers.js"></script>
<script src="editWindow.js"></script>
```

At bottom of `editWindowHelpers.js` (like `viewDefaults.js`):

```js
if (typeof window !== 'undefined') {
  window.EditWindowHelpers = { parseEditTaskIdFromSearch, editWindowTitle, resolveDirtyCloseAction };
}
```

- [ ] **Step 3: `editWindow.js` boot (must load tags + theme)**

```js
(function bootEditWindow() {
  const helpers = window.EditWindowHelpers || {};
  const id = helpers.parseEditTaskIdFromSearch
    ? helpers.parseEditTaskIdFromSearch(location.search)
    : null;
  if (!id) return;
  document.documentElement.classList.add('edit-window');
  document.body.classList.add('edit-window');
  window.__IS_EDIT_WINDOW__ = true;
  window.__EDIT_TASK_ID__ = id;

  (async () => {
    if (typeof initTheme === 'function') initTheme();
    if (typeof loadTags === 'function') await loadTags(); // required: renderEditDetail uses tagList

    const task = typeof API.getTask === 'function'
      ? await API.getTask(id)
      : (await API.getAllTasks()).find((t) => String(t.id) === String(id));
    if (!task) {
      alert('任务不存在');
      try { window.close(); } catch (_) {}
      return;
    }
    editing = task;
    detailState = { mode: 'edit', dataUrl: [] };
    const title = (helpers.editWindowTitle || ((t) => '编辑 · ' + t))(task.text);
    document.title = title;
    const titleEl = document.getElementById('titlebar-title');
    if (titleEl) titleEl.textContent = title;
    const overlay = document.getElementById('detailOverlay');
    if (overlay) overlay.classList.remove('hidden');
    updateOpenDetail(); // edit chrome via detail.js (see Step 4)

    window.__editWindowIsDirty = () => typeof window._editIsDirty === 'function' && !!window._editIsDirty();
    window.__editWindowSave = async () => {
      if (typeof window.saveCurrentEdit === 'function') return !!(await window.saveCurrentEdit());
      return false;
    };

    if (typeof API.onTasksChanged === 'function') {
      API.onTasksChanged(async () => {
        if (window.__editWindowIsDirty()) return;
        if (typeof loadTags === 'function') await loadTags();
        const fresh = await API.getTask(id);
        if (!fresh) return;
        editing = fresh;
        detailState.mode = 'edit';
        updateOpenDetail();
        const t2 = helpers.editWindowTitle(fresh.text);
        document.title = t2;
        const el = document.getElementById('titlebar-title');
        if (el) el.textContent = t2;
      });
    }
  })();
})();
```

Helper: `function setEditWindowTitle(text)` updates both `document.title` and `#titlebar-title`. Use after save too.

- [ ] **Step 4: detail.js — edit-window-only chrome + save stay-in-edit**

**Save:** Extract `async function saveCurrentEdit()` returning `boolean`. Wire `#saveBtn` and `window.saveCurrentEdit = saveCurrentEdit`. After success:

```js
if (window.__IS_EDIT_WINDOW__) {
  // clear dirty baseline, remount edit (stay in edit), update title
  // do NOT set detailState.mode = 'view'; do NOT call board refresh()
  return true;
}
// existing board path: mode view + refresh + updateOpenDetail
```

**Cancel / view chrome (spec §3.5 — no delete/toggle in edit window):**

When `window.__IS_EDIT_WINDOW__` inside `renderEditDetail` footer:

- Hide or omit any path that switches to view mode.
- Replace `#cancelEditBtn` behavior: do **not** `detailState.mode = 'view'`. Instead call `window.close()` (triggers main dirty-close intercept). Optionally relabel button to「关闭」.
- Do **not** render view-mode footer (删除 / 标记完成) in the edit window at all — if something forces view, immediately bounce back to edit or close.

When `window.__IS_EDIT_WINDOW__` inside `updateOpenDetail` view branch: should not run; if it does, re-enter edit or no-op.

- [ ] **Step 5: `app.js` skip board-only work**

```js
if (window.__IS_EDIT_WINDOW__) {
  // Theme + tags already started in editWindow.js; do NOT refresh board / silentCheckUpdate
} else {
  initTheme();
  if (typeof applySavedViewDefaults === 'function') {
    applySavedViewDefaults({ refreshList: false, coldStart: true });
  }
  loadTags();
  refresh();
  if (typeof window.silentCheckUpdate === 'function') {
    setTimeout(() => { window.silentCheckUpdate(); }, 5000);
  }
}
```

Note: `editWindow.js` must run **before** `app.js` so `__IS_EDIT_WINDOW__` is set synchronously from `location.search` before `app.js` executes (set the flag at the top of `editWindow.js` before the async IIFE).

- [ ] **Step 6: Manual test**

1. From main DevTools: `API.openEditWindow('<real-id>')`
2. Window opens in edit UI; board hidden; tag picker populated; theme applied.
3. No 删除 / 标记完成; 取消/关闭 → dirty dialog or close.
4. Save stays in edit; dirty close → 三选一.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/editWindow.js src/renderer/editWindowHelpers.js src/renderer/detail.js src/renderer/app.js src/renderer/styles.css src/renderer/index.html
git commit -m "feat: boot index.html?edit= as edit window shell"
```

---

### Task 6: Card + detail entry icons

**Files:**
- Modify: `src/renderer/ui.js`
- Modify: `src/renderer/detail.js`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: SVG constant** (pop-out / external-window metaphor), same stroke style as `CHECK_ICO`.

- [ ] **Step 2: `buildCardEl` — add button next to toggle**

```html
<button type="button" class="card-action card-action-editwin" data-action="open-edit"
  title="独立窗口编辑" aria-label="独立窗口编辑">…svg…</button>
```

- [ ] **Step 3: Delegation in `ensureCardsClickDelegation`**

Before open-card handler:

```js
const openEdit = e.target.closest && e.target.closest('[data-action="open-edit"]');
if (openEdit) {
  e.preventDefault();
  e.stopPropagation();
  const card = openEdit.closest('.card');
  const id = card && card.getAttribute('data-task-id');
  const t = id && h.taskById.get(id);
  if (t && typeof API.openEditWindow === 'function') API.openEditWindow(t.id);
  return;
}
```

- [ ] **Step 4: Detail view footer**

In `updateOpenDetail` view-mode actions, add button in `detail-footer-right` before/after 编辑:

```html
<button id="openEditWinBtn" type="button" title="独立窗口编辑" aria-label="独立窗口编辑">…</button>
<button id="editBtn" class="primary" type="button">编辑</button>
```

```js
document.getElementById('openEditWinBtn').addEventListener('click', () => {
  if (editing && API.openEditWindow) API.openEditWindow(editing.id);
});
```

- [ ] **Step 5: CSS** — icon size matches `card-action`; detail button as `icon-btn`.

- [ ] **Step 6: Manual checklist (spec §6)**

1. Card icon → edit window; card body → detail.  
2. Detail icon → edit window; 编辑 → in-place.  
3. Two tasks → two windows; same task → focus.  
4. Dirty close three-way.  
5. Save in edit window → main list updates (`tasks:changed`).  
6. Close edit window only → main stays.  
7. Create panel / clipboard / in-place edit regression.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/ui.js src/renderer/detail.js src/renderer/styles.css
git commit -m "feat: add open-edit icons on cards and detail"
```

---

### Task 7: Polish + spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-separate-edit-window-design.md` (status → 已实现)
- Touch-ups from manual test (title updates, focus, missing hide selectors)

- [ ] **Step 1: Fix any gaps found in Task 6 checklist**
- [ ] **Step 2: Update spec status line**
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-20-separate-edit-window-design.md src/renderer/styles.css
git commit -m "docs: mark separate edit window spec implemented"
```

---

## Out of scope (do not implement in this plan)

- Conflict UI when dirty + external change  
- `edit.html` split  
- Persisted window bounds  
- Delete / toggle status inside edit window  
- Prompting dirty edit windows when main quits  

---

## Execution note

Prefer **subagent-driven-development** per task with review between tasks. Run `node --test test/editWindowBoot.test.js` after Task 1; full app manual QA after Tasks 5–6.
