const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const {
  compareVersions,
  parseVersion,
  evaluateUpdate,
  UPDATE_FEED_URL,
  psSingleQuote,
  resolveUpdateTargetPath,
  isExtractedTempPath,
  buildApplyUpdateScript,
  toBase64Utf8,
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
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
});

test('evaluateUpdate 远程更高时返回 available', () => {
  const r = evaluateUpdate('1.0.0', {
    version: '1.0.1',
    notes: '修复',
    url: 'https://example.com/a.exe',
  });
  assert.equal(r.status, 'available');
  assert.equal(r.latest, '1.0.1');
  assert.equal(r.url, 'https://example.com/a.exe');
  assert.equal(r.notes, '修复');
});

test('evaluateUpdate 已最新', () => {
  const r = evaluateUpdate('1.0.1', { version: '1.0.1', url: 'https://example.com/a.exe' });
  assert.equal(r.status, 'latest');
});

test('evaluateUpdate 缺 version/url 时报 invalid', () => {
  assert.equal(evaluateUpdate('1.0.0', { version: '1.0.1' }).status, 'invalid');
  assert.equal(evaluateUpdate('1.0.0', null).status, 'invalid');
});

test('UPDATE_FEED_URL 指向仓库 kanban-latest.json', () => {
  assert.match(
    UPDATE_FEED_URL,
    /^https:\/\/raw\.githubusercontent\.com\/ITimesGo\/task-kanban\/main\/docs\/kanban-latest\.json$/
  );
});

test('psSingleQuote 转义单引号', () => {
  assert.equal(psSingleQuote(`C:\\a'b.exe`), `'C:\\a''b.exe'`);
});

test('buildApplyUpdateScript 使用 base64 路径并等待父进程', () => {
  const src = 'C:\\Temp\\new.exe';
  const dst = 'D:\\Apps\\任务看板.exe';
  const s = buildApplyUpdateScript({
    pid: 12345,
    parentPid: 67890,
    sourcePath: src,
    targetPath: dst,
    logPath: 'C:\\Temp\\u.log',
    fallbackDir: 'C:\\Users\\x\\Downloads',
  });
  assert.match(s, /\$pids = @\(12345,67890\)/);
  assert.match(s, /FromBase64String/);
  assert.ok(s.includes(toBase64Utf8(src)));
  assert.ok(s.includes(toBase64Utf8(dst)));
  assert.match(s, /Test-ExclusiveWrite/);
  assert.match(s, /Move-Item/);
  assert.match(s, /fallback moved/);
  assert.throws(() => buildApplyUpdateScript({ pid: 0, sourcePath: 'a', targetPath: 'b' }));
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
  assert.equal(
    resolveUpdateTargetPath({
      isPackaged: true,
      execPath: tempExec,
      env: {
        PORTABLE_EXECUTABLE_DIR: 'D:\\Apps',
        PORTABLE_EXECUTABLE_APP_FILENAME: 'task-kanban',
      },
    }),
    path.join('D:\\Apps', 'task-kanban.exe')
  );
  assert.equal(
    resolveUpdateTargetPath({
      isPackaged: true,
      execPath: tempExec,
      env: {},
    }),
    tempExec
  );
});

test('isExtractedTempPath 识别临时解压目录', () => {
  const tmp = os.tmpdir();
  assert.equal(isExtractedTempPath(path.join(tmp, 'abc', 'app.exe'), tmp), true);
  assert.equal(isExtractedTempPath('D:\\Tools\\task-kanban-1.0.7.exe', tmp), false);
  assert.equal(isExtractedTempPath('C:\\Users\\x\\AppData\\Local\\Temp\\x\\a.exe', tmp), true);
});
