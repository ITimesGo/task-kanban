const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDoc,
  extractPlainText,
  extractMedia,
  isDocVisuallyEmpty,
  isTaskContentEmpty,
  legacyDocFromTask,
  resolveTaskDoc,
  pendingKey,
  rewritePendingSrcs,
  deriveFieldsFromDoc,
} = require('../src/renderer/taskDoc');
const { taskMediaItems } = require('../src/renderer/taskMedia');

test('isValidDoc 拒绝空与坏结构', () => {
  assert.equal(isValidDoc(null), false);
  assert.equal(isValidDoc({}), false);
  assert.equal(isValidDoc({ type: 'doc', content: [] }), true);
});

test('extractPlainText 段落与加粗', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '你好', marks: [{ type: 'bold' }] },
          { type: 'text', text: '世界' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] },
    ],
  };
  assert.equal(extractPlainText(doc), '你好世界\n第二行');
});

test('extractMedia 文档序去重', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: 'images/a.png', alt: '' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      { type: 'video', attrs: { src: 'videos/b.mp4', alt: '' } },
      { type: 'image', attrs: { src: 'images/a.png', alt: '' } },
    ],
  };
  assert.deepEqual(extractMedia(doc), [
    { kind: 'image', rel: 'images/a.png' },
    { kind: 'video', rel: 'videos/b.mp4' },
  ]);
});

test('isDocVisuallyEmpty：空段与 hardBreak 算空；有图不算空', () => {
  assert.equal(isDocVisuallyEmpty({ type: 'doc', content: [] }), true);
  assert.equal(isDocVisuallyEmpty({
    type: 'doc',
    content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'hardBreak' }] }],
  }), true);
  assert.equal(isDocVisuallyEmpty({
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'images/a.png' } }],
  }), false);
});

test('isTaskContentEmpty 允许仅附件', () => {
  assert.equal(isTaskContentEmpty({
    doc: { type: 'doc', content: [] },
    attachments: [{ name: 'a.pdf', rel: 'x' }],
  }), false);
  assert.equal(isTaskContentEmpty({
    doc: { type: 'doc', content: [] },
    attachments: [],
  }), true);
});

test('legacyDocFromTask：多行文本 + media 序', () => {
  const doc = legacyDocFromTask({
    text: '一行\n\n\n二行',
    media: [
      { kind: 'video', rel: 'videos/b.mp4' },
      { kind: 'image', rel: 'images/a.png' },
    ],
  }, taskMediaItems);
  assert.equal(doc.type, 'doc');
  const types = doc.content.map((n) => n.type);
  assert.deepEqual(types, ['paragraph', 'paragraph', 'paragraph', 'video', 'image']);
  assert.equal(doc.content[0].content[0].text, '一行');
  assert.equal(doc.content[3].attrs.src, 'videos/b.mp4');
});

test('resolveTaskDoc 优先已有 doc', () => {
  const existing = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新' }] }] };
  const got = resolveTaskDoc({ text: '旧', doc: existing, images: ['images/a.png'] }, taskMediaItems);
  assert.equal(extractPlainText(got), '新');
});

test('rewritePendingSrcs 替换 pending', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: pendingKey(0), alt: '' } },
      { type: 'image', attrs: { src: 'images/keep.png', alt: '' } },
    ],
  };
  const next = rewritePendingSrcs(doc, { 0: 'images/new.png' });
  assert.equal(next.content[0].attrs.src, 'images/new.png');
  assert.equal(next.content[1].attrs.src, 'images/keep.png');
  const d = deriveFieldsFromDoc(next);
  assert.deepEqual(d.images, ['images/new.png', 'images/keep.png']);
  assert.equal(d.text, '');
});

test('图片显示宽度 roundtrip', () => {
  global.isValidDoc = isValidDoc;
  const { docToHtml, clampDisplayWidth } = require('../src/renderer/docRender');
  assert.equal(clampDisplayWidth(40), 72);
  assert.equal(clampDisplayWidth(900), 900);
  assert.equal(clampDisplayWidth(3000), 2400);
  const html = docToHtml({
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'images/a.png', alt: '', width: 240 } }],
  });
  assert.match(html, /data-width="240"/);
  assert.match(html, /width:240px/);
});
