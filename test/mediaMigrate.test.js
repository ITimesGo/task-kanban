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
