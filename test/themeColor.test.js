const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseHexColor,
  themeFromPrimary,
  previewColor,
  isUsableThemeColor,
} = require('../src/renderer/themeColor');

test('parseHexColor 支持 3/6 位与省略 #', () => {
  assert.equal(parseHexColor('#409eff'), '#409eff');
  assert.equal(parseHexColor('409EFF'), '#409eff');
  assert.equal(parseHexColor('#abc'), '#aabbcc');
  assert.equal(parseHexColor('xyz'), null);
  assert.equal(parseHexColor(''), null);
  assert.equal(parseHexColor('#12'), null);
});

test('themeFromPrimary 生成衍生色与 rgb', () => {
  const t = themeFromPrimary('#409eff');
  assert.equal(t.primary, '#409eff');
  assert.equal(t.rgb, '64,158,255');
  assert.match(t.hover, /^#[0-9a-f]{6}$/);
  assert.match(t.soft, /^#[0-9a-f]{6}$/);
  assert.equal(themeFromPrimary('xyz'), null);
  assert.equal(themeFromPrimary(''), null);
});

test('过浅颜色不可用，预览为黑且无法生成主题', () => {
  assert.equal(isUsableThemeColor('#ffffff'), false);
  assert.equal(isUsableThemeColor('#f5f5f5'), false);
  assert.equal(isUsableThemeColor('#409eff'), true);
  assert.equal(themeFromPrimary('#ffffff'), null);
  assert.equal(previewColor('#ffffff'), '#000000');
  assert.equal(previewColor('#409eff'), '#409eff');
  assert.equal(previewColor('#409'), '#000000');
  assert.equal(previewColor('nope'), '#000000');
});

test('黑夜背景下浅色主色可用、深色不可用', () => {
  assert.equal(isUsableThemeColor('#66b1ff', { against: '#121826' }), true);
  assert.equal(isUsableThemeColor('#1a2332', { against: '#121826' }), false);
});

test('苹果白底表面下元素蓝可用（勿用页面浅蓝底误杀）', () => {
  assert.equal(isUsableThemeColor('#409eff', { against: '#ffffff' }), true);
  assert.equal(isUsableThemeColor('#409eff', { against: '#e8eef8' }), false);
  assert.ok(themeFromPrimary('#409eff', { against: '#ffffff' }));
  assert.equal(themeFromPrimary('#409eff', { against: '#e8eef8' }), null);
});
