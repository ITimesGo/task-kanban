const fs = require('fs');
const path = require('path');
const os = require('os');
const images = require('./images');
const taskDoc = require('../renderer/taskDoc');

const STATUS_LABEL = { pending: '待执行', done: '已执行' };
const SORT_LABEL = {
  createdAt: '创建时间',
  statusAt: '状态处理时间',
  updatedAt: '编辑更新时间',
};

function timeMs(task, field) {
  const v = task && task[field];
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tagMapOf(tags) {
  const map = Object.create(null);
  for (const t of tags || []) {
    if (t && t.id) map[t.id] = t.name || t.id;
  }
  return map;
}

function taskTagNames(task, tagMap) {
  return (task.tags || []).map((id) => tagMap[id]).filter(Boolean);
}

function imageRels(task) {
  return (task.images || []).map((item) => {
    if (!item) return null;
    if (typeof item === 'string') return item;
    return item.rel || null;
  }).filter(Boolean);
}

/** 导出用图片：优先 doc 文档序，仅 image，跳过 video / pending */
function exportImageRels(task) {
  const doc = taskDoc.resolveTaskDoc(task);
  if (taskDoc.isValidDoc(task && task.doc)) {
    return taskDoc.extractMedia(doc)
      .filter((m) => m && m.kind === 'image')
      .map((m) => m.rel)
      .filter((rel) => rel && !String(rel).startsWith(taskDoc.PENDING_PREFIX));
  }
  return imageRels(task);
}

function exportPlainText(task) {
  const doc = taskDoc.resolveTaskDoc(task);
  const plain = taskDoc.extractPlainText(doc).trim();
  if (plain) return plain;
  const legacy = String((task && task.text) || '').trim();
  return legacy || '（无文字）';
}

function inlineExportHtml(nodes) {
  let html = '';
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.type === 'hardBreak') { html += '<br>'; continue; }
    if (n.type === 'text') {
      let t = esc(n.text);
      for (const m of n.marks || []) {
        if (!m || !m.type) continue;
        if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'italic') t = `<em>${t}</em>`;
      }
      html += t;
    }
  }
  return html;
}

function docNodeExportHtml(node, imgMap) {
  if (!node) return '';
  if (node.type === 'paragraph') {
    const inner = inlineExportHtml(node.content);
    return `<p>${inner || '<br>'}</p>`;
  }
  if (node.type === 'bulletList') {
    return `<ul>${(node.content || []).map((c) => docNodeExportHtml(c, imgMap)).join('')}</ul>`;
  }
  if (node.type === 'orderedList') {
    return `<ol>${(node.content || []).map((c) => docNodeExportHtml(c, imgMap)).join('')}</ol>`;
  }
  if (node.type === 'listItem') {
    return `<li>${(node.content || []).map((c) => docNodeExportHtml(c, imgMap)).join('')}</li>`;
  }
  if (node.type === 'image') {
    const rel = node.attrs && node.attrs.src;
    const dataUrl = rel && imgMap ? imgMap[rel] : null;
    if (dataUrl) return `<img src="${dataUrl}" alt="">`;
    return '';
  }
  if (node.type === 'video') return ''; // 导出不含视频
  return '';
}

function docToExportHtml(doc, imgMap) {
  if (!taskDoc.isValidDoc(doc)) return '';
  return (doc.content || []).map((n) => docNodeExportHtml(n, imgMap)).join('');
}

function inlineExportMd(nodes) {
  let out = '';
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.type === 'hardBreak') { out += '\n'; continue; }
    if (n.type === 'text') {
      let t = String(n.text || '');
      const marks = (n.marks || []).map((m) => m && m.type);
      if (marks.includes('bold')) t = `**${t}**`;
      if (marks.includes('italic')) t = `*${t}*`;
      out += t;
    }
  }
  return out;
}

