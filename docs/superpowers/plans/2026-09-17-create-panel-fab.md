# Create Panel FAB + Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the create panel dock on the right or collapse to a skin-styled FAB, with pin/collapse controls and a matching view-defaults setting.

**Architecture:** Persist `createPanelMode` (`docked` | `collapsed`) in existing `kanban-view-defaults`. A small `createPanelMode.js` owns runtime `mode` + `createPanelOpen`, toggles `#createPanel` / `#layoutSplit` / FAB visibility, and saves preferences. Pure transition helpers are unit-tested; DOM wiring follows existing renderer script patterns.

**Tech Stack:** Electron renderer (vanilla JS/CSS/HTML), `node:test` for pure helpers, `localStorage` via `viewDefaults.js`.

**Spec:** `docs/superpowers/specs/2026-09-17-create-panel-fab-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `src/renderer/createPanelMode.js` | Runtime mode/open, FAB + pin/collapse handlers, `applyCreatePanelMode`, DOM sync |
| Create: `test/createPanelMode.test.js` | Pure visibility + action transition tests |
| Modify: `src/renderer/viewDefaults.js` | Add `createPanelMode` to factory/normalize/clone/apply; Node export for tests |
| Create: `test/viewDefaults.test.js` | Normalize / default for `createPanelMode` |
| Modify: `src/renderer/index.html` | FAB node, create-panel chrome (pin/collapse), settings control, script tag |
| Modify: `src/renderer/styles.css` | FAB, chrome buttons, `#layout.is-create-collapsed`, skin tweaks |
| Modify: `src/renderer/settings.js` | Defaults form read/write/render for `createPanelMode` |
| Modify: `src/renderer/layoutSplit.js` | Skip drag/resize apply when panel hidden; optional `setCreatePanelVisible` hook |
| Touch only if needed: `src/renderer/create.js` | Confirm create-success does **not** collapse (no behavior change expected) |
| Docs: update spec status line after ship (optional) | — |

**Script order:** load `createPanelMode.js` after `viewDefaults.js` and `layoutSplit.js`, before `settings.js` / `app.js`.

---

### Task 1: Persist `createPanelMode` in view defaults

**Files:**
- Modify: `src/renderer/viewDefaults.js`
- Create: `test/viewDefaults.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEW_FACTORY_DEFAULTS,
  normalizeViewDefaults,
  cloneViewDefaults,
} = require('../src/renderer/viewDefaults');

test('出厂默认 createPanelMode 为 docked', () => {
  assert.equal(VIEW_FACTORY_DEFAULTS.createPanelMode, 'docked');
});

test('normalize 接受 docked/collapsed，其它回退 docked', () => {
  assert.equal(normalizeViewDefaults({ createPanelMode: 'collapsed' }).createPanelMode, 'collapsed');
  assert.equal(normalizeViewDefaults({ createPanelMode: 'docked' }).createPanelMode, 'docked');
  assert.equal(normalizeViewDefaults({ createPanelMode: 'nope' }).createPanelMode, 'docked');
  assert.equal(normalizeViewDefaults({}).createPanelMode, 'docked');
});

test('clone 保留 createPanelMode', () => {
  const c = cloneViewDefaults({
    filter: 'all', sortKey: 'createdAt', range: 'all', pageSize: 50,
    filtersExpanded: false, createPanelMode: 'collapsed',
  });
  assert.equal(c.createPanelMode, 'collapsed');
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test test/viewDefaults.test.js`  
Expected: FAIL (missing export / missing field)

- [ ] **Step 3: Implement in `viewDefaults.js`**

1. Add `createPanelMode: 'docked'` to `VIEW_FACTORY_DEFAULTS`.
2. In `cloneViewDefaults`, copy `createPanelMode: src.createPanelMode === 'collapsed' ? 'collapsed' : 'docked'`.
3. In `normalizeViewDefaults`, if `raw.createPanelMode === 'collapsed'` set collapsed, else keep/default docked.
4. In `applyViewDefaultsToSession`:
   - Read previous mode if exposed (`typeof getCreatePanelMode === 'function' ? getCreatePanelMode() : null`) or compare `p.createPanelMode` with a module-level last-applied flag.
   - Call `applyCreatePanelMode(p.createPanelMode, { reason: opts.coldStart ? 'cold' : (modeChanged ? 'mode-change' : 'same-mode') })` when that function exists.
   - Prefer: `applyViewDefaultsToSession(prefs, { refreshList, coldStart })` — `app.js` passes `{ coldStart: true }` on first call; settings「立即应用」omits it.
