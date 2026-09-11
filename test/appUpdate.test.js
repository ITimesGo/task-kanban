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
  buildHandoffScript,
  toBase64Utf8,
  writeHandoff,
  readHandoff,
  clearHandoff,
  copyPortableOverTarget,
} = require('../src/main/appUpdate');

test('parseVersion 支持 v 前缀与缺段', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
  assert.deepEqual(parseVersion(''), [0, 0, 0]);
});

test('compareVersions 比较大小', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
});

test('evaluateUpdate 远程更高时返回 available', () => {
  const r = evaluateUpdate('1.0.0', {
    version: '1.0.1',
    notes: '修复',
    url: 'https://example.com/a.exe',
  });
  assert.equal(r.status, 'available');
  assert.equal(r.latest, '1.0.1');
});

test('evaluateUpdate 已最新', () => {
  const r = evaluateUpdate('1.0.1', { version: '1.0.1', url: 'https://example.com/a.exe' });
  assert.equal(r.status, 'latest');
});

test('UPDATE_FEED_URL 指向仓库 kanban-latest.json', () => {
  assert.match(
    UPDATE_FEED_URL,
    /^https:\/\/raw\.githubusercontent\.com\/ITimesGo\/task-kanban\/main\/docs\/kanban-latest\.json$/
  );
});

test('buildHandoffScript 等待后启动新 exe', () => {
  const newExe = 'C:\\Users\\x\\AppData\\Roaming\\app\\updates\\new.exe';
  const s = buildHandoffScript({
    pid: 12345,
    parentPid: 67890,
    newExePath: newExe,
    logPath: 'C:\\Temp\\h.log',
  });
  assert.match(s, /\$pids = @\(12345,67890\)/);
  assert.match(s, /Start-Process -FilePath \$newExe/);
  assert.ok(s.includes(toBase64Utf8(newExe)));
  assert.doesNotMatch(s, /Copy-Item/);
  assert.throws(() => buildHandoffScript({ pid: 0, newExePath: 'a' }));
});

test('resolveUpdateTargetPath 优先用 PORTABLE_EXECUTABLE_FILE', () => {
  const portable = 'D:\\Apps\\task-kanban-1.0.3.exe';
  const tempExec = 'C:\\Users\\x\\AppData\\Local\\Temp\\xxx\\任务看板.exe';
  assert.equal(
    resolveUpdateTargetPath({
      isPackaged: true,
      execPath: tempExec,
      env: { PORTABLE_EXECUTABLE_FILE: portable },
    }),
    portable
  );
});

test('isExtractedTempPath 识别临时解压目录', () => {
  const tmp = os.tmpdir();
  assert.equal(isExtractedTempPath(path.join(tmp, 'abc', 'app.exe'), tmp), true);
  assert.equal(isExtractedTempPath('D:\\Tools\\task-kanban-1.0.7.exe', tmp), false);
});

test('handoff 读写与 copyPortableOverTarget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ho-'));
  const src = path.join(dir, 'new.exe');
  const dst = path.join(dir, 'old.exe');
  fs.writeFileSync(src, 'hello-update');
  fs.writeFileSync(dst, 'old');
  writeHandoff(dir, { replaceTarget: dst, newExe: src });
  const h = readHandoff(dir);
  assert.equal(h.replaceTarget, dst);
  const r = copyPortableOverTarget(src, dst);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(dst, 'utf8'), 'hello-update');
  clearHandoff(dir);
  assert.equal(readHandoff(dir), null);
});
