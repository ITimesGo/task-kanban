const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  filterAndSortTasks,
  formatTime,
  defaultExportName,
  buildDocumentModel,
  renderHtmlDocument,
  renderMarkdown,
  writeHtmlFile,
  writeMarkdownFile,
} = require('../src/main/exportTasks');

const tags = [
  { id: 't1', name: '工作' },
  { id: 't2', name: '生活' },
];

const tasks = [
  {
    id: 'a', text: '最早', status: 'pending', tags: ['t1'],
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
    statusAt: null, images: [],
  },
  {
    id: 'b', text: '最晚', status: 'done', tags: ['t2'],
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-02T10:00:00.000Z',
    statusAt: '2026-03-03T10:00:00.000Z', images: [],
  },
  {
    id: 'c', text: '中间 <脚本>', status: 'pending', tags: ['t1', 't2'],
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
    statusAt: null, images: [],
  },
];

test('filterAndSortTasks 按标签与状态筛选，并按时间倒序', () => {
  const list = filterAndSortTasks(tasks, { tagIds: ['t1'], status: 'pending', sortKey: 'createdAt' });
  assert.deepEqual(list.map((t) => t.id), ['c', 'a']);
});

test('filterAndSortTasks 空标签表示全部', () => {
  const list = filterAndSortTasks(tasks, { tagIds: [], status: 'all', sortKey: 'createdAt' });
  assert.deepEqual(list.map((t) => t.id), ['b', 'c', 'a']);
});

test('formatTime 与 defaultExportName', () => {
  assert.equal(formatTime(null), '—');
  assert.match(defaultExportName('pdf'), /\.pdf$/);
  assert.match(defaultExportName('markdown'), /\.md$/);
  assert.match(defaultExportName('html'), /\.html$/);
});

test('HTML 渲染转义危险字符', () => {
  const model = buildDocumentModel(
    filterAndSortTasks(tasks, { tagIds: ['t1'], status: 'pending' }),
    tags,
    { tagIds: ['t1'], status: 'pending', sortKey: 'createdAt', includeImages: false },
    null
  );
  const html = renderHtmlDocument(model);
  assert.match(html, /&lt;脚本&gt;/);
  assert.doesNotMatch(html, /<脚本>/);
});

test('Markdown 渲染包含标签与状态', () => {
  const list = filterAndSortTasks(tasks, { tagIds: ['t2'], status: 'done' });
  const model = buildDocumentModel(list, tags, {
    tagIds: ['t2'], status: 'done', sortKey: 'createdAt', includeImages: false,
  }, null);
  const md = renderMarkdown(model);
  assert.match(md, /# 任务导出/);
  assert.match(md, /已执行/);
  assert.match(md, /生活/);
});

test('writeHtmlFile / writeMarkdownFile 写出文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-export-'));
  const htmlPath = path.join(dir, 'out.html');
  const mdPath = path.join(dir, 'out.md');
  const htmlRes = writeHtmlFile(htmlPath, tasks, tags, {
    tagIds: [], status: 'all', sortKey: 'createdAt', includeImages: false,
  }, dir);
  const mdRes = writeMarkdownFile(mdPath, tasks, tags, {
    tagIds: [], status: 'all', sortKey: 'createdAt', includeImages: false,
  }, dir);
  assert.equal(htmlRes.count, 3);
  assert.equal(mdRes.count, 3);
  assert.ok(fs.readFileSync(htmlPath, 'utf8').includes('任务导出'));
  assert.ok(fs.readFileSync(mdPath, 'utf8').includes('任务导出'));
});
