/** doc JSON ↔ HTML（编辑 / 只读 / 卡片预览） */

function docEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveMediaSrc(src, pendingPreview) {
  if (src == null || src === '') return '';
  const s = String(src);
  if (s.startsWith('data:') || s.startsWith('blob:') || /^https?:/i.test(s)) return s;
  if (s.startsWith('pending:')) {
    const idx = Number(s.slice('pending:'.length));
    const p = pendingPreview && pendingPreview[idx];
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (p.previewUrl) return p.previewUrl;
    return '';
  }
  if (typeof API !== 'undefined' && API.imageUrl) return API.imageUrl(s);
  return 'taskimage://local/' + s;
}

function clampDisplayWidth(n) {
  const w = Math.round(Number(n));
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.min(2400, Math.max(72, w));
}

function parseDisplayWidth(el) {
  if (!el || el.getAttribute == null) return 0;
  const raw = el.getAttribute('data-width');
  if (raw) return clampDisplayWidth(raw);
  const st = el.style && el.style.width;
  if (st && /px$/i.test(st)) return clampDisplayWidth(parseFloat(st));
  return 0;
}

function mediaWidthAttrs(width) {
  const w = clampDisplayWidth(width);
  if (!w) return { attr: '', style: '' };
  return { attr: ` data-width="${w}"`, style: ` style="width:${w}px"` };
}

function mediaNodeAttrs(src, extra) {
  const attrs = { src, alt: '' };
  const w = extra && extra.width;
  if (w) attrs.width = w;
  return attrs;
}

function marksOpen(marks) {
  let open = '';
  let close = '';
  for (const m of marks || []) {
    if (!m || !m.type) continue;
    if (m.type === 'bold') { open += '<strong>'; close = '</strong>' + close; }
    else if (m.type === 'italic') { open += '<em>'; close = '</em>' + close; }
    else if (m.type === 'link' && m.attrs && m.attrs.href) {
      const href = docEsc(m.attrs.href);
      open += `<a href="${href}" rel="noopener noreferrer">`;
      close = '</a>' + close;
    }
  }
  return { open, close };
}

function inlineToHtml(nodes) {
  let html = '';
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.type === 'hardBreak') { html += '<br>'; continue; }
    if (n.type === 'text') {
      const mk = marksOpen(n.marks);
      html += mk.open + docEsc(n.text) + mk.close;
    }
  }
  return html;
}

function nodeToHtml(node, opts) {
  if (!node) return '';
  const o = opts || {};
  if (node.type === 'paragraph') {
    const inner = inlineToHtml(node.content);
    return `<p>${inner || '<br>'}</p>`;
  }
  if (node.type === 'bulletList') {
    return `<ul>${(node.content || []).map((c) => nodeToHtml(c, o)).join('')}</ul>`;
  }
  if (node.type === 'orderedList') {
    return `<ol>${(node.content || []).map((c) => nodeToHtml(c, o)).join('')}</ol>`;
  }
  if (node.type === 'listItem') {
    return `<li>${(node.content || []).map((c) => nodeToHtml(c, o)).join('')}</li>`;
  }
  if (node.type === 'image') {
    const srcAttr = node.attrs && node.attrs.src;
    const url = resolveMediaSrc(srcAttr, o.pendingPreview);
    if (o.mediaLimit != null) {
      o._mediaCount = (o._mediaCount || 0) + 1;
      if (o._mediaCount > o.mediaLimit) return '';
    }
    if (!url && o.skipEmptyMedia) return '';
    const raw = docEsc(srcAttr || '');
    const sz = mediaWidthAttrs(node.attrs && node.attrs.width);
    return `<figure class="doc-media doc-image" contenteditable="false" data-src="${raw}"${sz.attr}${sz.style}><img src="${docEsc(url)}" alt=""></figure>`;
  }
  if (node.type === 'video') {
    const srcAttr = node.attrs && node.attrs.src;
    const url = resolveMediaSrc(srcAttr, o.pendingPreview);
    if (o.mediaLimit != null) {
      o._mediaCount = (o._mediaCount || 0) + 1;
      if (o._mediaCount > o.mediaLimit) return '';
    }
    if (!url && o.skipEmptyMedia) return '';
    const raw = docEsc(srcAttr || '');
    const sz = mediaWidthAttrs(node.attrs && node.attrs.width);
    // 列表预览：不挂真实 <video>，避免窗口恢复时批量解码卡住
    if (o.videoPlaceholder) {
      return `<figure class="doc-media doc-video is-placeholder" contenteditable="false" data-src="${raw}" data-kind="video"${sz.attr}${sz.style}><span class="doc-video-ph" aria-hidden="true"></span><span class="doc-play">▶</span></figure>`;
    }
    const videoAttrs = o.videoControls
      ? 'controls playsinline preload="metadata"'
      : 'muted playsinline preload="metadata"';
    const play = o.videoControls ? '' : '<span class="doc-play">▶</span>';
    return `<figure class="doc-media doc-video" contenteditable="false" data-src="${raw}" data-kind="video"${sz.attr}${sz.style}><video src="${docEsc(url)}" ${videoAttrs}></video>${play}</figure>`;
  }
  return '';
}

