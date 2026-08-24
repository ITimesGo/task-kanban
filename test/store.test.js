const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTask, sortByCreatedAtDesc, toggleStatus, updateTask, removeTask,
} = require('../src/main/store');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store2 = require('../src/main/store');
const FileStore = require('../src/main/fileStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
}

test('createTask 空文字且无图时报错并带 EMPTY_TASK 码', () => {
  assert.throws(() => createTask(), (e) => e.code === 'EMPTY_TASK');
  assert.throws(() => createTask({ text: '   ' }), (e) => e.code === 'EMPTY_TASK');
});

test('createTask 生成 id/status/时间并裁剪超过10张的图', () => {
  const imgs = Array.from({ length: 12 }, (_, i) => `i${i}`);
  const t = createTask({ text: 'hello', images: imgs });
  assert.ok(t.id);
  assert.equal(t.status, 'pending');
  assert.equal(t.images.length, 10);
  assert.equal(t.createdAt, t.updatedAt);
  assert.equal(t.statusAt, null);
  assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}/);
});

test('sortByCreatedAtDesc 按创建时间倒序', () => {
  const a = createTask({ text: 'old' });
  a.createdAt = '2020-01-01T00:00:00.000Z';
  const b = createTask({ text: 'new' });
  b.createdAt = '2024-01-01T00:00:00.000Z';
  assert.deepEqual(sortByCreatedAtDesc([a, b]).map(t => t.text), ['new', 'old']);
});

test('toggleStatus 只更新 statusAt，不改 updatedAt', () => {
  const t = createTask({ text: 'x' });
  const created = t.createdAt;
  const updated = t.updatedAt;
  const list = toggleStatus([t], t.id);
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].createdAt, created);
  assert.equal(list[0].updatedAt, updated);
  assert.ok(list[0].statusAt);
  assert.match(list[0].statusAt, /^\d{4}-/);
});

test('updateTask 只更新 updatedAt，不改 statusAt', () => {
  const t = createTask({ text: 'x', images: ['i1'] });
  t.statusAt = '2024-01-01T00:00:00.000Z';
  t.updatedAt = '2024-01-01T00:00:00.000Z';
  const statusAt = t.statusAt;
  const list = updateTask([t], t.id, { text: 'y' });
  assert.equal(list[0].text, 'y');
  assert.equal(list[0].statusAt, statusAt);
  assert.notEqual(list[0].updatedAt, '2024-01-01T00:00:00.000Z');
});

test('updateTask 修改文字并在超限时裁剪图片', () => {
  const t = createTask({ text: 'x', images: ['i1'] });
  const imgs = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const list = updateTask([t], t.id, { text: 'y', images: imgs });
  assert.equal(list[0].text, 'y');
  assert.equal(list[0].images.length, 10);
});

test('sortByTimeDesc 按 statusAt 倒序，缺失沉底', () => {
  const { sortByTimeDesc } = require('../src/main/store');
  const a = createTask({ text: 'no-status' });
  const b = createTask({ text: 'old-status' });
  b.statusAt = '2023-01-01T00:00:00.000Z';
  const c = createTask({ text: 'new-status' });
  c.statusAt = '2025-01-01T00:00:00.000Z';
  assert.deepEqual(sortByTimeDesc([a, b, c], 'statusAt').map((t) => t.text), [
    'new-status', 'old-status', 'no-status',
  ]);
});

test('removeTask 仅移除匹配 id', () => {
  const a = createTask({ text: 'a' });
  const b = createTask({ text: 'b' });
  assert.equal(removeTask([a, b], a.id).length, 1);
});

test('createTask 缺失引用不抛错', () => {
  const t = createTask({ images: ['i1'] });
  assert.equal(t.text, '');
});

test('FileStore 空目录 loadTasks 返回 []', () => {
  const fs2 = new FileStore(tmpDir());
  assert.deepEqual(fs2.loadTasks(), []);
});

test('FileStore 保存后能读回，原子写无 .tmp 残留', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const t = store2.createTask({ text: 'hi' });
  fs2.saveTasks([t]);
  assert.equal(fs2.loadTasks()[0].text, 'hi');
  assert.ok(!fs.existsSync(path.join(dir, 'tasks.json.tmp')));
});

test('FileStore 损坏 JSON 备份并以空启动', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  fs.writeFileSync(path.join(dir, 'tasks.json'), 'not json{');
  assert.deepEqual(fs2.loadTasks(), []);
  assert.ok(fs.existsSync(path.join(dir, 'tasks.json.bak')));
});

test('FileStore copyImage/readImageDataUrl/deleteImages 往返', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const png = 'data:image/png;base64,' + Buffer.from([1,2,3,4]).toString('base64');
  const rel = fs2.copyImage(png, 'abc', 0, { tags: [] });
  assert.equal(rel, 'images/公共/abc_0.png');
  assert.ok(fs2.readImageDataUrl(rel).startsWith('data:image/png'));
  fs2.deleteImages([rel]);
  assert.equal(fs2.readImageDataUrl(rel), null);
});

test('FileStore loadTasks 命中内存缓存：删盘后仍能读到已加载数据', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const t = store2.createTask({ text: 'cached' });
  fs2.saveTasks([t]);
  assert.equal(fs2.loadTasks()[0].text, 'cached');
  fs.unlinkSync(path.join(dir, 'tasks.json'));
  assert.equal(fs2.loadTasks()[0].text, 'cached');
});

test('FileStore loadTags 命中内存缓存：删盘后仍能读到已加载数据', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  fs2.saveTags([{ id: 't1', name: '工作' }]);
  assert.equal(fs2.loadTags()[0].name, '工作');
  fs.unlinkSync(path.join(dir, 'tags.json'));
  assert.equal(fs2.loadTags()[0].name, '工作');
});

test('FileStore saveTasks 后缓存与磁盘一致，且不再依赖旧缓存对象引用', () => {
  const dir = tmpDir();
  const fs2 = new FileStore(dir);
  const a = store2.createTask({ text: 'a' });
  fs2.saveTasks([a]);
  const b = store2.createTask({ text: 'b' });
  fs2.saveTasks([b]);
  assert.equal(fs2.loadTasks().length, 1);
  assert.equal(fs2.loadTasks()[0].text, 'b');
  const fromDisk = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  assert.equal(fromDisk[0].text, 'b');
});
