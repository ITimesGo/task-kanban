const { test } = require('node:test');
const assert = require('node:assert/strict');
const { docToHtml, htmlRootToDoc } = require('../src/renderer/docRender');
const { extractPlainText } = require('../src/renderer/taskDoc');

function text(t) {
  return { nodeType: 3, nodeValue: t, parentElement: null };
}

function el(tag, kids, attrs) {
  const className = (attrs && attrs.class) || '';
  const classSet = new Set(String(className).split(/\s+/).filter(Boolean));
  const o = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    childNodes: kids || [],
    children: [],
    style: (attrs && attrs.style) || {},
    parentElement: null,
    className,
    classList: {
      contains: (name) => classSet.has(name),
    },
    checked: !!(attrs && attrs.checked),
    getAttribute(name) {
      if (!attrs) return null;
      if (name === 'class') return className || null;
      return attrs[name] != null ? String(attrs[name]) : null;
    },
    querySelector(sel) {
      if (sel === '.task-item-body') {
        return this.children.find((c) => c.classList && c.classList.contains('task-item-body')) || null;
      }
      if (sel === 'input[type="checkbox"]') {
        const walk = (node) => {
          if (!node || node.nodeType !== 1) return null;
          if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') return node;
          for (const c of node.children || []) {
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      }
      return null;
    },
  };
  for (const c of o.childNodes) {
    c.parentElement = o;
    if (c.nodeType === 1) o.children.push(c);
  }
  return o;
}

test('docToHtml 输出 taskList / taskItem', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '买菜' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '做饭' }] }],
        },
      ],
    }],
  };
  const html = docToHtml(doc, { checksInteractive: true });
  assert.match(html, /data-type="taskList"/);
  assert.match(html, /data-type="taskItem"/);
  assert.match(html, /data-checked="true"/);
  assert.match(html, /role="checkbox"/);
  assert.match(html, /task-check-box/);
  assert.match(html, /task-check-rect/);
  assert.match(html, /买菜/);
  assert.match(html, /做饭/);
  assert.match(html, /is-checked/);
});

test('htmlRootToDoc 解析待办列表', () => {
  const body1 = el('div', [el('p', [text('买菜')])], { class: 'task-item-body' });
  const body2 = el('div', [el('p', [text('做饭')])], { class: 'task-item-body' });
  const li1 = el('li', [
    el('button', [], { class: 'task-check', type: 'button', role: 'checkbox', 'aria-checked': 'false' }),
    body1,
  ], { class: 'task-item', 'data-type': 'taskItem', 'data-checked': 'false' });
  const li2 = el('li', [
    el('button', [], { class: 'task-check', type: 'button', role: 'checkbox', 'aria-checked': 'true' }),
    body2,
  ], { class: 'task-item is-checked', 'data-type': 'taskItem', 'data-checked': 'true' });
  const ul = el('ul', [li1, li2], { class: 'task-list', 'data-type': 'taskList' });
  const root = el('div', [ul]);
  const doc = htmlRootToDoc(root);
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0].type, 'taskList');
  assert.equal(doc.content[0].content.length, 2);
  assert.equal(doc.content[0].content[0].type, 'taskItem');
  assert.equal(doc.content[0].content[0].attrs.checked, false);
  assert.equal(doc.content[0].content[1].attrs.checked, true);
  assert.equal(doc.content[0].content[0].content[0].content[0].text, '买菜');
  assert.equal(doc.content[0].content[1].content[0].content[0].text, '做饭');
});

test('extractPlainText 含待办正文', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'taskList',
      content: [{
        type: 'taskItem',
        attrs: { checked: true },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成项' }] }],
      }],
    }],
  };
  assert.match(extractPlainText(doc), /已完成项/);
});
