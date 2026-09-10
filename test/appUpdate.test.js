const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  parseVersion,
  evaluateUpdate,
  UPDATE_FEED_URL,
  psSingleQuote,
  buildApplyUpdateScript,
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

test('buildApplyUpdateScript 等待 PID 并覆盖目标', () => {
  const s = buildApplyUpdateScript({
    pid: 12345,
    sourcePath: 'C:\\Temp\\new.exe',
    targetPath: 'D:\\Apps\\任务看板.exe',
  });
  assert.match(s, /\$pidToWait = 12345/);
  assert.match(s, /Copy-Item/);
  assert.match(s, /Start-Process/);
  assert.doesNotMatch(s, /\$PID\s*=/);
  assert.throws(() => buildApplyUpdateScript({ pid: 0, sourcePath: 'a', targetPath: 'b' }));
});
