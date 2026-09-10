const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SKINS, SKIN_ORDER, getSkin } = require('../src/renderer/skins');

test('五套皮肤齐全；白天与苹果可自定义主题色', () => {
  assert.deepEqual(
    Object.keys(SKINS).sort(),
    ['apple', 'day', 'eyecare', 'mario', 'night'].sort()
  );
  assert.deepEqual(SKIN_ORDER, ['day', 'apple', 'mario', 'night', 'eyecare']);
  assert.equal(getSkin('day').customPrimary, true);
  assert.equal(getSkin('night').customPrimary, false);
  assert.equal(getSkin('eyecare').customPrimary, false);
  assert.equal(getSkin('mario').customPrimary, false);
  assert.equal(getSkin('apple').customPrimary, true);
  assert.equal(getSkin('mario').fixedPrimary, '#e52521');
  assert.equal(getSkin('night').fixedPrimary, '#409eff');
  assert.equal(getSkin('eyecare').fixedPrimary, '#3a8f5c');
  assert.equal(getSkin('apple').fixedPrimary, undefined);
  assert.equal(getSkin('apple').label, '苹果');
  assert.equal(getSkin('apple').vars['--primary'], '#007aff');
  assert.equal(getSkin('unknown').label, '白天');
});

test('每套皮肤包含必要 CSS 变量', () => {
  for (const skin of Object.values(SKINS)) {
    assert.ok(skin.vars['--bg']);
    assert.ok(skin.vars['--surface']);
    assert.ok(skin.vars['--text']);
    assert.ok(skin.titlebar.color);
  }
});
