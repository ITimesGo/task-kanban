# Media Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click images/videos in create/edit, detail, and list cards to show a skin-styled in-app menu (copy, save as, open, show in folder, delete-in-editor).

**Architecture:** Pure helpers resolve `figure.doc-media` → payload; `mediaContextMenu.js` owns the floating menu DOM; main-process IPC handles clipboard write / save / open with path trust checks. Editor delete reuses `removeMediaFig`.

**Tech Stack:** Electron 31 (vanilla renderer), `clipboard.writeImage` + Windows `clipboard.writeBuffer('CF_HDROP', …)`, `node:test` for pure helpers.

**Spec:** `docs/superpowers/specs/2026-09-24-media-context-menu-design.md`

**Commits:** Only when the user explicitly asks; do not auto-commit during execution.

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `src/main/clipboardFiles.js` | Build CF_HDROP buffer + `writeFilesToClipboard(paths)` (Windows) |
| Create: `test/clipboardFiles.test.js` | CF_HDROP header / utf16 layout smoke tests |
| Create: `src/main/mediaActions.js` | Resolve trusted paths, copy/saveAs/open/showInFolder handlers |
| Create: `test/mediaActions.test.js` | Rel path sanitize, default save name, payload normalize (pure parts) |
| Modify: `src/main/main.js` | Register `media:copy` / `media:saveAs` / `media:open` / `media:showInFolder` |
| Modify: `src/preload.js` | Expose `copyMedia`, `saveMediaAs`, `openMedia`, `showMediaInFolder` |
| Modify: `src/renderer/api.js` | Whitelist those four APIs |
| Create: `src/renderer/mediaFig.js` | Pure: parse fig attrs → `{ kind, dataSrc, rel?, isDataUrl, isPending }` + menu item list |
| Create: `test/mediaFig.test.js` | Kind / menu items / disabled open* rules |
| Create: `src/renderer/mediaContextMenu.js` | Floating menu UI + `openMediaContextMenu({ fig, clientX, clientY, canDelete, resolveLocal, onDelete })` |
| Modify: `src/renderer/styles.css` | `.media-ctx-menu` + skin tweaks |
| Modify: `src/renderer/index.html` | Script tag for `mediaFig.js` + `mediaContextMenu.js` (before `richEditor.js` / `ui.js`) |
| Modify: `src/renderer/richEditor.js` | `contextmenu` on surface; expose pending lookup for `pending:N` |
| Modify: `src/renderer/ui.js` | Delegate contextmenu on detail + cards |

---

### Task 1: Pure media fig + menu item builder

**Files:**
- Create: `src/renderer/mediaFig.js`
- Create: `test/mediaFig.test.js`

- [x] **Step 1: Write failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMediaFig, buildMediaMenuItems } = require('../src/renderer/mediaFig');

test('kind from class / data-kind', () => {
  assert.equal(parseMediaFig({ className: 'doc-media doc-video', dataset: { src: 'videos/a.mp4', kind: 'video' } }).kind, 'video');
  assert.equal(parseMediaFig({ className: 'doc-media doc-image', dataset: { src: 'images/a.png' } }).kind, 'image');
});

test('dataSrc pending / data / rel', () => {
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'pending:2' } }).isPending, true);
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'data:image/png;base64,xx' } }).isDataUrl, true);
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'images/a.png' } }).rel, 'images/a.png');
});

test('menu: readonly no delete; open* disabled without local path', () => {
  const items = buildMediaMenuItems({ kind: 'image', hasLocalPath: false, hasDataUrl: true, canDelete: false });
  assert.equal(items.some((i) => i.id === 'delete'), false);
  const open = items.find((i) => i.id === 'open');
  assert.equal(open.disabled, true);
  assert.equal(open.title, '无本地文件');
  assert.equal(items.find((i) => i.id === 'copy').disabled, false);
});

test('menu: video without path disables copy + open*', () => {
  const items = buildMediaMenuItems({ kind: 'video', hasLocalPath: false, hasDataUrl: false, canDelete: true });
  assert.equal(items.find((i) => i.id === 'copy').disabled, true);
  assert.equal(items.find((i) => i.id === 'copy').title, '无本地文件');
  assert.equal(items.find((i) => i.id === 'open').disabled, true);
});

