const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = (() => {
  try { return { JSDOM: require('jsdom').JSDOM }; }
  catch (_) { return { JSDOM: null }; }
})();

// 无 jsdom 时用最小 DOM 桩测核心序列化路径（跳过）
const { htmlRootToDoc, extractPlainText, isDocVisuallyEmpty } = (() => {
  // htmlRootToDoc 依赖浏览器 DOM；在 node 侧用手工构造不可用。
  // 这里只测：图节点带 data: src 时不应被 visually empty（taskDoc）
  const taskDoc = require('../src/renderer/taskDoc');
  return {
    htmlRootToDoc: null,
    extractPlainText: taskDoc.extractPlainText,
    isDocVisuallyEmpty: taskDoc.isDocVisuallyEmpty,
  };
})();

test('含 data: 图片的 doc 不算空', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: 'data:image/png;base64,aaa', alt: '' } },
    ],
  };
  assert.equal(isDocVisuallyEmpty(doc), false);
});

test('含 pending 图片的 doc 不算空', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '  ' }] },
      { type: 'image', attrs: { src: 'pending:0', alt: '' } },
    ],
  };
  assert.equal(isDocVisuallyEmpty(doc), false);
});
