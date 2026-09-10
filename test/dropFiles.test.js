const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isImageFile } = require('../src/renderer/dropFiles');

test('isImageFile 认 MIME 与扩展名', () => {
  assert.equal(isImageFile({ type: 'image/png', name: 'a.bin' }), true);
  assert.equal(isImageFile({ type: '', name: 'photo.JPG' }), true);
  assert.equal(isImageFile({ type: '', name: 'doc.pdf' }), false);
  assert.equal(isImageFile({ type: 'image/jpeg', name: 'x' }), true);
});
