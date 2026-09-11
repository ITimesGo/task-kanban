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
  installExeName,
  buildSideBySideLaunchScript,
  writeCurrentPointer,
  readCurrentPointer,
  cleanupOldInstalls,
  toBase64Utf8,
} = require('../src/main/appUpdate');

test('version helpers', () => {
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
  assert.equal(compareVersions('1.0.0', '1.1.0'), -1);
  assert.equal(
    evaluateUpdate('1.0.0', { version: '1.1.0', url: 'https://x/a.exe' }).status,
    'available'
  );
});

test('UPDATE_FEED_URL', () => {
  assert.match(UPDATE_FEED_URL, /kanban-latest\.json$/);
});

test('installExeName', () => {
  assert.equal(
    installExeName('1.2.3', 'https://github.com/x/releases/download/v1.2.3/task-kanban-1.2.3.exe'),
    'task-kanban-1.2.3.exe'
  );
  assert.equal(installExeName('9.9.9', ''), 'task-kanban-9.9.9.exe');
});

test('buildSideBySideLaunchScript 启动新文件并写快捷方式', () => {
  const exe = 'C:\\Users\\x\\AppData\\Roaming\\app\\install\\task-kanban-1.2.3.exe';
  const lnk = 'C:\\Users\\x\\Desktop\\任务看板.lnk';
  const s = buildSideBySideLaunchScript({
    pid: 11,
    parentPid: 22,
    newExePath: exe,
    shortcutPath: lnk,
    logPath: 'C:\\Temp\\a.log',
  });
  assert.match(s, /CreateShortcut/);
  assert.match(s, /Start-Process -FilePath \$newExe/);
  assert.doesNotMatch(s, /Copy-Item/);
  assert.ok(s.includes(toBase64Utf8(exe)));
});

test('current pointer + cleanup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ins-'));
  const keep = path.join(dir, 'install', 'task-kanban-2.0.0.exe');
  const drop = path.join(dir, 'install', 'task-kanban-1.0.0.exe');
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.writeFileSync(keep, 'new');
  fs.writeFileSync(drop, 'old');
  writeCurrentPointer(dir, { version: '2.0.0', exe: keep });
  assert.equal(readCurrentPointer(dir).version, '2.0.0');
  cleanupOldInstalls(dir, keep);
  assert.equal(fs.existsSync(keep), true);
  assert.equal(fs.existsSync(drop), false);
});