5. Guard the apply call until Task 4 defines the function:

```js
if (typeof applyCreatePanelMode === 'function') {
  // reason: cold | mode-change | same-mode (see Task 4)
  applyCreatePanelMode(p.createPanelMode, { reason });
}
```

6. Bottom of file (Node dual export):

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEW_FACTORY_DEFAULTS,
    VIEW_FILTER_OPTS,
    VIEW_SORT_OPTS,
    VIEW_RANGE_OPTS,
    VIEW_PAGE_SIZE_OPTS,
    cloneViewDefaults,
    normalizeViewDefaults,
    loadViewDefaults,
    saveViewDefaults,
    resetViewDefaults,
    applyViewDefaultsToSession,
    applySavedViewDefaults,
  };
}
```

Note: `loadViewDefaults` uses `localStorage` — tests only call normalize/clone/factory (no localStorage).

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/viewDefaults.test.js`  
Expected: PASS

- [ ] **Step 5: Update `app.js` cold start**

```js
if (typeof applySavedViewDefaults === 'function') {
  applySavedViewDefaults({ refreshList: false, coldStart: true });
}
```

Thread `coldStart` through `applySavedViewDefaults` → `applyViewDefaultsToSession`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/viewDefaults.js src/renderer/app.js test/viewDefaults.test.js
git commit -m "feat: persist createPanelMode in view defaults"
```

---

### Task 2: Pure mode transitions (unit-tested)

**Files:**
- Create: `src/renderer/createPanelMode.js` (logic section + exports; DOM later)
- Create: `test/createPanelMode.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  panelVisibility,
  reduceCreatePanelAction,
  initialOpenForMode,
} = require('../src/renderer/createPanelMode');

test('visibility: docked always panel, never fab', () => {
  assert.deepEqual(panelVisibility('docked', false), { showPanel: true, showFab: false });
  assert.deepEqual(panelVisibility('docked', true), { showPanel: true, showFab: false });
});

test('visibility: collapsed depends on open', () => {
  assert.deepEqual(panelVisibility('collapsed', false), { showPanel: false, showFab: true });
  assert.deepEqual(panelVisibility('collapsed', true), { showPanel: true, showFab: false });
});

test('openFab / collapse / pin / unpin', () => {
  let s = { mode: 'collapsed', open: false };
  s = reduceCreatePanelAction(s, 'openFab');
  assert.deepEqual(s, { mode: 'collapsed', open: true });
  s = reduceCreatePanelAction(s, 'pin');
  assert.deepEqual(s, { mode: 'docked', open: true });
  s = reduceCreatePanelAction(s, 'unpin');
  assert.deepEqual(s, { mode: 'collapsed', open: true });
  s = reduceCreatePanelAction(s, 'collapse');
  assert.deepEqual(s, { mode: 'collapsed', open: false });
});

test('applyMode reasons', () => {
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: true }, 'applyMode', { mode: 'collapsed', reason: 'same-mode' }),
    { mode: 'collapsed', open: true }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: true }, 'applyMode', { mode: 'collapsed', reason: 'cold' }),
    { mode: 'collapsed', open: false }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'docked', open: true }, 'applyMode', { mode: 'collapsed', reason: 'mode-change' }),
    { mode: 'collapsed', open: false }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: false }, 'applyMode', { mode: 'docked', reason: 'mode-change' }),
    { mode: 'docked', open: true }
  );
});

