const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCFHDropBuffer } = require('../src/main/clipboardFiles');

test('CF_HDROP header size 20 and fWide=1', () => {
  const buf = createCFHDropBuffer(['C:\\tmp\\a.mp4']);
  assert.ok(buf.length > 20);
  assert.equal(buf.readUInt32LE(0), 20);
  assert.equal(buf.readUInt32LE(16), 1);
});

test('path list is utf16le and double-null terminated', () => {
  const p = 'D:\\v\\x.mp4';
  const buf = createCFHDropBuffer([p]);
  const list = buf.subarray(20);
  const expected = Buffer.from(p + '\0\0', 'utf16le');
  assert.equal(Buffer.compare(list, expected), 0);
});

test('multiple paths joined with single null', () => {
  const buf = createCFHDropBuffer(['C:\\a.txt', 'C:\\b.txt']);
  const list = buf.subarray(20).toString('utf16le');
  assert.equal(list, 'C:\\a.txt\0C:\\b.txt\0\0');
});
