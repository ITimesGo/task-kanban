# Tag-Folder Media Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store images and attachments under tag-based subfolders (`公共/` or `{name}_{id8}/`), migrate existing flat files on startup, and auto-relocate media when tags change.

**Architecture:** Pure path helpers in `mediaLayout.js`; FileStore gains `safeMove` / `moveMediaForTask` / `migrateMediaLayout` and tag-aware `copy*`; main process hooks create/update/setTags/rename/delete and runs migration at startup; `cleanupOrphans` recursively scans subdirs.

**Tech Stack:** Electron main process, Node `fs`/`path`, `node:test` assertions.

**Spec:** `docs/specs/2026-08-24-tag-folder-media-design.md`

---

## File map

| File | Responsibility |
|---|---|
| Create: `src/main/mediaLayout.js` | `sanitizeTagName`, `subdirFor`, `relFor`, `allocConflictName`, `parseImageIndex`, `imageIndexTakenSet` |
| Modify: `src/main/fileStore.js` | Tag-aware copy paths; `safeMove`; `moveMediaForTask`; `migrateMediaLayout`; `renameTagFolders` |
| Modify: `src/main/main.js` | Pass `{ tags }` into ingest; fix index alloc; hooks + startup migrate |
| Modify: `src/main/cleanupOrphans.js` | Recursive orphan scan |
| Modify: `src/renderer/create.js` | Pass `tags` into `createTask` IPC payload |
| Test: `test/mediaLayout.test.js` | Pure helpers |
| Test: `test/mediaMigrate.test.js` | FileStore migrate / move / rename / delete-tag |
| Modify: `test/store.test.js` | Update `copyImage` expectation to `images/公共/...` |
| Modify: `test/trash.test.js` / others if they assume flat `images/` |

---

### Task 1: Pure path helpers (`mediaLayout.js`)

**Files:**
- Create: `src/main/mediaLayout.js`
- Create: `test/mediaLayout.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeTagName, subdirFor, relFor, allocConflictName, parseImageIndex, imageIndexTakenSet,
} = require('../src/main/mediaLayout');

test('sanitizeTagName strips illegal chars then collapses whitespace', () => {
  // '/' removed (not replaced), then spaces -> '_', then trim
  assert.equal(sanitizeTagName('  工 作/A  '), '工_作A');
  assert.equal(sanitizeTagName('a/b:c'), 'abc');
  assert.equal(sanitizeTagName(':::'), 'tag');
});

test('subdirFor: 0 / missing / multi -> 公共; single -> name_id8', () => {
  const tags = [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '工作' }];
  assert.equal(subdirFor([], tags), '公共');
  assert.equal(subdirFor(['nope'], tags), '公共');
  assert.equal(subdirFor(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'x'], tags), '公共');
  assert.equal(subdirFor(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], tags), '工作_aaaaaaaa');
});

test('relFor uses posix slashes', () => {
  assert.equal(relFor('images', '公共', 'a_0.png'), 'images/公共/a_0.png');
});

test('allocConflictName appends _n before ext', () => {
  const exists = (p) => p === 'dir/a.png' || p === 'dir/a_1.png';
  assert.equal(allocConflictName('dir', 'a.png', exists), 'a_2.png');
});

test('parseImageIndex handles conflict suffix', () => {
  assert.equal(parseImageIndex('abc_0.png', 'abc'), 0);
  assert.equal(parseImageIndex('abc_0_1.png', 'abc'), 0);
  assert.equal(parseImageIndex('images/公共/abc_2_3.jpg', 'abc'), 2);
  assert.equal(parseImageIndex('other_0.png', 'abc'), null);
});

test('imageIndexTakenSet from rel list', () => {
  const set = imageIndexTakenSet(['images/公共/abc_0.png', 'images/公共/abc_0_1.png', 'images/x/abc_2.png'], 'abc');
  assert.ok(set.has(0) && set.has(2) && !set.has(1));
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `node --test test/mediaLayout.test.js`  
Expected: fail cannot find module

- [ ] **Step 3: Implement `src/main/mediaLayout.js`**

```js
const path = require('path');

const PUBLIC = '公共';
const ILLEGAL = /[\\/:*?"<>|]/g;

function sanitizeTagName(name) {
  const s = String(name || '').replace(ILLEGAL, '').replace(/\s+/g, '_').trim();
  return s || 'tag';
}

function id8(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8);
}