test('initialOpenForMode', () => {
  assert.equal(initialOpenForMode('docked'), true);
  assert.equal(initialOpenForMode('collapsed'), false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/createPanelMode.test.js`  
Expected: FAIL cannot find module / exports

- [ ] **Step 3: Implement pure helpers at top of `createPanelMode.js`**

(DOM wiring comes in Task 4; this task only ships pure helpers + Node exports.)

```js
function normalizeMode(m) {
  return m === 'collapsed' ? 'collapsed' : 'docked';
}

function initialOpenForMode(mode) {
  return normalizeMode(mode) === 'docked';
}

function panelVisibility(mode, open) {
  const m = normalizeMode(mode);
  const showPanel = m === 'docked' || !!open;
  const showFab = m === 'collapsed' && !open;
  return { showPanel, showFab };
}

function reduceCreatePanelAction(state, action, payload) {
  const mode = normalizeMode(state.mode);
  const open = !!state.open;
  switch (action) {
    case 'openFab':
      return { mode: 'collapsed', open: true };
    case 'collapse':
      return { mode: 'collapsed', open: false };
    case 'pin':
      return { mode: 'docked', open: true };
    case 'unpin':
      return { mode: 'collapsed', open: true };
    case 'applyMode': {
      const next = normalizeMode(payload && payload.mode);
      const reason = (payload && payload.reason) || 'mode-change';
      if (reason === 'same-mode' && next === mode) return { mode, open };
      if (reason === 'cold' || reason === 'mode-change' || next !== mode) {
        return { mode: next, open: initialOpenForMode(next) };
      }
      return { mode: next, open };
    }
    default:
      return { mode, open };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeMode,
    initialOpenForMode,
    panelVisibility,
    reduceCreatePanelAction,
    // DOM API filled in Task 3
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/createPanelMode.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/createPanelMode.js test/createPanelMode.test.js
git commit -m "feat: add create panel mode state helpers"
```

---

### Task 3: HTML chrome + FAB + script tag

**Files:**
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Inside `#createPanel`, prepend a chrome row** (before `#createEditor`):

```html
<div class="create-chrome" role="toolbar" aria-label="新建区布局">
  <button type="button" id="createPinBtn" class="create-chrome-btn" aria-pressed="true" title="固定在右侧" aria-label="固定在右侧">
    <!-- pin SVG: outline + filled via CSS .is-pinned -->
  </button>
  <button type="button" id="createCollapseBtn" class="create-chrome-btn" title="收起新建区" aria-label="收起新建区">
    <!-- panel-collapse / chevron-down SVG -->
  </button>
</div>
```

Use simple inline SVGs consistent with other icon buttons in the app (stroke `currentColor`).

- [ ] **Step 2: After `</main>` (or as last child of `#layout` sibling), add FAB**

Prefer as sibling under `body` near overlays so `position: fixed` is stable:

```html
<button type="button" id="createFab" class="create-fab hidden" title="新建任务" aria-label="新建任务" hidden>
  <span class="create-fab-plus" aria-hidden="true">+</span>
</button>
```

- [ ] **Step 3: Settings — in `#panel-defaults` `.defaults-grid`, after filters-expanded field**

```html
<div class="defaults-field">
  <div class="export-label">新建区</div>
  <div class="defaults-select-wrap" id="defCreatePanelWrap">
    <div id="defCreatePanelSelect" class="range-select defaults-trigger" tabindex="0">
      <span id="defCreatePanelSelected" class="range-value">固定在右侧</span>
      <span class="ms-arrow">▾</span>
    </div>
    <div id="defCreatePanelDropdown" class="range-dropdown hidden"></div>
  </div>
</div>
```

- [ ] **Step 4: Script tag** immediately after `layoutSplit.js` and before `clipboardQuick.js`:

```html
<script src="layoutSplit.js"></script>
<script src="createPanelMode.js"></script>
<script src="clipboardQuick.js"></script>
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: add create panel pin/collapse chrome and FAB markup"
```

---

### Task 4: DOM wiring in `createPanelMode.js`

**Files:**
- Modify: `src/renderer/createPanelMode.js`
- Modify: `src/renderer/layoutSplit.js` (minimal)
- Modify: `src/renderer/viewDefaults.js` (wire apply call if not done)

- [ ] **Step 1: Expose layout visibility helper from `layoutSplit.js`**

Replace pure IIFE with functions on a small global, or set:

```js
window.__layoutSplit = {
  reapplyWidth() { apply(panel.getBoundingClientRect().width || load()); },
  setInteractive(on) {
    split.hidden = !on;
    split.classList.toggle('hidden', !on);
    split.style.pointerEvents = on ? '' : 'none';
    split.tabIndex = on ? 0 : -1;
  },
};
```

On `mousedown` / `keydown` of split: if `split.hidden` return early.

- [ ] **Step 2: Implement DOM sync in `createPanelMode.js`**

State: `let mode = 'docked'; let open = true;`

```js
function syncCreatePanelDom() {
  const { showPanel, showFab } = panelVisibility(mode, open);
  const layout = document.getElementById('layout');
  const panel = document.getElementById('createPanel');
  const fab = document.getElementById('createFab');
  const pinBtn = document.getElementById('createPinBtn');
  if (layout) layout.classList.toggle('is-create-collapsed', !showPanel);
  if (panel) {
    panel.hidden = !showPanel;
    panel.classList.toggle('hidden', !showPanel);
    panel.setAttribute('aria-hidden', showPanel ? 'false' : 'true');
  }
  if (window.__layoutSplit) window.__layoutSplit.setInteractive(showPanel);
  if (showPanel && window.__layoutSplit) window.__layoutSplit.reapplyWidth();
  if (fab) {
    fab.hidden = !showFab;
    fab.classList.toggle('hidden', !showFab);
  }
  if (pinBtn) {
    const pinned = mode === 'docked';
    pinBtn.classList.toggle('is-pinned', pinned);
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pinBtn.title = pinned ? '取消固定' : '固定在右侧';
    pinBtn.setAttribute('aria-label', pinBtn.title);
  }
}

function persistMode(nextMode) {
  if (typeof loadViewDefaults !== 'function' || typeof saveViewDefaults !== 'function') return;
  const cur = loadViewDefaults();
  if (cur.createPanelMode === nextMode) return;
  saveViewDefaults({ ...cur, createPanelMode: nextMode });
  if (typeof fillViewDefaultsForm === 'function') {
    try { fillViewDefaultsForm(); } catch (_) {}
  }
}

function commitState(next, { persist } = {}) {
  mode = next.mode;
  open = next.open;
  if (persist) persistMode(mode);
  syncCreatePanelDom();
}

function applyCreatePanelMode(nextMode, { reason = 'mode-change' } = {}) {
  commitState(reduceCreatePanelAction({ mode, open }, 'applyMode', { mode: nextMode, reason }), { persist: false });
}

function getCreatePanelMode() { return mode; }

function bindCreatePanelModeUi() {
  const fab = document.getElementById('createFab');
  const pinBtn = document.getElementById('createPinBtn');
  const collapseBtn = document.getElementById('createCollapseBtn');
  if (fab) fab.addEventListener('click', () => {
    commitState(reduceCreatePanelAction({ mode, open }, 'openFab'), { persist: false });
    // focus editor if API exists
    const ed = document.querySelector('#createEditor .rich-surface, #createEditor [contenteditable]');
    if (ed && typeof ed.focus === 'function') ed.focus();
  });
  if (collapseBtn) collapseBtn.addEventListener('click', () => {
    commitState(reduceCreatePanelAction({ mode, open }, 'collapse'), { persist: true });
  });
  if (pinBtn) pinBtn.addEventListener('click', () => {
    const action = mode === 'docked' ? 'unpin' : 'pin';
    commitState(reduceCreatePanelAction({ mode, open }, action), { persist: true });
  });
}

if (typeof document !== 'undefined') {
  const boot = () => {
    bindCreatePanelModeUi();
    // 先同步当前内存态；冷启动偏好由 app.js applySavedViewDefaults({ coldStart:true }) 覆盖
    syncCreatePanelDom();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
```

Export `applyCreatePanelMode`, `getCreatePanelMode` on `module.exports` and as globals for browser (assign `window.applyCreatePanelMode = applyCreatePanelMode` only if needed — other files use bare functions from script order, so top-level `function applyCreatePanelMode` is enough).

- [ ] **Step 3: Ensure `applyViewDefaultsToSession` calls apply with correct reason**

```js
const prev = typeof getCreatePanelMode === 'function' ? getCreatePanelMode() : null;
const nextMode = p.createPanelMode;
let reason = 'mode-change';
if (opts && opts.coldStart) reason = 'cold';
else if (prev === nextMode) reason = 'same-mode';
if (typeof applyCreatePanelMode === 'function') {
  applyCreatePanelMode(nextMode, { reason });
}
```

- [ ] **Step 4: Manual smoke in app** (`npm start`): docked default, collapse → FAB, FAB opens panel, pin persists across reload.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/createPanelMode.js src/renderer/layoutSplit.js src/renderer/viewDefaults.js
git commit -m "feat: wire create panel mode DOM and layout split"
```

---

### Task 5: CSS + skins

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Base layout when collapsed**

```css
#layout.is-create-collapsed #createPanel,
#layout.is-create-collapsed #layoutSplit {
  display: none !important;
}
#createPanel[hidden],
#layoutSplit[hidden] {
  display: none !important;
}
```

- [ ] **Step 2: Chrome toolbar**

```css
.create-chrome {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin: 0 0 8px;
}
.create-chrome-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.create-chrome-btn:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
}
.create-chrome-btn.is-pinned {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
```

- [ ] **Step 3: FAB**

```css
.create-fab {
  position: fixed;
  right: 20px;
  bottom: calc(52px + 16px); /* clear pagination */
  z-index: 35;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  color: var(--on-primary, #fff);
  box-shadow: var(--shadow-md, 0 4px 14px rgba(0,0,0,.18));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  line-height: 1;
  padding: 0;
}
.create-fab.hidden,
.create-fab[hidden] {
  display: none !important;
}
.create-fab:hover {
  filter: brightness(1.06);
}
.create-fab:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .create-fab { transition: none; }
}
```

- [ ] **Step 4: Skin tweaks (minimal)**

- apple: FAB larger radius already circle; soft shadow.
- night: ensure contrast on `--primary`.
- mario: `border-radius: 0` or small pixel border using `--mario-brown` / `--pixel` (still ~48px hit target).
- eyecare: use existing primary tokens only.

Do **not** invent a new purple palette.

- [ ] **Step 5: Visual check all four skins; commit**

```bash
git add src/renderer/styles.css
git commit -m "style: create panel FAB and chrome for skins"
```

---

### Task 6: Settings defaults UI

**Files:**
- Modify: `src/renderer/settings.js`
- Modify: `src/renderer/viewDefaults.js` (opts constant if needed)

- [ ] **Step 1: Add opts in `viewDefaults.js`**

```js
const VIEW_CREATE_PANEL_OPTS = [
  { key: 'docked', label: '固定在右侧' },
  { key: 'collapsed', label: '收起为加号' },
];
```

Export in module.exports / keep global for settings.

- [ ] **Step 2: Extend `VIEW_DEFAULTS_FIELDS`**

```js
{ key: 'createPanelMode', optsName: 'VIEW_CREATE_PANEL_OPTS', wrap: 'defCreatePanelWrap', select: 'defCreatePanelSelect', selected: 'defCreatePanelSelected', dropdown: 'defCreatePanelDropdown' },
```

In `viewDefaultsOpts`:

```js
if (field.optsName === 'VIEW_CREATE_PANEL_OPTS') return VIEW_CREATE_PANEL_OPTS || [];
```

- [ ] **Step 3: `readViewDefaultsForm` include `createPanelMode: draft.createPanelMode`**

- [ ] **Step 4: Verify auto-save on dropdown change does not call `applyViewDefaultsToSession`** (existing pattern). Only「立即应用」applies. Manual: collapsed+open, change page size only + 立即应用 → panel stays open.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings.js src/renderer/viewDefaults.js
git commit -m "feat: settings default for create panel mode"
```

---

### Task 7: Regression checklist + final commit

- [ ] **Step 1: Run all unit tests**

Run: `npm test`  
Expected: all PASS (including new files)

- [ ] **Step 2: Manual checklist (from spec §7)**

1. Default docked: right panel, no FAB; collapse → FAB; restart stays collapsed.  
2. FAB → dual pane; create task success keeps panel; collapse keeps draft.  
3. Pin → restart docked.  
4. Unpin keeps open; collapse → FAB.  
5. Settings change + 立即应用 / 恢复默认.  
6. same-mode apply keeps temporary open.  
7. Width restore after hide/show.  
8. Skins look OK.

- [ ] **Step 3: Confirm `create.js` create-success path does not call collapse**

- [ ] **Step 4: Final commit if any fixups; update spec status to「已实现」optional

```bash
git add -A
git commit -m "chore: finish create panel FAB + pin"
```

---

## Execution notes

- Do not destroy rich editor / tags / attachments on collapse (only `hidden`).
- Do not auto-collapse after create.
- Prefer `hidden` + CSS over tearing down TipTap.
- If first-paint flash of docked panel when preference is collapsed: call `applyCreatePanelMode` as early as `app.js` cold start (already planned); optional tiny inline script is YAGNI unless flash is visible.
