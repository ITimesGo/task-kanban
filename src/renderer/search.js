/** 任务搜索：正文 + 附件名 [+ 可选图内 OCR 文字] */

const SOURCE_LABEL = {
  text: '正文',
  attachment: '附件',
  ocr: '图内文字',
};

/** 截取关键字附近片段，两端用 … */
function snippetAround(haystack, query, radius = 18) {
  const text = String(haystack == null ? '' : haystack).replace(/\s+/g, ' ').trim();
  const q = String(query == null ? '' : query).trim();
  if (!text || !q) return text.slice(0, radius * 2);
  const lower = text.toLowerCase();
  const qi = lower.indexOf(q.toLowerCase());
  if (qi < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, qi - radius);
  const end = Math.min(text.length, qi + q.length + radius);
  let out = text.slice(start, end);
  if (start > 0) out = `…${out}`;
  if (end < text.length) out = `${out}…`;
  return out;
}

function normalizeRel(rel) {
  return String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
}

function attachmentName(a) {
  if (typeof a === 'string') return a.split(/[/\\]/).pop() || a;
  if (a && typeof a === 'object') {
    return a.name || (a.rel ? String(a.rel).split(/[/\\]/).pop() : '') || '';
  }
  return '';
}

function imageRel(img) {
  if (typeof img === 'string') return normalizeRel(img);
  if (img && typeof img === 'object') return normalizeRel(img.rel || img.srcPath || '');
  return '';
}

/**
 * 每条命中单独列出（正文 / 各附件 / 各图 OCR）
 * @returns {null | {
 *   sources: Array<'text'|'attachment'|'ocr'>,
 *   hits: Array<{ source: string, label: string, snippet: string, query: string }>,
 *   primary: object
 * }}
 */
function taskMatchInfo(task, query, opts) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return null;
  const ql = q.toLowerCase();
  const hits = [];
  const sourceSet = new Set();

  const body = String(task && task.text != null ? task.text : '');
  if (body.toLowerCase().includes(ql)) {
    sourceSet.add('text');
    hits.push({ source: 'text', label: SOURCE_LABEL.text, snippet: snippetAround(body, q), query: q });
  }

  for (const a of (task && task.attachments) || []) {
    const name = attachmentName(a);
    if (!String(name).toLowerCase().includes(ql)) continue;
    sourceSet.add('attachment');
    hits.push({ source: 'attachment', label: SOURCE_LABEL.attachment, snippet: name, query: q });
  }

  const ocrMap = opts && opts.ocrTexts;
  if (ocrMap && typeof ocrMap === 'object') {
    for (const img of (task && task.images) || []) {
      const rel = imageRel(img);
      if (!rel) continue;
      const text = ocrMap[rel];
      if (!text || !String(text).toLowerCase().includes(ql)) continue;
      sourceSet.add('ocr');
      hits.push({
        source: 'ocr',
        label: SOURCE_LABEL.ocr,
        snippet: snippetAround(text, q),
        query: q,
      });
    }
  }

  if (!hits.length) return null;
  const sources = [...sourceSet];
  // primary：兼容旧调用；优先图内
  const primary = hits.find((h) => h.source === 'ocr')
    || hits.find((h) => h.source === 'attachment')
    || hits[0];
  return { sources, hits, primary };
}

function taskMatchesQuery(task, query, opts) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return true;
  return !!taskMatchInfo(task, query, opts);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { taskMatchesQuery, taskMatchInfo, snippetAround, SOURCE_LABEL };
}