test('menu: editor with path enables open* and delete', () => {
  const items = buildMediaMenuItems({ kind: 'video', hasLocalPath: true, hasDataUrl: false, canDelete: true });
  assert.ok(items.find((i) => i.id === 'delete'));
  assert.equal(items.find((i) => i.id === 'showInFolder').disabled, false);
  assert.equal(items.find((i) => i.id === 'copy').disabled, false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/mediaFig.test.js`

- [ ] **Step 3: Implement `mediaFig.js`**

Export `parseMediaFig(elLike)` and `buildMediaMenuItems({ kind, hasLocalPath, hasDataUrl, canDelete })`.  
Labels: 复制 / 另存为… / 在外部打开 / 打开所在文件夹 / 删除.  
Ids: `copy` | `saveAs` | `open` | `showInFolder` | `delete`.  
**Copy enablement:** disable `copy` only when `kind === 'video' && !hasLocalPath` (`title`「无本地文件」). Image copy stays enabled with `hasDataUrl` or path. `saveAs` for image needs `hasDataUrl || hasLocalPath`; for video needs `hasLocalPath`.

Also export for Node: `module.exports = { parseMediaFig, buildMediaMenuItems }`; in browser attach to `window` if needed.

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/mediaFig.test.js`

---

### Task 2: Windows CF_HDROP helper

**Files:**
- Create: `src/main/clipboardFiles.js`
- Create: `test/clipboardFiles.test.js`

- [ ] **Step 1: Write failing tests** for buffer layout (header size 20, `fWide=1` at offset 16, utf16le path list ends with double-null).

- [ ] **Step 2: Implement**

```js
// createCFHDropBuffer(paths: string[]): Buffer
// writeFilesToClipboard(paths): { ok, error? }
// Uses clipboard.writeBuffer('CF_HDROP', buf) then Preferred DropEffect = COPY (1).
// If writeBuffer throws / unavailable: return { ok:false, error:'复制失败' }.
```

Pinned approach (Windows): **CF_HDROP via `clipboard.writeBuffer`**. No temp-file copy for video.

- [ ] **Step 3: Tests PASS** (`node --test test/clipboardFiles.test.js`)

---

### Task 3: Main media actions + IPC

**Files:**
- Create: `src/main/mediaActions.js` (pure path sanitize + default save name + orchestrators taking deps)
- Create: `test/mediaActions.test.js`
- Modify: `src/main/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/api.js`

**Payload shape (renderer → main):**
```js
{
  kind: 'image' | 'video',
  // exactly one of:
  rel?: string,        // under APP_DATA
  dataUrl?: string,    // image only
  srcPath?: string,    // absolute existing file (pending)
}
```

**Trust:**
- `sanitizeRel(rel, appData)` — strip leading `/`, reject `..`, absolute, must resolve under `appData`, `fs.existsSync`
- `srcPath` — must be in a **main-process session allowlist** of absolute paths, populated when the user picks/pastes/drops media that becomes pending `{srcPath}` (same code paths as `media:pick` / paste / drop). Reject any absolute path not on the allowlist even if it exists on disk.
- Reject `dataUrl` when `kind === 'video'` (image-only for data URLs)
- Reject anything else

Export `allowPendingSrcPath(absPath)` from mediaActions (or a tiny registry used by pick/paste handlers in `main.js`) so create/edit pending videos can open/copy.

**Handlers return** `{ ok: true }` | `{ ok: false, error, cancelled?: true }`  
`saveAs` cancelled dialog → `{ ok:false, cancelled:true }` (no alert).

- [ ] **Step 1: Unit-test sanitizeRel + defaultSaveName**

- [ ] **Step 2: Wire IPC in `main.js`** (need BrowserWindow for dialog parent):

When `media:pick` / image paste / drop resolves to a local path, call `allowPendingSrcPath(abs)` before returning to renderer.

```js
ipcHandle('media:copy', (_e, payload) => mediaActions.copyMedia(payload, { appData: APP_DATA }));
ipcHandle('media:saveAs', async (e, payload) => mediaActions.saveMediaAs(payload, { appData: APP_DATA, win: BrowserWindow.fromWebContents(e.sender) }));
ipcHandle('media:open', (_e, payload) => mediaActions.openMedia(payload, { appData: APP_DATA }));
ipcHandle('media:showInFolder', (_e, payload) => mediaActions.showMediaInFolder(payload, { appData: APP_DATA }));
```

Reject `kind==='video' && payload.dataUrl` in all handlers.
- [ ] **Step 3: Preload + api.js whitelist** the four methods.

- [ ] **Step 4: Manual smoke** (dev): copy a saved image rel via DevTools invoke if easy; else defer to Task 5 UI.

---

### Task 4: Floating menu UI + styles

**Files:**
- Create: `src/renderer/mediaContextMenu.js`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Implement `openMediaContextMenu(opts)`**

```js
opts = {
  fig, clientX, clientY,
  canDelete: boolean,
  resolveLocal: () => ({ rel?, dataUrl?, srcPath?, kind }), // sync
  onDelete?: (fig) => void,
}
```

Flow:
1. `parseMediaFig(fig)` + `resolveLocal()` → `hasLocalPath = !!(rel || srcPath)`
2. `buildMediaMenuItems(...)`
3. Mount single `#mediaCtxMenu` (reuse/recreate); position at mouse; clamp to viewport
4. Item click → call API; on `{ok:false, cancelled}` close only; on `{ok:false, error}` `alert(error)`; delete → `onDelete(fig)`
5. Listen once: `pointerdown` outside, `keydown` Esc, `scroll`/`blur` → close
6. `copy` for video without path: already disabled via menu builder (`kind==='video' && !hasLocalPath`)
7. `saveAs` for image without data/path: disable; video without path: disable

- [ ] **Step 2: CSS** `.media-ctx-menu` (surface, border, radius, shadow, item hover/disabled). Skin overrides for apple / mario / night / eyecare (match selection-bar / dropdown feel; no purple-glow cliché).

- [ ] **Step 3: Script tags** after `taskDoc.js`, before `richEditor.js` / `ui.js`:
  `mediaFig.js` then `mediaContextMenu.js`.

---

### Task 5: Wire rich editor

**Files:**
- Modify: `src/renderer/richEditor.js`

- [ ] **Step 1: Pending resolver**

Inside `createRichEditor`, add:
```js
function resolvePendingSrc(dataSrc) {
  // pending:N → pending[N].value (dataUrl string | {srcPath} | rel string)
  // return { kind, dataUrl?, rel?, srcPath? }
}
```

- [ ] **Step 2: contextmenu on `surface`**

```js
surface.addEventListener('contextmenu', (e) => {
  const fig = e.target.closest('figure.doc-media');
  if (!fig || !surface.contains(fig)) return;
  e.preventDefault();
  openMediaContextMenu({
    fig, clientX: e.clientX, clientY: e.clientY, canDelete: true,
    resolveLocal: () => resolveFromFig(fig),
    onDelete: (f) => removeMediaFig(f),
  });
});
```

`resolveFromFig`: if `data-src` is `pending:*` use pending table; if `data:` use dataUrl; else `rel`.

---

### Task 6: Wire detail + list cards

**Files:**
- Modify: `src/renderer/ui.js`

- [ ] **Step 1: Detail** — in `renderDetail`, after filling body, bind once on `detailBody` (or each render replace listener carefully):

```js
detailBody.oncontextmenu = (e) => {
  const fig = e.target.closest('.doc-view figure.doc-media');
  if (!fig) return;
  e.preventDefault();
  openMediaContextMenu({ fig, clientX: e.clientX, clientY: e.clientY, canDelete: false,
    resolveLocal: () => resolveSavedFig(fig) });
};
```

`resolveSavedFig`: `data-src` → if data: then dataUrl; else rel (saved paths only in detail).

- [ ] **Step 2: Cards** — in `renderCards` loop or once on `cardsEl`:

```js
cardsEl.addEventListener('contextmenu', (e) => {
  const fig = e.target.closest('.doc-preview figure.doc-media');
  if (!fig) return;
  e.preventDefault();
  e.stopPropagation();
  openMediaContextMenu({ ... canDelete: false, resolveLocal: () => resolveSavedFig(fig) });
});
```

Bind once outside the loop if possible (idempotent guard flag).

---

### Task 7: Manual acceptance checklist

Run app (`npm start` / `node start.js`), verify spec §验收 1–8:

1. Editor: full menu; delete works; save persists  
2. Detail/list: no delete; image copy pastes to Paint  
3. Saved video copy pastes into Explorer  
4. data: / no path: open* disabled + title 无本地文件  
5. Save as works; cancel silent  
6. Open / folder work; missing file alerts  
7. Non-media text keeps default context menu  
8. Skins: menu readable  

Also: `node --test test/mediaFig.test.js test/clipboardFiles.test.js test/mediaActions.test.js`

---

## Execution notes

- Do not change list/detail delete behavior.
- Do not intercept non-media `contextmenu`.
- Prefer small diffs; reuse existing alert patterns.
- If CF_HDROP fails on this Electron build, surface `复制失败` and document in PR note — do not fake success with path text.
