const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../src/main/storage');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanx-'));
}

test('defaultDir 位于 appData 根下', () => {
  const root = tmpDir();
  assert.equal(storage.defaultDir(root), path.join(root, 'TaskApp'));
});

test('无配置时 resolveStoragePath 返回默认目录', () => {
  const root = tmpDir();
  assert.equal(storage.resolveStoragePath(root), storage.defaultDir(root));
});

test('saveStoragePath 后 resolve 返回自定义路径，配置写在默认目录下', () => {
  const root = tmpDir();
  const custom = path.join(tmpDir(), 'mydata');
  storage.saveStoragePath(root, custom);
  assert.equal(storage.resolveStoragePath(root), custom);
  // 配置物理上存在默认目录，即使自定义路径删除也能读到
  assert.ok(fs.existsSync(path.join(storage.defaultDir(root), 'config.json')));
});

test('migrateData 复制 tasks/tags/图片到新目录，同名跳过不覆盖', () => {
  const root = tmpDir();
  const src = storage.defaultDir(root);
  const dst = path.join(root, 'newdata');
  fs.mkdirSync(path.join(src, 'images'), { recursive: true });
  fs.writeFileSync(path.join(src, 'tasks.json'), '{"a":1}');
  fs.writeFileSync(path.join(src, 'tags.json'), '[]');
  fs.writeFileSync(path.join(src, 'images', 'xx_0.png'), 'AAA');
  // 目标已存在同名文件，验证不覆盖
  fs.mkdirSync(path.join(dst, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'images', 'xx_0.png'), 'KEEP');

  const { copied, skipped } = storage.migrateData(src, dst);

  assert.ok(copied >= 2); // tasks.json + tags.json
  assert.ok(copied === 2); // images 同名被跳过
  assert.equal(skipped, 1);
  assert.equal(fs.readFileSync(path.join(dst, 'images', 'xx_0.png'), 'utf8'), 'KEEP'); // 未覆盖
  assert.equal(fs.readFileSync(path.join(dst, 'tasks.json'), 'utf8'), '{"a":1}');
});

test('migrateData 空源目录也能在新目录建好 images', () => {
  const root = tmpDir();
  const src = path.join(root, 'emptySrc');
  const dst = path.join(root, 'dst');
  fs.mkdirSync(src, { recursive: true });
  const { copied } = storage.migrateData(src, dst);
  assert.equal(copied, 0);
  assert.ok(fs.existsSync(path.join(dst, 'images')));
});