function docToHtml(doc, opts) {
  if (!isValidDoc(doc)) return '';
  const o = Object.assign({ _mediaCount: 0 }, opts || {});
  return (doc.content || []).map((n) => nodeToHtml(n, o)).join('');
}

function countDocMediaNodes(doc) {
  let n = 0;
  if (!isValidDoc(doc)) return 0;
  function walk(node) {
    if (!node) return;
    if (node.type === 'image' || node.type === 'video') n += 1;
    (node.content || []).forEach(walk);
  }
  (doc.content || []).forEach(walk);
  return n;
}

function cardDocPreviewHtml(task) {
  const doc = resolveTaskDoc(task);
  const totalMedia = countDocMediaNodes(doc);
  const html = docToHtml(doc, {
    mediaLimit: 4,
    skipEmptyMedia: true,
    linkAsSpan: true,
    videoPlaceholder: true,
  });
  const more = totalMedia > 4 ? `<span class="thumb-more">+${totalMedia - 4}</span>` : '';
  if (!html.trim() && !more) {
    return `<div class="doc-preview muted">（无文字）</div>`;
  }
  return `<div class="doc-preview">${html}${more}</div>`;
}

function detailDocHtml(task) {
  const doc = resolveTaskDoc(task);
  return `<div class="doc-view">${docToHtml(doc, { skipEmptyMedia: true, videoControls: true })}</div>`;
}

/* ---------- HTML → doc（编辑器序列化） ---------- */

function mediaSrcFromEl(el) {
  if (!el) return '';
  const raw = el.getAttribute('data-src')
    || el.getAttribute('src')
    || '';
  return String(raw || '').trim();
}

function mediaBlockFromEl(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName;
  if (tag === 'FIGURE' || (el.classList && el.classList.contains('doc-media'))) {
    const kind = el.getAttribute('data-kind') === 'video' || (el.classList && el.classList.contains('doc-video'))
      ? 'video' : 'image';
    const inner = el.querySelector('img,video');
    const src = mediaSrcFromEl(el) || mediaSrcFromEl(inner);
    if (!src) return null;
    return { type: kind, attrs: mediaNodeAttrs(src, { width: parseDisplayWidth(el) }) };
  }
  if (tag === 'IMG') {
    const src = mediaSrcFromEl(el);
    if (!src) return null;
    return { type: 'image', attrs: mediaNodeAttrs(src, { width: parseDisplayWidth(el) }) };
  }
  if (tag === 'VIDEO') {
    const src = mediaSrcFromEl(el);
    if (!src) return null;
    return { type: 'video', attrs: mediaNodeAttrs(src, { width: parseDisplayWidth(el) }) };
  }
  return null;
}

function parseMarks(el) {
  const marks = [];
  const seen = new Set();
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName;
    // 到块级为止，避免跨段误继承
    if (tag === 'P' || tag === 'LI' || tag === 'DIV' || tag === 'UL' || tag === 'OL'
      || tag === 'FIGURE' || tag === 'TD' || tag === 'TH' || tag === 'H1' || tag === 'H2'
      || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6' || tag === 'BLOCKQUOTE') {
      break;
    }
    if (tag === 'STRONG' || tag === 'B') {
      if (!seen.has('bold')) { marks.push({ type: 'bold' }); seen.add('bold'); }
    }
    if (tag === 'EM' || tag === 'I') {
      if (!seen.has('italic')) { marks.push({ type: 'italic' }); seen.add('italic'); }
    }
    if (tag === 'A' && cur.getAttribute('href')) {
      if (!seen.has('link')) {
        marks.push({ type: 'link', attrs: { href: cur.getAttribute('href') } });
        seen.add('link');
      }
    }
    const st = cur.style;
    if (st) {
      const w = st.fontWeight;
      if ((w === 'bold' || w === '700' || Number(w) >= 600) && !seen.has('bold')) {
        marks.push({ type: 'bold' });
        seen.add('bold');
      }
      if (st.fontStyle === 'italic' && !seen.has('italic')) {
        marks.push({ type: 'italic' });
        seen.add('italic');
      }
    }
    cur = cur.parentElement;
  }
  return marks;
}

function inlineFromNode(node, out) {
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    if (!text) return;
    const marks = parseMarks(node.parentElement);
    const item = { type: 'text', text };
    if (marks.length) item.marks = marks;
    out.push(item);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (tag === 'BR') { out.push({ type: 'hardBreak' }); return; }
  if (tag === 'FIGURE' || tag === 'IMG' || tag === 'VIDEO' || (node.classList && node.classList.contains('doc-media'))) {
    return;
  }
  for (const c of node.childNodes) inlineFromNode(c, out);
}

