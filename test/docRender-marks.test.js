const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlRootToDoc } = require('../src/renderer/docRender');

function text(t) {
  return { nodeType: 3, nodeValue: t, parentElement: null };
}

function el(tag, kids, attrs) {
  const o = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    childNodes: kids || [],
    children: [],
    style: (attrs && attrs.style) || {},
    parentElement: null,
    classList: { contains: () => false },
    getAttribute(name) {
      if (!attrs) return null;
      return attrs[name] != null ? String(attrs[name]) : null;
    },
  };
  for (const c of o.childNodes) {
    c.parentElement = o;
    if (c.nodeType === 1) o.children.push(c);
  }
  return o;
}

test('htmlRootToDoc 保留 b/i 加粗斜体 marks', () => {
  const root = el('div', [
    el('p', [
      el('b', [text('粗')]),
      text('与'),
      el('i', [text('斜')]),
    ]),
  ]);
  const doc = htmlRootToDoc(root);
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0].type, 'paragraph');
  const bits = doc.content[0].content;
  assert.deepEqual(bits[0], { type: 'text', text: '粗', marks: [{ type: 'bold' }] });
  assert.deepEqual(bits[1], { type: 'text', text: '与' });
  assert.deepEqual(bits[2], { type: 'text', text: '斜', marks: [{ type: 'italic' }] });
});

test('htmlRootToDoc 识别 span style 加粗斜体', () => {
  const root = el('div', [
    el('p', [
      el('span', [text('粗斜')], { style: { fontWeight: '700', fontStyle: 'italic' } }),
    ]),
  ]);
  const doc = htmlRootToDoc(root);
  const marks = doc.content[0].content[0].marks.map((m) => m.type).sort();
  assert.deepEqual(marks, ['bold', 'italic']);
});

test('htmlRootToDoc 保留嵌套列表与列表内媒体', () => {
  const root = el('div', [
    el('ul', [
      el('li', [
        text('外层'),
        el('ul', [
          el('li', [
            text('内层'),
            el('img', [], { src: 'images/a.png', 'data-src': 'images/a.png' }),
          ]),
        ]),
      ]),
    ]),
  ]);
  const doc = htmlRootToDoc(root);
  assert.equal(doc.content[0].type, 'bulletList');
  const outerLi = doc.content[0].content[0];
  assert.equal(outerLi.type, 'listItem');
  const nested = outerLi.content.find((n) => n.type === 'bulletList');
  assert.ok(nested, '应保留嵌套 bulletList');
  const innerLi = nested.content[0];
  const media = innerLi.content.find((n) => n.type === 'image');
  assert.ok(media, '嵌套列表内图片应保留');
  assert.equal(media.attrs.src, 'images/a.png');
});
