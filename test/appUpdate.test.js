const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  parseVersion,
  evaluateUpdate,
  UPDATE_FEED_URL,
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

test('UPDATE_FEED_URL 为占位地址', () => {
  assert.match(UPDATE_FEED_URL, /^https:\/\/example\.com\//);
});
