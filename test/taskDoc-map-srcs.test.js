const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapDocMediaSrcs,
  hasUnresolvedPendingSrcs,
  rewritePendingSrcs,
} = require('../src/renderer/taskDoc');

test('mapDocMediaSrcs 按类型改写 image/video src', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'image', attrs: { src: 'images/a.png', alt: '', width: 200 } },
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{ type: 'video', attrs: { src: 'videos/b.mp4' } }],
        }],
      },
    ],
  };
  const out = mapDocMediaSrcs(doc, (src, kind) => `${kind}:${src}`);
  assert.equal(out.content[1].attrs.src, 'image:images/a.png');
  assert.equal(out.content[1].attrs.width, 200);
  assert.equal(out.content[2].content[0].content[0].attrs.src, 'video:videos/b.mp4');
  // 不改原 doc
  assert.equal(doc.content[1].attrs.src, 'images/a.png');
});

test('hasUnresolvedPendingSrcs 检测残留 pending', () => {
  const ok = rewritePendingSrcs({
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'pending:0' } }],
  }, { 0: 'images/a.png' });
  assert.equal(hasUnresolvedPendingSrcs(ok), false);
  assert.equal(hasUnresolvedPendingSrcs({
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'pending:1' } }],
  }), true);
});
