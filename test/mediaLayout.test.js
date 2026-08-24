const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  sanitizeTagName, subdirFor, relFor, allocConflictName, parseImageIndex, imageIndexTakenSet,
} = require('../src/main/mediaLayout');

test('sanitizeTagName strips illegal chars then collapses whitespace', () => {
  // '/' removed (not replaced), then spaces -> '_', then trim
  assert.equal(sanitizeTagName('  工 作/A  '), '工_作A');
  assert.equal(sanitizeTagName('a/b:c'), 'abc');
  assert.equal(sanitizeTagName(':::'), 'tag');
});

test('subdirFor: 0 / missing / multi -> 公共; single -> name_id8', () => {
  const tags = [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '工作' }];
  assert.equal(subdirFor([], tags), '公共');
  assert.equal(subdirFor(['nope'], tags), '公共');
  assert.equal(subdirFor(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'x'], tags), '公共');
  assert.equal(subdirFor(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], tags), '工作_aaaaaaaa');
});

test('relFor uses posix slashes', () => {
  assert.equal(relFor('images', '公共', 'a_0.png'), 'images/公共/a_0.png');
});

test('allocConflictName appends _n before ext', () => {
  const taken = new Set([path.join('dir', 'a.png'), path.join('dir', 'a_1.png')]);
  const exists = (p) => taken.has(p);
  assert.equal(allocConflictName('dir', 'a.png', exists), 'a_2.png');
});

test('parseImageIndex handles conflict suffix', () => {
  assert.equal(parseImageIndex('abc_0.png', 'abc'), 0);
  assert.equal(parseImageIndex('abc_0_1.png', 'abc'), 0);
  assert.equal(parseImageIndex('images/公共/abc_2_3.jpg', 'abc'), 2);
  assert.equal(parseImageIndex('other_0.png', 'abc'), null);
});

test('imageIndexTakenSet from rel list', () => {
  const set = imageIndexTakenSet(['images/公共/abc_0.png', 'images/公共/abc_0_1.png', 'images/x/abc_2.png'], 'abc');
  assert.ok(set.has(0) && set.has(2) && !set.has(1));
});
