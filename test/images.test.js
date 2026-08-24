const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const images = require('../src/main/images');
const FileStore = require('../src/main/fileStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-img-'));
}

function writeTinyPng(dir, name = 'a.png') {
  // 最小合法 PNG 头 + 空内容即可供拷贝测试（不校验解码）
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]));
  return abs;
}

test('assertImageFile 拒绝不存在/超大/非法扩展名', () => {
  const dir = tmpDir();
  assert.throws(() => images.assertImageFile(path.join(dir, 'nope.png')), /不存在|找不到|无效/);
  const bad = path.join(dir, 'x.gif');
  fs.writeFileSync(bad, 'x');
  assert.throws(() => images.assertImageFile(bad), /不支持/);
  const big = path.join(dir, 'big.png');
  fs.writeFileSync(big, Buffer.alloc(images.MAX_BYTES + 1));
  assert.throws(() => images.assertImageFile(big), /10MB/);
});

test('assertImageFile 接受合法 jpg/png/bmp 并返回绝对路径', () => {
  const dir = tmpDir();
  const abs = writeTinyPng(dir, 'ok.PNG');
  assert.equal(images.assertImageFile(abs), abs);
});

test('writeClipboardPng 写出 png 文件且受大小限制', () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'paste.png');
  const fake = {
    toPNG: () => Buffer.from([1, 2, 3, 4]),
    isEmpty: () => false,
  };
  const out = images.writeClipboardPng(fake, dest);
  assert.equal(out, dest);
  assert.ok(fs.existsSync(dest));
  assert.equal(fs.readFileSync(dest).length, 4);

  const tooBig = { toPNG: () => Buffer.alloc(images.MAX_BYTES + 1), isEmpty: () => false };
  assert.throws(() => images.writeClipboardPng(tooBig, path.join(dir, 'big.png')), /10MB/);
});

test('FileStore.copyImageFromPath 按扩展名落盘且内容与源一致', () => {
  const dir = tmpDir();
  const src = writeTinyPng(dir, 'src.png');
  const store = new FileStore(path.join(dir, 'data'));
  const rel = store.copyImageFromPath(src, 'tid', 2, { tags: [] });
  assert.equal(rel, 'images/公共/tid_2.png');
  const dest = path.join(dir, 'data', rel);
  assert.ok(fs.existsSync(dest));
  assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src));
});

test('FileStore.copyImageFromPath 非法文件抛错', () => {
  const dir = tmpDir();
  const store = new FileStore(path.join(dir, 'data'));
  const bad = path.join(dir, 'x.txt');
  fs.writeFileSync(bad, 'hi');
  assert.throws(() => store.copyImageFromPath(bad, 'tid', 0), /不支持/);
});
