const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  compareVersions,
  parseVersion,
  evaluateUpdate,
  UPDATE_FEED_URL,
  resolveUpdateTargetPath,
  isExtractedTempPath,
  buildReplaceAndLaunchScript,
  toBase64Utf8,
  writeHandoff,
  readHandoff,
  clearHandoff,
  copyPortableOverTarget,
} = require('../src/main/appUpdate');

test('parseVersion / compareVersions', () => {
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});

test('evaluateUpdate', () => {
  assert.equal(
    evaluateUpdate('1.0.0', { version: '1.0.1', url: 'https://example.com/a.exe' }).status,
    'available'
  );
  assert.equal(
    evaluateUpdate('1.0.1', { version: '1.0.1', url: 'https://example.com/a.exe' }).status,
    'latest'
  );
});

test('UPDATE_FEED_URL', () => {
  assert.match(UPDATE_FEED_URL, /kanban-latest\.json$/);
});

test('buildReplaceAndLaunchScript 先复制再启动目标路径', () => {
  const newExe = 'C:\\Users\\x\\AppData\\Roaming\\app\\updates\\pending-update.exe';
  const dst = 'C:\\Users\\x\\Desktop\\task-kanban.exe';
  const s = buildReplaceAndLaunchScript({
    pid: 12345,
    parentPid: 67890,
    newExePath: newExe,
    targetPath: dst,
    logPath: 'C:\\Temp\\h.log',
    handoffJsonPath: 'C:\\Temp\\ho.json',
  });
  assert.match(s, /\$pids = @\(12345,67890\)/);
  assert.match(s, /Copy-Item/);
  assert.match(s, /Start-Process -FilePath \$dst/);
  assert.ok(s.includes(toBase64Utf8(newExe)));
  assert.ok(s.includes(toBase64Utf8(dst)));
  assert.doesNotMatch(s, /Start-Process -FilePath \$newExe/);
});

test('resolveUpdateTargetPath / isExtractedTempPath', () => {
  const portable = 'D:\\Apps\\task-kanban.exe';
  assert.equal(
    resolveUpdateTargetPath({
      isPackaged: true,
      execPath: 'C:\\Temp\\x.exe',
      env: { PORTABLE_EXECUTABLE_FILE: portable },
    }),
    portable
  );
  assert.equal(isExtractedTempPath(path.join(os.tmpdir(), 'a.exe'), os.tmpdir()), true);
});

test('handoff 与 copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ho-'));
  const src = path.join(dir, 'new.exe');
  const dst = path.join(dir, 'old.exe');
  fs.writeFileSync(src, 'hello-update');
  fs.writeFileSync(dst, 'old');
  writeHandoff(dir, { replaceTarget: dst, newExe: src });
  assert.equal(readHandoff(dir).replaceTarget, dst);
  assert.equal(copyPortableOverTarget(src, dst).ok, true);
  assert.equal(fs.readFileSync(dst, 'utf8'), 'hello-update');
  clearHandoff(dir);
});
