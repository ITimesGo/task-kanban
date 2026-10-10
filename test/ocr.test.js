const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cleanupOcrText, pickBetterText } = require('../src/main/ocr');

describe('cleanupOcrText', () => {
  it('keeps chinese chat lines', () => {
    const raw = '这个名称有点歧义\n\n改成什么好\n会容易被误解成，目标大小宽度吧';
    assert.equal(
      cleanupOcrText(raw),
      '这个名称有点歧义\n\n改成什么好\n会容易被误解成，目标大小宽度吧'
    );
  });

  it('drops short latin noise', () => {
    const raw = 'AGRA\nwee\n预览最小识别框\n::';
    assert.match(cleanupOcrText(raw), /预览最小识别框/);
    assert.doesNotMatch(cleanupOcrText(raw), /AGRA/);
  });
});

describe('pickBetterText', () => {
  it('prefers more chinese content', () => {
    const a = '预览最小识别框';
    const b = 'AGRA wee MRA';
    assert.equal(pickBetterText(a, b), a);
  });
});

describe('otsuThreshold', () => {
  it('returns a mid threshold for a bimodal hist', () => {
    const { otsuThreshold } = require('../src/main/ocr');
    const hist = new Uint32Array(256);
    for (let i = 0; i < 80; i++) hist[i] = 5;
    for (let i = 180; i < 256; i++) hist[i] = 5;
    const total = 80 * 5 + 76 * 5;
    const t = otsuThreshold(hist, total);
    assert.ok(t >= 60 && t <= 190, `got ${t}`);
  });
});
