const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEditTaskIdFromSearch,
  editWindowTitle,
  resolveDirtyCloseAction,
} = require('../src/renderer/editWindowHelpers');

test('parseEditTaskIdFromSearch reads edit param', () => {
  assert.equal(parseEditTaskIdFromSearch('?edit=abc'), 'abc');
  assert.equal(parseEditTaskIdFromSearch('?foo=1&edit=x%2Fy'), 'x/y');
  assert.equal(parseEditTaskIdFromSearch(''), null);
  assert.equal(parseEditTaskIdFromSearch('?edit='), null);
});

test('editWindowTitle is fixed label', () => {
  assert.equal(editWindowTitle('短'), '编辑');
  assert.equal(editWindowTitle('一二三四五六七八九十一二三四五六七八九十超长'), '编辑');
  assert.equal(editWindowTitle(''), '编辑');
});

test('resolveDirtyCloseAction maps dialog response', () => {
  assert.equal(resolveDirtyCloseAction({ dirty: false }), 'close');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 0 }), 'save');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 1 }), 'discard');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: 2 }), 'cancel');
  assert.equal(resolveDirtyCloseAction({ dirty: true, response: undefined }), 'cancel');
});