/** 将容器子节点展开为顶层 block（媒体即使嵌在 p/div 里也会提出来） */
function appendBlocksFromContainer(container, content) {
  if (!container) return;
  let inlineBuf = [];
  function flushInline() {
    if (!inlineBuf.length) return;
    const onlyBreaks = inlineBuf.every((n) => n.type === 'hardBreak');
    const textEmpty = inlineBuf.every((n) => n.type !== 'text' || !String(n.text || '').trim());
    if (!(onlyBreaks && textEmpty)) {
      content.push({ type: 'paragraph', content: inlineBuf });
    }
    inlineBuf = [];
  }
  function pushTextNode(textNode) {
    const t = textNode && textNode.nodeValue;
    if (t == null || t === '') return;
    if (!t.trim()) return;
    const marks = parseMarks(textNode.parentElement);
    const item = { type: 'text', text: t };
    if (marks.length) item.marks = marks;
    inlineBuf.push(item);
  }
  for (const child of container.childNodes) {
    if (child.nodeType === 3) {
      pushTextNode(child);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const media = mediaBlockFromEl(child);
    if (media) {
      flushInline();
      content.push(media);
      continue;
    }
    const tag = child.tagName;
    if (tag === 'UL') {
      flushInline();
      content.push({
        type: 'bulletList',
        content: Array.from(child.children).filter((c) => c.tagName === 'LI').map((li) => ({
          type: 'listItem',
          content: listItemBlocksSimple(li),
        })),
      });
      continue;
    }
    if (tag === 'OL') {
      flushInline();
      content.push({
        type: 'orderedList',
        content: Array.from(child.children).filter((c) => c.tagName === 'LI').map((li) => ({
          type: 'listItem',
          content: listItemBlocksSimple(li),
        })),
      });
      continue;
    }
    if (tag === 'BR') {
      inlineBuf.push({ type: 'hardBreak' });
      continue;
    }
    // 行内格式标签：直接抽文本+marks，避免再包一层空 paragraph 丢掉样式
    if (tag === 'B' || tag === 'STRONG' || tag === 'I' || tag === 'EM' || tag === 'A' || tag === 'SPAN' || tag === 'FONT') {
      inlineFromNode(child, inlineBuf);
      continue;
    }
    // 块级：每个 p/div 独立成段，禁止合并进 inlineBuf（否则换行保存后变成一行）
    if (tag === 'P' || tag === 'DIV' || tag === 'H1' || tag === 'H2' || tag === 'H3'
      || tag === 'H4' || tag === 'H5' || tag === 'H6' || tag === 'BLOCKQUOTE'
      || tag === 'SECTION' || tag === 'ARTICLE') {
      flushInline();
      const nested = [];
      appendBlocksFromContainer(child, nested);
      if (!nested.length) {
        content.push({ type: 'paragraph' });
      } else {
        for (const n of nested) content.push(n);
      }
      continue;
    }
    // 其它容器：内部可能还有图
    if (child.childNodes && child.childNodes.length) {
      const before = content.length;
      const nested = [];
      appendBlocksFromContainer(child, nested);
      const hasMedia = nested.some((n) => n.type === 'image' || n.type === 'video');
      if (!hasMedia && nested.length === 1 && nested[0].type === 'paragraph') {
        for (const n of (nested[0].content || [])) inlineBuf.push(n);
      } else if (!nested.length) {
        inlineFromNode(child, inlineBuf);
      } else {
        flushInline();
        for (const n of nested) content.push(n);
      }
      if (content.length === before && !nested.length) {
        inlineFromNode(child, inlineBuf);
      }
      continue;
    }
    inlineFromNode(child, inlineBuf);
  }
  flushInline();
}

function listItemBlocksSimple(li) {
  const content = [];
  appendBlocksFromContainer(li, content);
  // 保留段落、媒体与嵌套列表（缩进 ul/ol），避免保存时静默丢内容
  const blocks = content.filter((n) =>
    n && (n.type === 'paragraph' || n.type === 'image' || n.type === 'video'
      || n.type === 'bulletList' || n.type === 'orderedList')
  );
  if (!blocks.length) return [{ type: 'paragraph' }];
  return blocks;
}

function htmlRootToDoc(root) {
  const content = [];
  if (!root) return { type: 'doc', content: [{ type: 'paragraph' }] };
  appendBlocksFromContainer(root, content);
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    docToHtml,
    htmlRootToDoc,
    cardDocPreviewHtml,
    detailDocHtml,
    resolveMediaSrc,
    countDocMediaNodes,
    clampDisplayWidth,
  };
}
