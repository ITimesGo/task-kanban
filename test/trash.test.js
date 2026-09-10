const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const trash = require('../src/main/trash');
const FileStore = require('../src/main/fileStore');
const backup = require('../src/main/backup');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-trash-'));
}

const sample = (id, text) => ({
  id, text, images: [], attachments: [], status: 'pending',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
});

test('moveToTrash 从 tasks 移入 trash 并打上 trashedAt', () => {
  const a = sample('a', 'keep');
  const b = sample('b', 'drop');
  const res = trash.moveToTrash([a, b], [], 'b');
  assert.equal(res.tasks.length, 1);
  assert.equal(res.tasks[0].id, 'a');
  assert.equal(res.trash.length, 1);
  assert.equal(res.trash[0].id, 'b');
  assert.equal(res.trash[0].text, 'drop');
  assert.match(res.trash[0].trashedAt, /^\d{4}-/);
  assert.equal(res.moved.id, 'b');
});

test('moveToTrash 找不到 id 时原样返回', () => {
  const list = [sample('a', 'x')];
  const res = trash.moveToTrash(list, [], 'nope');
  assert.equal(res.tasks, list);
  assert.deepEqual(res.trash, []);
  assert.equal(res.moved, null);
});

test('restoreFromTrash 恢复任务并去掉 trashedAt', () => {
  const t = { ...sample('b', 'drop'), trashedAt: '2024-06-01T00:00:00.000Z' };
  const res = trash.restoreFromTrash([sample('a', 'keep')], [t], 'b');
  assert.equal(res.tasks.length, 2);
  assert.equal(res.trash.length, 0);
  assert.equal(res.restored.id, 'b');
  assert.equal(res.restored.trashedAt, undefined);
});

test('restoreFromTrash 与现有任务 id 冲突时报错', () => {
  const t = { ...sample('a', 'old'), trashedAt: '2024-06-01T00:00:00.000Z' };
  assert.throws(() => trash.restoreFromTrash([sample('a', 'live')], [t], 'a'), /冲突/);
});

test('purgeFromTrash / emptyTrash 移除条目', () => {
  const list = [
    { ...sample('a', '1'), trashedAt: '2024-01-01T00:00:00.000Z' },
    { ...sample('b', '2'), trashedAt: '2024-01-02T00:00:00.000Z' },
  ];
  const one = trash.purgeFromTrash(list, 'a');
  assert.equal(one.trash.length, 1);
  assert.equal(one.purged.id, 'a');
  assert.deepEqual(trash.emptyTrash(list).trash, []);
  assert.equal(trash.emptyTrash(list).purged.length, 2);
});

test('FileStore trash 读写缓存', () => {
  const dir = tmpDir();
  const store = new FileStore(dir);
  store.saveTrash([{ ...sample('t1', 'x'), trashedAt: '2024-01-01T00:00:00.000Z' }]);
  assert.equal(store.loadTrash()[0].id, 't1');
  fs.unlinkSync(path.join(dir, 'trash.json'));
  assert.equal(store.loadTrash()[0].id, 't1'); // 缓存
});

test('backup export/import 合并同 id 跳过', () => {
  const src = tmpDir();
  const dst = tmpDir();
  fs.mkdirSync(path.join(src, 'images'), { recursive: true });
  fs.writeFileSync(path.join(src, 'tasks.json'), JSON.stringify([sample('a', 'from-src')]));
  fs.writeFileSync(path.join(src, 'tags.json'), JSON.stringify([{ id: 'g1', name: '工作' }]));
  fs.writeFileSync(path.join(src, 'trash.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(src, 'images', 'a_0.png'), 'IMG');

  fs.mkdirSync(path.join(dst, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'tasks.json'), JSON.stringify([sample('a', 'keep-dst'), sample('b', 'dst')]));
  fs.writeFileSync(path.join(dst, 'tags.json'), JSON.stringify([{ id: 'g1', name: '旧名' }]));
  fs.writeFileSync(path.join(dst, 'images', 'a_0.png'), 'KEEP');

  const zipPath = path.join(tmpDir(), 'bak.zip');
  backup.exportZip(src, zipPath);
  assert.ok(fs.existsSync(zipPath));

  const res = backup.importZip(zipPath, dst);
  assert.ok(res.ok);
  const tasks = JSON.parse(fs.readFileSync(path.join(dst, 'tasks.json'), 'utf8'));
  assert.equal(tasks.find((t) => t.id === 'a').text, 'keep-dst'); // 同 id 跳过
  assert.ok(tasks.find((t) => t.id === 'b'));
  assert.equal(fs.readFileSync(path.join(dst, 'images', 'a_0.png'), 'utf8'), 'KEEP');
  const tags = JSON.parse(fs.readFileSync(path.join(dst, 'tags.json'), 'utf8'));
  assert.equal(tags.find((t) => t.id === 'g1').name, '旧名');
});
