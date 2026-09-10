const { test } = require('node:test');
const assert = require('node:assert/strict');
const { taskMatchesQuery, taskMatchInfo, snippetAround } = require('../src/renderer/search');

test('空关键字匹配全部', () => {
  assert.equal(taskMatchesQuery({ text: 'hello' }, ''), true);
  assert.equal(taskMatchesQuery({ text: 'hello' }, '   '), true);
  assert.equal(taskMatchInfo({ text: 'hello' }, ''), null);
});

test('匹配正文不区分大小写', () => {
  assert.equal(taskMatchesQuery({ text: 'Hello World' }, 'hello'), true);
  assert.equal(taskMatchesQuery({ text: 'Hello World' }, 'xyz'), false);
  const info = taskMatchInfo({ text: 'Hello World' }, 'hello');
  assert.equal(info.primary.source, 'text');
  assert.deepEqual(info.sources, ['text']);
});

test('匹配附件名（对象或字符串 rel）', () => {
  assert.equal(taskMatchesQuery({
    text: '',
    attachments: [{ name: '报告.pdf', rel: 'attachments/报告.pdf' }],
  }, '报告'), true);
  assert.equal(taskMatchesQuery({
    text: '',
    attachments: ['attachments/notes.txt'],
  }, 'notes'), true);
  assert.equal(taskMatchesQuery({
    text: '无关',
    attachments: [{ name: 'a.png', rel: 'attachments/a.png' }],
  }, '报告'), false);
  const info = taskMatchInfo({
    text: '',
    attachments: [{ name: '报告.pdf', rel: 'attachments/报告.pdf' }],
  }, '报告');
  assert.equal(info.primary.source, 'attachment');
  assert.equal(info.primary.snippet, '报告.pdf');
});

test('图内 OCR 文字可匹配', () => {
  const task = { text: '', images: ['images/a.png'], attachments: [] };
  const ocrTexts = { 'images/a.png': '预览最小识别框' };
  assert.equal(taskMatchesQuery(task, '识别框', { ocrTexts }), true);
  assert.equal(taskMatchesQuery(task, '识别框', {}), false);
  assert.equal(taskMatchesQuery(task, '没有', { ocrTexts }), false);
  const info = taskMatchInfo(task, '识别框', { ocrTexts });
  assert.equal(info.primary.source, 'ocr');
  assert.equal(info.primary.label, '图内文字');
  assert.match(info.primary.snippet, /识别框/);
});

test('多来源命中时每条都列出', () => {
  const task = {
    text: '识别框说明',
    images: ['images/a.png', 'images/b.png'],
    attachments: [{ name: '识别框.pdf' }],
  };
  const ocrTexts = {
    'images/a.png': '屏幕上有识别框控件',
    'images/b.png': '另一个识别框',
  };
  const info = taskMatchInfo(task, '识别框', { ocrTexts });
  assert.deepEqual(info.sources, ['text', 'attachment', 'ocr']);
  assert.equal(info.hits.length, 4);
  assert.deepEqual(info.hits.map((h) => h.source), ['text', 'attachment', 'ocr', 'ocr']);
  assert.equal(info.primary.source, 'ocr');
});

test('snippetAround 截取关键字附近', () => {
  const s = snippetAround('前面一些文字然后是关键字后面还有内容', '关键字', 4);
  assert.match(s, /关键字/);
  assert.match(s, /^…/);
  assert.match(s, /…$/);
});