function docToExportMarkdown(doc, assetNamesByRel) {
  if (!taskDoc.isValidDoc(doc)) return '';
  const lines = [];
  function walk(node, listPrefix) {
    if (!node) return;
    if (node.type === 'paragraph') {
      lines.push(inlineExportMd(node.content));
      lines.push('');
      return;
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const ordered = node.type === 'orderedList';
      (node.content || []).forEach((li, i) => {
        const prefix = ordered ? `${i + 1}. ` : '- ';
        const bits = [];
        for (const c of li.content || []) {
          if (c.type === 'paragraph') bits.push(inlineExportMd(c.content));
          else if (c.type === 'image') {
            const rel = c.attrs && c.attrs.src;
            const name = rel && assetNamesByRel ? assetNamesByRel[rel] : null;
            if (name) bits.push(`![](${name})`);
          }
        }
        lines.push(prefix + (bits.join(' ') || ''));
      });
      lines.push('');
      return;
    }
    if (node.type === 'image') {
      const rel = node.attrs && node.attrs.src;
      const name = rel && assetNamesByRel ? assetNamesByRel[rel] : null;
      if (name) {
        lines.push(`![](${name})`);
        lines.push('');
      }
      return;
    }
    // skip video and unknown
  }
  for (const n of doc.content || []) walk(n);
  return lines.join('\n').replace(/\n+$/, '');
}

/** 筛选 + 按时间倒序 */
function filterAndSortTasks(tasks, { tagIds = [], status = 'all', sortKey = 'createdAt' } = {}) {
  let list = Array.isArray(tasks) ? [...tasks] : [];
  if (status && status !== 'all') list = list.filter((t) => t.status === status);
  if (tagIds && tagIds.length) {
    list = list.filter((t) => tagIds.some((id) => (t.tags || []).includes(id)));
  }
  const field = SORT_LABEL[sortKey] ? sortKey : 'createdAt';
  list.sort((a, b) => timeMs(b, field) - timeMs(a, field));
  return list;
}

function defaultExportName(format) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const ext = format === 'markdown' ? 'md' : format === 'html' ? 'html' : 'pdf';
  return `任务导出_${stamp}.${ext}`;
}

function filtersSummary({ tagIds, status, sortKey }, tagMap) {
  const tags = (tagIds || []).map((id) => tagMap[id]).filter(Boolean);
  const tagText = tags.length ? tags.join('、') : '全部标签';
  const statusText = status === 'pending' ? '待执行' : status === 'done' ? '已执行' : '全部状态';
  const sortText = SORT_LABEL[sortKey] || SORT_LABEL.createdAt;
  return { tagText, statusText, sortText };
}

function readImageDataUrl(appDataDir, rel) {
  if (!rel || !appDataDir) return null;
  const abs = path.join(appDataDir, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return images.dataUrlForPath(abs);
  } catch (_) {
    return null;
  }
}

function copyImageAsset(appDataDir, rel, assetsDir, usedNames) {
  const abs = path.join(appDataDir, rel);
  if (!fs.existsSync(abs)) return null;
  const base = path.basename(rel);
  let name = base;
  let i = 1;
  while (usedNames.has(name)) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    name = `${stem}_${i}${ext}`;
    i += 1;
  }
  usedNames.add(name);
  fs.copyFileSync(abs, path.join(assetsDir, name));
  return name;
}

