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

test('createTask 生成 id/status/时间并裁剪超过5张的图', () => {
  const t = createTask({ text: 'hello', images: ['a','b','c','d','e','f'] });
  assert.ok(t.id);
  assert.equal(t.status, 'pending');
  assert.equal(t.images.length, 5);
  assert.equal(t.createdAt, t.updatedAt);
  assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}/);
});

test('sortByCreatedAtDesc 按创建时间倒序', () => {
  const a = createTask({ text: 'old' });
  a.createdAt = '2020-01-01T00:00:00.000Z';
  const b = createTask({ text: 'new' });
  b.createdAt = '2024-01-01T00:00:00.000Z';
  assert.deepEqual(sortByCreatedAtDesc([a, b]).map(t => t.text), ['new', 'old']);
});

test('toggleStatus 在 done/pending 间切换并更新时间', () => {
  const t = createTask({ text: 'x' });
  let list = toggleStatus([t], t.id);
  assert.equal(list[0].status, 'done');
  list = toggleStatus(list, t.id);
  assert.equal(list[0].status, 'pending');
});

test('updateTask 修改文字并在超限时裁剪图片', () => {
  const t = createTask({ text: 'x', images: ['i1'] });
  const list = updateTask([t], t.id, { text: 'y', images: ['n1','n2','n3','n4','n5','n6'] });
  assert.equal(list[0].text, 'y');
  assert.equal(list[0].images.length, 5);
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
  const rel = fs2.copyImage(png, 'abc', 0);
  assert.equal(rel, 'images/abc_0.png');
  assert.ok(fs2.readImageDataUrl(rel).startsWith('data:image/png'));
  fs2.deleteImages([rel]);
  assert.equal(fs2.readImageDataUrl(rel), null);
});
