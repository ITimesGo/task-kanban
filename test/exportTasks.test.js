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

test('filterAndSortTasks 按 taskIds 只导出指定任务', () => {
  const list = filterAndSortTasks(tasks, { taskIds: ['c'], status: 'all', sortKey: 'createdAt' });
  assert.deepEqual(list.map((t) => t.id), ['c']);
});

test('formatTime 与 defaultExportName', () => {
  assert.equal(formatTime(null), '—');
  assert.match(defaultExportName('pdf'), /^任务导出_.*\.pdf$/);
  assert.match(defaultExportName('markdown'), /\.md$/);
  assert.match(defaultExportName('html'), /\.html$/);
  assert.match(defaultExportName('pdf', { single: true }), /^任务_.*\.pdf$/);
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

test('导出条目不含处理状态与无标签占位', () => {
  const list = filterAndSortTasks(tasks, { tagIds: ['t2'], status: 'done' });
  const model = buildDocumentModel(list, tags, {
    tagIds: ['t2'], status: 'done', sortKey: 'createdAt', includeImages: false,
  }, null);
  const md = renderMarkdown(model);
  assert.match(md, /# 任务导出/);
  assert.match(md, /生活/);
  assert.doesNotMatch(md, /## #\d+ 已执行|## #\d+ 待执行/);
  assert.doesNotMatch(md, /无标签|标签：无/);
  assert.doesNotMatch(md, /- 状态：/);
  const emptyTagTask = [{
    id: 'x', text: '无签', status: 'pending', tags: [],
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    statusAt: null, images: [],
  }];
  const html = renderHtmlDocument(buildDocumentModel(emptyTagTask, tags, {
    taskIds: ['x'], status: 'all', sortKey: 'createdAt', includeImages: false,
  }, null));
  assert.doesNotMatch(html, /无标签/);
  assert.doesNotMatch(html, /class="status"|待执行|已执行/);
  assert.doesNotMatch(html, />状态 /);
});

test('导出正文优先用 doc 纯文本，图片按 doc 顺序（跳过视频）', () => {
  const rich = [{
    id: 'r1',
    text: '旧字段',
    status: 'pending',
    tags: ['t1'],
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    statusAt: null,
    images: ['images/z.png', 'images/a.png'],
    videos: ['videos/v.mp4'],
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
            { type: 'text', text: '正文' },
          ],
        },
        { type: 'image', attrs: { src: 'images/a.png' } },
        { type: 'video', attrs: { src: 'videos/v.mp4' } },
        { type: 'paragraph', content: [{ type: 'text', text: '图后文字' }] },
        { type: 'image', attrs: { src: 'images/z.png' } },
      ],
    },
  }];
  const model = buildDocumentModel(rich, tags, {
    tagIds: [], status: 'all', sortKey: 'createdAt', includeImages: true,
  }, null);
  assert.equal(model.items[0].text, '加粗正文\n图后文字');
  assert.deepEqual(model.items[0].imageRels, ['images/a.png', 'images/z.png']);
  const html = renderHtmlDocument(model);
  assert.match(html, /<strong>加粗<\/strong>正文/);
  assert.doesNotMatch(html, /video|mp4/i);
  // 图文穿插：第一段 → 第一张图 → 第二段 → 第二张图（不再是全文后再贴图）
  assert.match(html, /加粗<\/strong>正文[\s\S]*images\/a\.png[\s\S]*图后文字[\s\S]*images\/z\.png/);
  assert.doesNotMatch(html, /class="imgs"/);
});

test('详情单条导出只含指定 taskId，且标题为任务详情', () => {
  const list = filterAndSortTasks(tasks, { taskIds: ['b'], status: 'all' });
  assert.deepEqual(list.map((t) => t.id), ['b']);
  const model = buildDocumentModel(list, tags, {
    taskIds: ['b'], status: 'all', sortKey: 'createdAt', includeImages: false,
  }, null);
  assert.equal(model.items.length, 1);
  const html = renderHtmlDocument(model);
  assert.match(html, /任务详情/);
  assert.doesNotMatch(html, /共 \d+ 条/);
  const md = renderMarkdown(model);
  assert.match(md, /# 任务详情/);
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