function buildDocumentModel(tasks, tags, options, appDataDir) {
  const tagMap = tagMapOf(tags);
  const sortKey = options.sortKey || 'createdAt';
  const includeImages = !!options.includeImages;
  const summary = filtersSummary(options, tagMap);
  const items = tasks.map((t, idx) => {
    const names = taskTagNames(t, tagMap);
    const rels = exportImageRels(t);
    const imgMap = Object.create(null);
    const imgs = [];
    if (includeImages && appDataDir) {
      for (const rel of rels) {
        const dataUrl = readImageDataUrl(appDataDir, rel);
        imgs.push({ rel, dataUrl });
        if (dataUrl) imgMap[rel] = dataUrl;
      }
    } else if (includeImages) {
      for (const rel of rels) imgs.push({ rel, dataUrl: null });
    }
    const hasDoc = taskDoc.isValidDoc(t && t.doc);
    const doc = taskDoc.resolveTaskDoc(t);
    const bodyHtml = hasDoc ? docToExportHtml(doc, includeImages ? imgMap : null) : '';
    return {
      index: idx + 1,
      text: exportPlainText(t),
      bodyHtml,
      imageRels: rels,
      status: STATUS_LABEL[t.status] || t.status || '—',
      tags: names,
      createdAt: formatTime(t.createdAt),
      statusAt: formatTime(t.statusAt),
      updatedAt: formatTime(t.updatedAt),
      sortTime: formatTime(t[sortKey]),
      images: imgs,
      doc: hasDoc ? doc : null,
    };
  });
  return { summary, sortKey, includeImages, items, exportedAt: formatTime(new Date().toISOString()) };
}

