const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FileStore = require('../src/main/fileStore');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ml-')); }
const png = 'data:image/png;base64,' + Buffer.from([1, 2, 3, 4]).toString('base64');

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

test('moveMediaForTask moves flat image into single-tag folder', () => {
  const dir = tmp();
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  s.saveTags([{ id: tid, name: '工作' }]);
  fs.writeFileSync(path.join(dir, 'images', 'abc_0.png'), 'IMG');
  const moved = s.moveMediaForTask(
    { id: 'abc', tags: [tid], images: ['images/abc_0.png'], attachments: [] },
    s.loadTags()
  );
  assert.equal(moved.images[0], 'images/工作_aaaaaaaa/abc_0.png');
  assert.ok(fs.existsSync(path.join(dir, 'images', '工作_aaaaaaaa', 'abc_0.png')));
});

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
  const before = [{ id: tid, name: '工作' }];
  const after = [{ id: tid, name: '工作' }];
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
  task = { ...task, tags: [a] };
  const moved = s.moveMediaForTask(task, s.loadTags().filter((t) => t.id !== b));
  assert.equal(moved.images[0], 'images/甲_aaaaaaaa/abc_0.png');
});
