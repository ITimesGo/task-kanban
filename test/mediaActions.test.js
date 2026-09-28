const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  sanitizeRel,
  defaultSaveName,
  allowPendingSrcPath,
  isAllowedSrcPath,
  resolvePayload,
} = require('../src/main/mediaActions');

test('sanitizeRel rejects traversal and absolute', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-act-'));
  const file = path.join(root, 'images');
  fs.mkdirSync(file);
  const img = path.join(file, 'a.png');
  fs.writeFileSync(img, 'x');
  assert.equal(sanitizeRel('../etc/passwd', root), null);
  assert.equal(sanitizeRel('C:/windows/a.png', root), null);
  assert.ok(sanitizeRel('images/a.png', root));
  fs.rmSync(root, { recursive: true, force: true });
});

test('defaultSaveName from rel / dataUrl mime', () => {
  assert.equal(defaultSaveName({ rel: 'images/foo.jpeg' }), 'foo.jpeg');
  assert.equal(defaultSaveName({ dataUrl: 'data:image/jpeg;base64,xx' }), 'image.jpg');
  assert.equal(defaultSaveName({ dataUrl: 'data:image/png;base64,xx' }), 'image.png');
  assert.equal(defaultSaveName({ srcPath: 'D:\\v\\clip.mp4', kind: 'video' }), 'clip.mp4');
});

test('srcPath allowlist required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-act-'));
  const f = path.join(root, 'v.mp4');
  fs.writeFileSync(f, 'x');
  assert.equal(isAllowedSrcPath(f), false);
  assert.equal(allowPendingSrcPath(f), true);
  assert.equal(isAllowedSrcPath(f), true);
  const r = resolvePayload({ kind: 'video', srcPath: f }, root);
  assert.equal(r.ok, true);
  assert.equal(r.absPath, path.resolve(f));
  fs.rmSync(root, { recursive: true, force: true });
});

test('reject video dataUrl', () => {
  const r = resolvePayload({ kind: 'video', dataUrl: 'data:image/png;base64,xx' }, os.tmpdir());
  assert.equal(r.ok, false);
});