function renderHtmlDocument(model, { forPrint = false } = {}) {
  const { summary, items, exportedAt, includeImages } = model;
  const blocks = items.map((it) => {
    const tagHtml = it.tags.length
      ? it.tags.map((n) => `<span class="tag">${esc(n)}</span>`).join('')
      : '<span class="muted">无标签</span>';
    let body;
    if (it.bodyHtml) {
      body = `<div class="body rich">${it.bodyHtml}</div>`;
    } else {
      const imgHtml = includeImages && it.images.length
        ? `<div class="imgs">${it.images.map((img) => (
            img.dataUrl ? `<img src="${img.dataUrl}" alt="">` : ''
          )).join('')}</div>`
        : '';
      body = `<pre class="body">${esc(it.text)}</pre>${imgHtml}`;
    }
    return `<article class="task">
  <header>
    <span class="idx">#${it.index}</span>
    <span class="status">${esc(it.status)}</span>
  </header>
  ${body}
  <div class="meta">
    <div class="tags">${tagHtml}</div>
    <div class="times">
      <span>创建 ${esc(it.createdAt)}</span>
      <span>状态 ${esc(it.statusAt)}</span>
      <span>更新 ${esc(it.updatedAt)}</span>
    </div>
  </div>
</article>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>任务导出</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: ${forPrint ? '16mm 14mm' : '32px 24px'};
    max-width: 820px;
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    color: #303133;
    background: #fff;
    line-height: 1.55;
  }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: #606266; font-size: 13px; margin-bottom: 24px; }
  .task {
    border: 1px solid #e4e7ed;
    border-radius: 10px;
    padding: 14px 16px;
    margin: 0 0 14px;
    page-break-inside: avoid;
  }
  .task header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
  .idx { font-weight: 700; color: #409eff; }
  .status { font-size: 12px; color: #606266; }
  .body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 14px;
  }
  .body.rich { white-space: normal; }
  .body.rich p { margin: 0 0 0.6em; }
  .body.rich ul, .body.rich ol { margin: 0 0 0.6em; padding-left: 1.3em; }
  .body.rich img {
    display: block;
    max-width: 220px;
    max-height: 160px;
    object-fit: contain;
    border: 1px solid #e4e7ed;
    border-radius: 6px;
    margin: 8px 0;
  }
  .meta { margin-top: 10px; font-size: 12px; color: #606266; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    background: #ecf5ff;
    color: #409eff;
  }
  .muted { color: #909399; }
  .times { display: flex; flex-wrap: wrap; gap: 12px; }
  .imgs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .imgs img {
    max-width: 220px;
    max-height: 160px;
    object-fit: contain;
    border: 1px solid #e4e7ed;
    border-radius: 6px;
  }
  .empty { color: #909399; padding: 24px 0; }
</style>
</head>
<body>
  <h1>任务导出</h1>
  <p class="sub">导出时间 ${esc(exportedAt)} · ${esc(summary.tagText)} · ${esc(summary.statusText)} · 按${esc(summary.sortText)} · 共 ${items.length} 条</p>
  ${items.length ? blocks : '<p class="empty">没有符合条件的任务</p>'}
</body>
</html>`;
}

function renderMarkdown(model, assetNamesByTask) {
  const { summary, items, exportedAt, includeImages } = model;
  const lines = [
    '# 任务导出',
    '',
    `> 导出时间 ${exportedAt} · ${summary.tagText} · ${summary.statusText} · 按${summary.sortText} · 共 ${items.length} 条`,
    '',
  ];
  if (!items.length) {
    lines.push('没有符合条件的任务', '');
    return lines.join('\n');
  }
  for (const it of items) {
    lines.push(`## #${it.index} ${it.status}`);
    lines.push('');
    const assetMap = (assetNamesByTask && assetNamesByTask[it.index]) || null;
    if (it.doc) {
      const mdBody = docToExportMarkdown(it.doc, includeImages ? assetMap : null);
      lines.push(mdBody || it.text);
      lines.push('');
    } else {
      lines.push(it.text);
      lines.push('');
      if (includeImages && assetMap) {
        for (const rel of (it.imageRels || [])) {
          const name = assetMap[rel];
          if (name) lines.push(`- ![](${name})`);
        }
        if (it.imageRels && it.imageRels.length) lines.push('');
      }
    }
    lines.push(`- 标签：${it.tags.length ? it.tags.join('、') : '无'}`);
    lines.push(`- 创建：${it.createdAt}`);
    lines.push(`- 状态：${it.statusAt}`);
    lines.push(`- 更新：${it.updatedAt}`);
    lines.push('');
  }
  return lines.join('\n');
}

function writeHtmlFile(filePath, tasks, tags, options, appDataDir) {
  const list = filterAndSortTasks(tasks, options);
  const model = buildDocumentModel(list, tags, options, appDataDir);
  fs.writeFileSync(filePath, renderHtmlDocument(model, { forPrint: false }), 'utf8');
  return { ok: true, path: filePath, count: list.length };
}

function writeMarkdownFile(filePath, tasks, tags, options, appDataDir) {
  const list = filterAndSortTasks(tasks, options);
  const model = buildDocumentModel(list, tags, options, appDataDir);

  const assetNamesByTask = Object.create(null);
  if (options.includeImages) {
    const base = path.basename(filePath, path.extname(filePath));
    const assetsDir = path.join(path.dirname(filePath), `${base}_assets`);
    fs.mkdirSync(assetsDir, { recursive: true });
    const used = new Set();
    list.forEach((t, idx) => {
      const index = idx + 1;
      const byRel = Object.create(null);
      for (const rel of exportImageRels(t)) {
        const name = copyImageAsset(appDataDir, rel, assetsDir, used);
        if (name) byRel[rel] = `${base}_assets/${name.replace(/\\/g, '/')}`;
      }
      assetNamesByTask[index] = byRel;
    });
  }

  fs.writeFileSync(filePath, renderMarkdown(model, assetNamesByTask), 'utf8');
  return { ok: true, path: filePath, count: list.length };
}

async function writePdfFile(filePath, tasks, tags, options, appDataDir, BrowserWindow) {
  const list = filterAndSortTasks(tasks, options);
  const model = buildDocumentModel(list, tags, options, appDataDir);
  const html = renderHtmlDocument(model, { forPrint: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-pdf-'));
  const tmpHtml = path.join(tmpDir, 'export.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadFile(tmpHtml);
    // 给内嵌图片一点解码时间
    await new Promise((r) => setTimeout(r, 300));
    const buf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    });
    fs.writeFileSync(filePath, buf);
    return { ok: true, path: filePath, count: list.length };
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = {
  filterAndSortTasks,
  formatTime,
  defaultExportName,
  buildDocumentModel,
  renderHtmlDocument,
  renderMarkdown,
  writeHtmlFile,
  writeMarkdownFile,
  writePdfFile,
  STATUS_LABEL,
  SORT_LABEL,
};