function subdirFor(tagIds, tagList) {
  const ids = tagIds || [];
  if (ids.length !== 1) return PUBLIC;
  const tag = (tagList || []).find((t) => t.id === ids[0]);
  if (!tag) return PUBLIC;
  return `${sanitizeTagName(tag.name)}_${id8(tag.id)}`;
}

function relFor(kind, subdir, filename) {
  return `${kind}/${subdir}/${filename}`.replace(/\\/g, '/');
}

/** exists(absPath) -> boolean; returns filename that does not collide under dirAbs */
function allocConflictName(dirAbs, filename, exists) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let name = filename;
  let n = 1;
  while (exists(path.join(dirAbs, name))) {
    name = `${base}_${n}${ext}`;
    n++;
  }
  return name;
}

function parseImageIndex(relOrName, taskId) {
  const base = path.basename(relOrName || '');
  const re = new RegExp(`^${escapeRe(taskId)}_(\\d+)(?:_\\d+)?\\.[^.]+$`);
  const m = re.exec(base);
  return m ? Number(m[1]) : null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function imageIndexTakenSet(rels, taskId) {
  const set = new Set();
  for (const r of rels || []) {
    const i = parseImageIndex(r, taskId);
    if (i !== null) set.add(i);
  }
  return set;
}

module.exports = {
  PUBLIC, sanitizeTagName, subdirFor, relFor, allocConflictName, parseImageIndex, imageIndexTakenSet, id8,
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/mediaLayout.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/main/mediaLayout.js test/mediaLayout.test.js
git commit -m "feat: add mediaLayout path helpers for tag folders"
```

---

### Task 2: FileStore tag-aware write + safeMove + moveMediaForTask

**Files:**
- Modify: `src/main/fileStore.js`
- Create: `test/mediaMigrate.test.js` (first tests: copy under 公共 / single tag)
- Modify: `test/store.test.js` (update flat-path assertion)

- [ ] **Step 1: Write failing FileStore tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FileStore = require('../src/main/fileStore');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ml-')); }
const png = 'data:image/png;base64,' + Buffer.from([1,2,3,4]).toString('base64');

test('copyImage with no tags -> images/公共/', () => {
  const s = new FileStore(tmp());
  const rel = s.copyImage(png, 'abc', 0, { tags: [] });
  assert.equal(rel, 'images/公共/abc_0.png');
  assert.ok(fs.existsSync(path.join(s.appDataDir, rel)));
});

test('copyImage with one tag -> tag subdir', () => {
  const s = new FileStore(tmp());
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  s.saveTags([{ id: tid, name: '工作' }]);
  const rel = s.copyImage(png, 'abc', 0, { tags: [tid] });
  assert.equal(rel, 'images/工作_aaaaaaaa/abc_0.png');
});
```

- [ ] **Step 2: Run — expect FAIL (wrong path / arity)**

Run: `node --test test/mediaMigrate.test.js`

- [ ] **Step 3: Update FileStore write methods**

In `fileStore.js`:
- `require('./mediaLayout')`
- Change signatures: `copyImage(dataUrl, taskId, index, opts = {})`, same for `copyImageFromPath`, `ingestImage`, `copyAttachment`, `copyAttachmentAsync`
- Resolve `subdir = mediaLayout.subdirFor(opts.tags || [], this.loadTags())`, `mkdirSync` target, write to `relFor(...)`
- Default `opts.tags` to `[]` → `公共` (keeps callers safe)

Also update `test/store.test.js` expectation from `images/abc_0.png` to `images/公共/abc_0.png` and pass `{ tags: [] }` if needed.

- [ ] **Step 4: Implement `safeMove` + `moveMediaForTask`**

```js
// Pseudocode inside FileStore:
safeMove(absFrom, destDirAbs, preferredName) {
  fs.mkdirSync(destDirAbs, { recursive: true });
  const name = mediaLayout.allocConflictName(destDirAbs, preferredName, (p) => fs.existsSync(p));
  const absTo = path.join(destDirAbs, name);
  try { fs.renameSync(absFrom, absTo); }
  catch (_) { fs.copyFileSync(absFrom, absTo); fs.unlinkSync(absFrom); }
  return absTo;
}

moveMediaForTask(task, tagList) {
  const sub = mediaLayout.subdirFor(task.tags || [], tagList);
  const moveOne = (rel, kind) => {
    if (!rel || typeof rel !== 'string') return rel;
    const preferred = path.basename(rel);
    const targetRel = mediaLayout.relFor(kind, sub, preferred);
    if (rel.replace(/\\/g, '/') === targetRel && fs.existsSync(path.join(this.appDataDir, rel))) return targetRel;
    const from = path.join(this.appDataDir, rel);
    if (!fs.existsSync(from)) return rel; // keep broken ref
    try {
      const absTo = this.safeMove(from, path.join(this.appDataDir, kind, sub), preferred);
      return mediaLayout.relFor(kind, sub, path.basename(absTo));
    } catch (_) { return rel; }
  };
  const images = (task.images || []).map((r) => moveOne(r, 'images'));
  const attachments = (task.attachments || []).map((a) => {
    if (typeof a === 'string') return moveOne(a, 'attachments');
    if (!a || !a.rel) return a;
    const newRel = moveOne(a.rel, 'attachments');
    return { ...a, rel: newRel, name: path.basename(newRel) };
  });
  return { ...task, images, attachments };
}
```

Add test: task in flat `images/abc_0.png` with one tag → after `moveMediaForTask`, file under tag dir and rel updated.

- [ ] **Step 5: Run tests PASS**

Run: `node --test test/mediaMigrate.test.js test/store.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/main/fileStore.js test/mediaMigrate.test.js test/store.test.js
git commit -m "feat: FileStore writes and moves media into tag folders"
```

---

### Task 3: migrateMediaLayout + renameTagFolders + empty-dir cleanup

**Files:**
- Modify: `src/main/fileStore.js`
- Modify: `test/mediaMigrate.test.js`

- [ ] **Step 1: Tests for migrate / rename / conflict / delete-rehome**

```js
test('migrateMediaLayout moves flat refs; leaves unreferenced orphans', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'abc_0.png'), 'IMG');
  fs.writeFileSync(path.join(dir, 'images', 'orphan.png'), 'ORPH');
  s.saveTasks([{ id: 'abc', tags: [], images: ['images/abc_0.png'], attachments: [] }]);
  s.saveTags([]);
  s.migrateMediaLayout();
  assert.equal(s.loadTasks()[0].images[0], 'images/公共/abc_0.png');
  assert.ok(fs.existsSync(path.join(dir, 'images', '公共', 'abc_0.png')));
  assert.ok(fs.existsSync(path.join(dir, 'images', 'orphan.png')));
});

test('moveMediaForTask conflict appends _1', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  s.saveTags([{ id: tid, name: '工作' }]);
  fs.mkdirSync(path.join(dir, 'images', '工作_aaaaaaaa'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '工作_aaaaaaaa', 'abc_0.png'), 'KEEP');
  fs.mkdirSync(path.join(dir, 'images', '公共'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '公共', 'abc_0.png'), 'MOVE');
  const moved = s.moveMediaForTask(
    { id: 'abc', tags: [tid], images: ['images/公共/abc_0.png'], attachments: [] },
    s.loadTags()
  );
  assert.equal(moved.images[0], 'images/工作_aaaaaaaa/abc_0_1.png');
  assert.equal(fs.readFileSync(path.join(dir, 'images', '工作_aaaaaaaa', 'abc_0_1.png'), 'utf8'), 'MOVE');
});

test('renameTagFolders renames empty-dest dirs and rewrites rels', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const before = [{ id: tid, name: '旧名' }];
  const after = [{ id: tid, name: '新名' }];
  s.saveTags(before);
  fs.mkdirSync(path.join(dir, 'images', '旧名_aaaaaaaa'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '旧名_aaaaaaaa', 'abc_0.png'), 'IMG');
  s.saveTasks([{ id: 'abc', tags: [tid], images: ['images/旧名_aaaaaaaa/abc_0.png'], attachments: [] }]);
  s.renameTagFolders(tid, before, after);
  assert.ok(fs.existsSync(path.join(dir, 'images', '新名_aaaaaaaa', 'abc_0.png')));
  assert.equal(s.loadTasks()[0].images[0], 'images/新名_aaaaaaaa/abc_0.png');
});

test('renameTagFolders merges into existing newSub with conflict suffix', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const before = [{ id: tid, name: '旧名' }];
  const after = [{ id: tid, name: '新名' }];
  fs.mkdirSync(path.join(dir, 'images', '旧名_aaaaaaaa'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'images', '新名_aaaaaaaa'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '旧名_aaaaaaaa', 'abc_0.png'), 'FROM');
  fs.writeFileSync(path.join(dir, 'images', '新名_aaaaaaaa', 'abc_0.png'), 'DEST');
  s.saveTasks([{ id: 'abc', tags: [tid], images: ['images/旧名_aaaaaaaa/abc_0.png'], attachments: [] }]);
  s.renameTagFolders(tid, before, after);
  assert.equal(s.loadTasks()[0].images[0], 'images/新名_aaaaaaaa/abc_0_1.png');
  assert.equal(fs.readFileSync(path.join(dir, 'images', '新名_aaaaaaaa', 'abc_0.png'), 'utf8'), 'DEST');
});

test('renameTagFolders no-op when sanitize folder name unchanged', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  // names that sanitize to the same folder segment (if both become same) — use identical sanitize result
  const before = [{ id: tid, name: '工作' }];
  const after = [{ id: tid, name: '工作' }]; // same name
  fs.mkdirSync(path.join(dir, 'images', '工作_aaaaaaaa'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '工作_aaaaaaaa', 'abc_0.png'), 'IMG');
  const rel = 'images/工作_aaaaaaaa/abc_0.png';
  s.saveTasks([{ id: 'abc', tags: [tid], images: [rel], attachments: [] }]);
  s.renameTagFolders(tid, before, after);
  assert.equal(s.loadTasks()[0].images[0], rel);
});

test('delete-tag rehome: 2 tags -> 1 moves out of 公共 into remaining tag folder', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const a = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const b = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
  s.saveTags([{ id: a, name: '甲' }, { id: b, name: '乙' }]);
  fs.mkdirSync(path.join(dir, 'images', '公共'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '公共', 'abc_0.png'), 'IMG');
  let task = { id: 'abc', tags: [a, b], images: ['images/公共/abc_0.png'], attachments: [] };
  // after strip b: tags=[a] -> must move to 甲_aaaaaaaa
  task = { ...task, tags: [a] };
  const moved = s.moveMediaForTask(task, s.loadTags().filter((t) => t.id !== b));
  assert.equal(moved.images[0], 'images/甲_aaaaaaaa/abc_0.png');
});
```

- [ ] **Step 2: Implement `migrateMediaLayout`, `renameTagFolders`, `#rmEmptyDirs`**

`migrateMediaLayout()`:
```js
migrateMediaLayout() {
  const tagList = this.loadTags();
  let moved = 0;
  const errors = [];
  const mapList = (list) => list.map((t) => {
    const next = this.moveMediaForTask(t, tagList);
    // count changed rels roughly
    if (JSON.stringify(next.images) !== JSON.stringify(t.images)
      || JSON.stringify(next.attachments) !== JSON.stringify(t.attachments)) moved++;
    return next;
  });
  this.saveTasks(mapList(this.loadTasks()));
  this.saveTrash(mapList(this.loadTrash()));
  this.#rmEmptyDirs('images');
  this.#rmEmptyDirs('attachments');
  return { moved, errors };
}
```

`renameTagFolders(tagId, tagsBefore, tagsAfter)` — implement exactly:

1. `oldSub = subdirFor([tagId], tagsBefore)`, `newSub = subdirFor([tagId], tagsAfter)`
2. If `oldSub === newSub` return
3. For each `kind` in `['images','attachments']`:
   - `oldAbs = join(appData, kind, oldSub)`, `newAbs = join(appData, kind, newSub)`
   - If `!exists(oldAbs)` continue
   - If `!exists(newAbs)`: `renameSync(oldAbs, newAbs)`; record undo as rename-back
   - Else (merge): for each file in oldAbs, `safeMove` into newAbs; record each move for undo; `rmdir` oldAbs if empty
4. If any kind throws: undo recorded ops in reverse (rename-back or safeMove files back to oldSub), then rethrow **without** touching tasks/trash JSON
5. On full success: rewrite every task/trash `rel` (and attachment `name`) whose path starts with `images|attachments/${oldSub}/` to use `newSub` (and final basename if conflict-renamed); `saveTasks` + `saveTrash`

Maintain an `undos: Array<() => void>` stack while applying; on catch run undos then throw.

`#rmEmptyDirs(kind)`: `readdir` subdirs under kind, `rmdir` if empty.

Also expose for IPC (Task 4):
```js
rmEmptyMediaDirs() {
  this.#rmEmptyDirs('images');
  this.#rmEmptyDirs('attachments');
}
```

- [ ] **Step 3: Run PASS + commit**

```bash
git add src/main/fileStore.js test/mediaMigrate.test.js
git commit -m "feat: migrate and rename tag media folders"
```

---

### Task 4: Wire main.js IPC + startup migration

**Files:**
- Modify: `src/main/main.js`
- Modify: `src/renderer/create.js` (pass tags on create)

- [ ] **Step 1: create IPC accepts tags**

In `tasks:create` handler, accept `{ text, images, attachments, tags }`:
- `createTask(...)` then set `tags: tags || []` on task before/after ingest
- Pass `{ tags: tags || [] }` into every `ingestImage` / `copyAttachmentAsync`
- If tags provided, skip need for immediate move (still OK if setTags called later)

Update `create.js`:
```js
const res = await API.createTask({
  text: $('#newText').value, images: imgs, attachments: atts, tags: newTags.slice(),
});
// keep setTaskTags as safety net OR remove duplicate if create already saved tags
if (newTags.length) await API.setTaskTags(res.task.id, newTags);
```

- [ ] **Step 2: update / setTags / rename / delete hooks**

- `tasks:update`: resolve tags from `old.tags`; pass to ingest/copy; after save, `moveMediaForTask` if tags unchanged still fine (no-op). Index alloc:

```js
const taken = mediaLayout.imageIndexTakenSet(existingRels, id);
let nextIdx = 0;
const alloc = () => { while (taken.has(nextIdx)) nextIdx++; taken.add(nextIdx); return nextIdx; };
```

- `tasks:setTags`: save tags → `moveMediaForTask` → save if rels changed
- `tags:rename`: renameTag on list → `fsStore.renameTagFolders(id, before, after)` → saveTags
- `tags:delete`: remember which task/trash items contained the deleted tag → strip → save tags/tasks/trash → `moveMediaForTask` on **every** item that contained the id (not “only if tag count changed”) → save → call public `fsStore.rmEmptyMediaDirs()` (wraps `#rmEmptyDirs` for both kinds; do **not** call private `#rmEmptyDirs` from main.js)
- After `backup:import` success and after `storage:set` path change (when `fsStore` is recreated): call `migrateMediaLayout()` so same-session imports flatten→tag without restart

- [ ] **Step 3: Startup**

Where `fsStore = new FileStore(APP_DATA)` is constructed, call `fsStore.migrateMediaLayout()`.

- [ ] **Step 4: Manual smoke** (optional in agent): `npm test`

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js src/renderer/create.js
git commit -m "feat: wire tag-folder media migrate into IPC and startup"
```

---

### Task 5: Recursive cleanupOrphans

**Files:**
- Modify: `src/main/cleanupOrphans.js`
- Create or extend: `test/cleanupOrphans.test.js` (if none exists; else add cases)

- [ ] **Step 1: Failing test — orphan inside `images/公共/` is found**

```js
test('cleanupOrphans deletes unreferenced file in subdir', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'images', '公共'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '公共', 'orphan.png'), 'x');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '[]');
  fs.writeFileSync(path.join(dir, 'trash.json'), '[]');
  const res = cleanupOrphans(dir);
  assert.ok(res.orphans.includes('images/公共/orphan.png'));
});
```

- [ ] **Step 2: Implement recursive walk**

Replace `cleanDir` with recursive function that builds POSIX `rel` from `subdir` root; after deletes, optionally remove empty directories.

- [ ] **Step 3: PASS + commit**

```bash
git add src/main/cleanupOrphans.js test/cleanupOrphans.test.js
git commit -m "fix: cleanupOrphans recursively scans tag media folders"
```

---

### Task 6: Full regression + fix test fixtures

**Files:**
- Modify any tests that assume flat `images/a_0.png` without subdir:
  - `test/store.test.js` (`images/abc_0.png`)
  - `test/trash.test.js` (`images/a_0.png`)
  - `test/images.test.js` if it asserts flat write paths
  - any other fixture writing under `images/` root without `公共/` or tag subdir

- [ ] **Step 1: Run full suite**

Run: `npm test`  
Expected: all PASS. Fix remaining flat-path assumptions (update expected `rel` or write files under the new layout).

- [ ] **Step 2: Commit fixes if any**

```bash
git add -A
git commit -m "test: align fixtures with tag-folder media layout"
```

---

## Out of scope (per spec §9)

- Multi-copy for multi-tag tasks
- Symlinks / separate media index DB
- Changing tag data model
