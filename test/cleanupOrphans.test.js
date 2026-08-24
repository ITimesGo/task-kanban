const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupOrphans } = require('../src/main/cleanupOrphans');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-orph-')); }

test('cleanupOrphans deletes unreferenced file in subdir', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'images', '公共'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '公共', 'orphan.png'), 'x');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '[]');
  fs.writeFileSync(path.join(dir, 'trash.json'), '[]');
  const res = cleanupOrphans(dir);
  assert.ok(res.orphans.includes('images/公共/orphan.png'));
  assert.equal(res.found, 1);
});

test('cleanupOrphans keeps referenced subdir file', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'images', '公共'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', '公共', 'keep.png'), 'x');
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([
    { id: 't1', images: ['images/公共/keep.png'], attachments: [] },
  ]));
  fs.writeFileSync(path.join(dir, 'trash.json'), '[]');
  const res = cleanupOrphans(dir);
  assert.equal(res.found, 0);
  assert.ok(fs.existsSync(path.join(dir, 'images', '公共', 'keep.png')));
});
