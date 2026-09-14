const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, isPortableBuild } = require('../src/main/appUpdate');

test('parseVersion', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
});

test('compareVersions', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
});

test('isPortableBuild', () => {
  assert.equal(isPortableBuild({}), false);
  assert.equal(isPortableBuild({ PORTABLE_EXECUTABLE_FILE: 'C:\\a.exe' }), true);
});
