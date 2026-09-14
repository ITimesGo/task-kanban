/** 任务正文 doc（ProseMirror/TipTap 兼容 JSON）：合成、抽取、空判定、pending→rel */

const PENDING_PREFIX = 'pending:';

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isValidDoc(doc) {
  return isPlainObject(doc) && doc.type === 'doc' && Array.isArray(doc.content);
}

function walkNodes(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  const kids = node.content;
  if (Array.isArray(kids)) {
    for (const c of kids) walkNodes(c, visit);
  }
}

function extractPlainText(doc) {
  if (!isValidDoc(doc)) return '';
  const parts = [];
  function walk(node, depthList) {
    if (!node) return;
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    const kids = node.content || [];
    if (node.type === 'paragraph') {
      for (const c of kids) walk(c, depthList);
      parts.push('\n');
      return;
    }
    if (node.type === 'listItem') {
      for (const c of kids) walk(c, depthList);
      return;
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const c of kids) walk(c, depthList);
      return;
    }
    for (const c of kids) walk(c, depthList);
  }
  for (const c of doc.content) walk(c, 0);
  return parts.join('').replace(/\n+$/, '');
}

function extractMedia(doc) {
  if (!isValidDoc(doc)) return [];
  const out = [];
  const seen = new Set();
  walkNodes(doc, (node) => {
    if (node.type !== 'image' && node.type !== 'video') return;
    const src = node.attrs && node.attrs.src;
    if (src == null || src === '') return;
    const key = String(src);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      kind: node.type === 'video' ? 'video' : 'image',
      rel: key,
    });
  });
  return out;
}

function isDocVisuallyEmpty(doc) {
  if (!isValidDoc(doc)) return true;
  if (extractPlainText(doc).trim()) return false;
  let hasMedia = false;
  walkNodes(doc, (node) => {
    if (node.type === 'image' || node.type === 'video') hasMedia = true;
  });
  return !hasMedia;
}

function isTaskContentEmpty({ doc, attachments } = {}) {
  const atts = attachments || [];
  return isDocVisuallyEmpty(doc) && atts.length === 0;
}

function paragraphFromLine(line) {
  if (line === '') return { type: 'paragraph' };
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: line }],
  };
}

/** 旧 text + media → 临时 doc（不写盘） */
function legacyDocFromTask(task, mediaItemsFn) {
  const getItems = mediaItemsFn
    || (typeof taskMediaItems === 'function' ? taskMediaItems : null)
    || (() => {
      try { return require('./taskMedia').taskMediaItems; } catch (_) { return () => []; }
    })();

  const content = [];
  const raw = task && task.text != null ? String(task.text) : '';
  if (raw.length) {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    // 合并多余连续空行：最多保留一个空段
    let prevEmpty = false;
    for (const line of lines) {
      const empty = line === '';
      if (empty && prevEmpty) continue;
      content.push(paragraphFromLine(line));
      prevEmpty = empty;
    }
  }

  const items = typeof getItems === 'function' ? getItems(task) : [];
  for (const m of items || []) {
    if (!m || m.value == null || m.value === '') continue;
    const type = m.kind === 'video' ? 'video' : 'image';
    content.push({
      type,
      attrs: { src: String(m.value), alt: '' },
    });
  }

  return { type: 'doc', content };
}

function resolveTaskDoc(task, mediaItemsFn) {
  if (task && isValidDoc(task.doc)) return task.doc;
  return legacyDocFromTask(task, mediaItemsFn);
}

function pendingKey(index) {
  return PENDING_PREFIX + String(index);
}

function parsePendingIndex(src) {
  if (typeof src !== 'string' || !src.startsWith(PENDING_PREFIX)) return null;
  const n = Number(src.slice(PENDING_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 深拷贝 doc，把 pending:i 换成 rels[i]；已是 rel 的保持 */
function rewritePendingSrcs(doc, relByPendingIndex) {
  if (!isValidDoc(doc)) return { type: 'doc', content: [] };
  const map = relByPendingIndex || {};
  return mapDocMediaSrcs(doc, (src) => {
    const idx = parsePendingIndex(String(src));
    if (idx != null && map[idx] != null) return map[idx];
    return src;
  });
}

/** 深拷贝 doc，对 image/video 的 attrs.src 调用 mapFn(src, kind) */
function mapDocMediaSrcs(doc, mapFn) {
  if (!isValidDoc(doc)) return { type: 'doc', content: [] };
  const map = typeof mapFn === 'function' ? mapFn : (s) => s;
  function clone(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(clone);
    const out = { ...node };
    if (out.attrs && typeof out.attrs === 'object') {
      out.attrs = { ...out.attrs };
      if ((out.type === 'image' || out.type === 'video') && out.attrs.src != null) {
        const kind = out.type === 'video' ? 'video' : 'image';
        const next = map(String(out.attrs.src), kind);
        if (next != null) out.attrs.src = next;
      }
    }
    if (Array.isArray(out.content)) out.content = out.content.map(clone);
    return out;
  }
  return clone(doc);
}

function hasUnresolvedPendingSrcs(doc) {
  if (!isValidDoc(doc)) return false;
  let bad = false;
  walkNodes(doc, (node) => {
    if (node.type !== 'image' && node.type !== 'video') return;
    const src = node.attrs && node.attrs.src;
    if (src != null && parsePendingIndex(String(src)) != null) bad = true;
  });
  return bad;
}

function countMediaInDoc(doc) {
  let images = 0;
  let videos = 0;
  if (!isValidDoc(doc)) return { images, videos };
  walkNodes(doc, (node) => {
    if (node.type === 'image') images += 1;
    if (node.type === 'video') videos += 1;
  });
  return { images, videos };
}

function deriveFieldsFromDoc(doc) {
  const media = extractMedia(doc).map((m) => ({
    kind: m.kind,
    rel: m.rel && String(m.rel).startsWith(PENDING_PREFIX) ? m.rel : m.rel,
  }));
  // 仅保留已是 rel 的（非 pending）供持久化；调用方应先 rewrite
  const persisted = media.filter((m) => m.rel && !String(m.rel).startsWith(PENDING_PREFIX));
  const images = persisted.filter((m) => m.kind === 'image').map((m) => m.rel);
  const videos = persisted.filter((m) => m.kind === 'video').map((m) => m.rel);
  return {
    text: extractPlainText(doc),
    media: persisted,
    images,
    videos,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PENDING_PREFIX,
    isValidDoc,
    extractPlainText,
    extractMedia,
    isDocVisuallyEmpty,
    isTaskContentEmpty,
    legacyDocFromTask,
    resolveTaskDoc,
    pendingKey,
    parsePendingIndex,
    rewritePendingSrcs,
    mapDocMediaSrcs,
    hasUnresolvedPendingSrcs,
    countMediaInDoc,
    deriveFieldsFromDoc,
  };
}
