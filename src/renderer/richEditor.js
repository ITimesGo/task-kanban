/** 轻量富文本编辑器：白名单工具栏 + contenteditable，序列化为 doc JSON */

function createRichEditor(host, options) {
  const opts = options || {};
  const pending = []; // { kind, value, previewUrl }
  let onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

  host.innerHTML = '';
  host.classList.add('rich-editor');

  const bar = document.createElement('div');
  bar.className = 'rich-toolbar';
  bar.innerHTML = [
    ['bold', 'B', '加粗'],
    ['italic', 'I', '斜体'],
    ['ul', '• 列表', '无序列表'],
    ['ol', '1. 列表', '有序列表'],
    ['image', '图片', '插入图片/视频'],
  ].map(([cmd, label, title]) =>
    `<button type="button" class="rich-tb" data-cmd="${cmd}" title="${title}">${label}</button>`
  ).join('');

  const surface = document.createElement('div');
  surface.className = 'rich-surface';
  surface.contentEditable = 'true';
  surface.dataset.placeholder = opts.placeholder || '输入任务描述，可插入图片…';
  surface.innerHTML = '<p><br></p>';

  host.appendChild(bar);
  host.appendChild(surface);

  function emit() { onChange(); }

  function getPendingPreviewMap() {
    const map = {};
    pending.forEach((p, i) => { map[i] = p; });
    return map;
  }

  function mediaCounts() {
    const doc = getDoc();
    return countMediaInDoc(doc);
  }

  function canAddImage() {
    return countMediaInDoc(getDoc()) /* recount kinds */ || true;
  }

  function countKinds() {
    let images = 0;
    let videos = 0;
    const doc = getDoc();
    function walk(n) {
      if (!n) return;
      if (n.type === 'image') images += 1;
      if (n.type === 'video') videos += 1;
      (n.content || []).forEach(walk);
    }
    (doc.content || []).forEach(walk);
    return { images, videos };
  }

  /** 每张图/视频前后及文首文末保证有可落点的段落 */
  function ensureCaretSinks() {
    if (!surface.firstChild) {
      surface.innerHTML = '<p><br></p>';
      return;
    }
    const mediaNodes = [...surface.querySelectorAll('figure.doc-media')];
    for (const fig of mediaNodes) {
      const prev = fig.previousElementSibling;
      if (!prev || prev.tagName !== 'P') {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        fig.before(p);
      }
      const next = fig.nextElementSibling;
      if (!next || next.tagName !== 'P') {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        fig.after(p);
      }
    }
    if (surface.firstElementChild && surface.firstElementChild.classList.contains('doc-media')) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      surface.insertBefore(p, surface.firstElementChild);
    }
    const last = surface.lastElementChild;
    if (last && last.classList && last.classList.contains('doc-media')) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      surface.appendChild(p);
    }
  }

  function placeCaretIn(el, atEnd) {
    if (!el) return;
    surface.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function prepMediaFig(fig) {
    if (!fig) return;
    fig.contentEditable = 'false';
    fig.setAttribute('draggable', 'false');
    const media = fig.querySelector('img, video');
    if (media) {
      media.setAttribute('draggable', 'false');
      media.setAttribute('data-no-drag', '1');
    }
  }

  function ensureMediaAttrs() {
    surface.querySelectorAll('figure.doc-media').forEach((fig) => {
      prepMediaFig(fig);
      if (fig.getAttribute('data-src')) return;
      const media = fig.querySelector('img, video');
      const s = (media && (media.getAttribute('src') || media.currentSrc)) || '';
      if (s) fig.setAttribute('data-src', s);
    });
    surface.querySelectorAll('img, video').forEach((el) => {
      if (el.closest('figure.doc-media')) return;
      const src = el.getAttribute('src') || el.currentSrc || '';
      if (!src) return;
      const kind = el.tagName === 'VIDEO' ? 'video' : 'image';
      const fig = document.createElement('figure');
      fig.className = 'doc-media ' + (kind === 'video' ? 'doc-video' : 'doc-image');
      fig.setAttribute('data-src', src);
      if (kind === 'video') fig.setAttribute('data-kind', 'video');
      el.replaceWith(fig);
      fig.appendChild(el);
      prepMediaFig(fig);
    });
    ensureCaretSinks();
  }

  function insertMediaNode(kind, value) {
    const counts = countKinds();
    if (kind === 'video') {
      if (counts.videos >= (typeof MAX_NEW_VIDEOS !== 'undefined' ? MAX_NEW_VIDEOS : 3)) {
        alert('最多添加3个视频');
        return false;
      }
    } else if (counts.images >= (typeof MAX_NEW_IMAGES !== 'undefined' ? MAX_NEW_IMAGES : 10)) {
      alert('最多添加10张图片');
      return false;
    }
    if (value && typeof value === 'object' && value.srcPath && typeof API !== 'undefined' && API.allowMediaSrcPath) {
      try { API.allowMediaSrcPath(value.srcPath); } catch (_) { /* ignore */ }
    }
    let previewUrl = '';
    if (typeof value === 'string' && value.startsWith('data:')) previewUrl = value;
    else if (value && value.previewUrl) previewUrl = value.previewUrl;
    else if (typeof API !== 'undefined' && API.mediaSrc) {
      previewUrl = API.mediaSrc(value, kind === 'video' ? 'video' : 'image') || '';
    } else if (typeof value === 'string' && !value.startsWith('pending:') && API.imageUrl) {
      previewUrl = API.imageUrl(value);
    }
    const idx = pending.length;
    pending.push({
      kind: kind === 'video' ? 'video' : 'image',
      value,
      previewUrl: previewUrl || (typeof value === 'string' && value.startsWith('data:') ? value : ''),
    });
    const src = pendingKey(idx);
    const html = kind === 'video'
      ? `<figure class="doc-media doc-video" contenteditable="false" data-src="${src}" data-kind="video"><video src="${previewUrl || ''}" muted playsinline preload="metadata"></video><span class="doc-play">▶</span></figure>`
      : `<figure class="doc-media doc-image" contenteditable="false" data-src="${src}"><img src="${previewUrl || ''}" alt=""></figure>`;
    surface.focus();
    try {
      document.execCommand('insertHTML', false, html + '<p><br></p>');
    } catch (_) {
      surface.insertAdjacentHTML('beforeend', html + '<p><br></p>');
    }
    ensureMediaAttrs();
    ensureCaretSinks();
    const fig = surface.querySelector(`figure.doc-media[data-src="${src}"]`);
    if (fig) selectMedia(fig);
    emit();
    return true;
  }

  function insertExistingRel(kind, rel) {
    const counts = countKinds();
    if (kind === 'video' && counts.videos >= 3) { alert('最多添加3个视频'); return false; }
    if (kind !== 'video' && counts.images >= 10) { alert('最多添加10张图片'); return false; }
    const url = API.imageUrl ? API.imageUrl(rel) : rel;
    const html = kind === 'video'
      ? `<figure class="doc-media doc-video" contenteditable="false" data-src="${rel}" data-kind="video"><video src="${url}" muted playsinline preload="metadata"></video><span class="doc-play">▶</span></figure>`
      : `<figure class="doc-media doc-image" contenteditable="false" data-src="${rel}"><img src="${url}" alt=""></figure>`;
    surface.focus();
    try { document.execCommand('insertHTML', false, html + '<p><br></p>'); }
    catch (_) { surface.insertAdjacentHTML('beforeend', html + '<p><br></p>'); }
    ensureMediaAttrs();
    ensureCaretSinks();
    const figs = surface.querySelectorAll('figure.doc-media');
    if (figs.length) selectMedia(figs[figs.length - 1]);
    emit();
    return true;
  }

  function selectionInEditor() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return false;
    return surface.contains(sel.anchorNode);
  }

  function selectionInTag(tags) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let n = sel.anchorNode;
    if (!n) return false;
    if (n.nodeType === 3) n = n.parentElement;
    if (!n || !surface.contains(n)) return false;
    return !!(n.closest && n.closest(tags));
  }

  function selectionAnchorEl() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let n = sel.anchorNode;
    if (n.nodeType === 3) n = n.parentElement;
    if (!n || !surface.contains(n)) return null;
    return n;
  }

  /** 换行后常落在空的 b/strong/em 或 style 包裹里，queryCommandState 仍为 true */
  function closestInlineFormat(kind) {
    let el = selectionAnchorEl();
    while (el && el !== surface) {
      if (el.nodeType === 1) {
        const tag = el.tagName;
        if (kind === 'bold') {
          if (tag === 'B' || tag === 'STRONG') return el;
          const w = el.style && el.style.fontWeight;
          if (w === 'bold' || w === '700' || Number(w) >= 600) return el;
        }
        if (kind === 'italic') {
          if (tag === 'I' || tag === 'EM') return el;
          if (el.style && el.style.fontStyle === 'italic') return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function placeCaret(node, offset) {
    const sel = window.getSelection();
    if (!sel || !node) return;
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function unwrapNode(el) {
    const parent = el.parentNode;
    if (!parent) return null;
    const marker = document.createTextNode('');
    parent.insertBefore(marker, el);
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
    return marker;
  }

  function visibleText(el) {
    return (el && el.textContent || '').replace(/\u200b/g, '').trim();
  }

  function currentBlockEl() {
    let el = selectionAnchorEl();
    while (el && el !== surface) {
      if (el.nodeType === 1 && /^(P|DIV|LI|H[1-6])$/i.test(el.tagName)) return el;
      el = el.parentElement;
    }
    return surface.querySelector('p') || surface;
  }

  function inlineSelector(kind) {
    return kind === 'bold' ? 'b,strong' : 'i,em';
  }

  function unwrapEmptyInlines(kind, root) {
    const scope = root || surface;
    [...scope.querySelectorAll(inlineSelector(kind))].forEach((el) => {
      if (!el.isConnected) return;
      if (visibleText(el) || el.querySelector('img,video')) return;
      unwrapNode(el);
    });
  }

  function placeCaretInside(el) {
    if (!el) return;
    surface.focus();
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * 当前块没有可见文字时：不用 execCommand（typing style 选中零宽字符再 toggle
   * 反而会加粗选区，关不掉）。改为手写 <b>/<em> 壳，关闭时拆壳并重置块。
   */
  function toggleInlineEmpty(kind) {
    const cmd = kind === 'bold' ? 'bold' : 'italic';
    const block = currentBlockEl();
    const hasShell = !!(closestInlineFormat(kind) || (block && block.querySelector(inlineSelector(kind))));

    if (hasShell) {
      unwrapEmptyInlines(kind, block);
      unwrapEmptyInlines(kind, surface);
      if (block && block !== surface) {
        block.innerHTML = '<br>';
        placeCaretIn(block, false);
      } else {
        surface.innerHTML = '<p><br></p>';
        placeCaretIn(surface.querySelector('p'), false);
      }
      try {
        if (document.queryCommandState(cmd)) document.execCommand(cmd);
      } catch (_) {}
      try {
        if (document.queryCommandState(cmd)) {
          surface.contentEditable = 'false';
          void surface.offsetWidth;
          surface.contentEditable = 'true';
          surface.focus();
          const p = surface.querySelector('p') || block;
          if (p) {
            if (!p.querySelector('br') && !visibleText(p)) p.innerHTML = '<br>';
            placeCaretIn(p, false);
          }
          if (document.queryCommandState(cmd)) document.execCommand(cmd);
        }
      } catch (_) {}
      return;
    }

    // 无壳：先清残留 typing style，再显式插入壳（保证能再次关掉）
    try {
      if (document.queryCommandState(cmd)) {
        surface.contentEditable = 'false';
        void surface.offsetWidth;
        surface.contentEditable = 'true';
        surface.focus();
        const p = (block && block !== surface ? block : surface.querySelector('p')) || surface;
        if (p && p !== surface && !visibleText(p)) p.innerHTML = '<br>';
        placeCaretIn(p === surface ? (surface.querySelector('p') || surface) : p, false);
        if (document.queryCommandState(cmd)) document.execCommand(cmd);
      }
    } catch (_) {}

    const target = block && block !== surface ? block : (surface.querySelector('p') || surface);
    const el = document.createElement(kind === 'bold' ? 'b' : 'em');
    el.appendChild(document.createElement('br'));
    target.innerHTML = '';
    target.appendChild(el);
    placeCaretInside(el);
  }

  function isEmptyEditingContext() {
    if (!visibleText(surface)) return true;
    const block = currentBlockEl();
    return !!(block && !visibleText(block));
  }

  function isInlineOn(kind) {
    if (closestInlineFormat(kind)) return true;
    // 空块无 DOM 壳时不采信 queryCommandState，否则高亮会永久卡死
    if (isEmptyEditingContext()) {
      const block = currentBlockEl();
      return !!(block && block.querySelector(inlineSelector(kind)));
    }
    try {
      if (kind === 'bold' && document.queryCommandState('bold')) return true;
      if (kind === 'italic' && document.queryCommandState('italic')) return true;
    } catch (_) {}
    return false;
  }

  /** 折叠光标退出加粗/斜体（解决换行继承后 execCommand 关不掉） */
  function exitInlineFormat(kind) {
    const wrap = closestInlineFormat(kind);
    if (!wrap) return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const emptyText = !visibleText(wrap);

    if (emptyText) {
      const marker = unwrapNode(wrap);
      if (marker) placeCaret(marker, 0);
      return true;
    }

    if (!range.collapsed) {
      try { document.execCommand(kind === 'bold' ? 'bold' : 'italic'); } catch (_) {}
      if (isInlineOn(kind) && closestInlineFormat(kind)) {
        const marker = unwrapNode(wrap);
        if (marker) placeCaret(marker, 0);
      }
      return true;
    }

    const afterRange = document.createRange();
    afterRange.setStart(range.startContainer, range.startOffset);
    afterRange.setEnd(wrap, wrap.childNodes.length);
    const trailing = afterRange.extractContents();

    const marker = document.createTextNode('');
    if (wrap.nextSibling) wrap.parentNode.insertBefore(marker, wrap.nextSibling);
    else wrap.parentNode.appendChild(marker);

    if (trailing.childNodes.length) {
      const tail = wrap.cloneNode(false);
      tail.appendChild(trailing);
      if (!visibleText(tail) && !tail.querySelector('img,video')) {
        while (tail.firstChild) marker.parentNode.insertBefore(tail.firstChild, marker.nextSibling);
      } else {
        marker.parentNode.insertBefore(tail, marker.nextSibling);
      }
    }

    if (!visibleText(wrap) && !wrap.querySelector('img,video')) {
      wrap.remove();
    }

    placeCaret(marker, 0);
    return true;
  }

  function toggleInline(kind) {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    // 无文字：完全手写开关，避开 execCommand typing style 关不掉的问题
    if (isEmptyEditingContext()) {
      toggleInlineEmpty(kind);
      return;
    }
    const on = isInlineOn(kind);
    if (!on) {
      document.execCommand(kind === 'bold' ? 'bold' : 'italic');
      return;
    }
    const wrap = closestInlineFormat(kind);
    const empty = wrap && !visibleText(wrap);
    if (empty) {
      exitInlineFormat(kind);
      if (isInlineOn(kind) && isEmptyEditingContext()) toggleInlineEmpty(kind);
      return;
    }
    document.execCommand(kind === 'bold' ? 'bold' : 'italic');
    if (isInlineOn(kind)) exitInlineFormat(kind);
    if (isInlineOn(kind) && isEmptyEditingContext()) toggleInlineEmpty(kind);
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return null;
    return range.cloneRange();
  }

  function restoreSelection(range) {
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function clearToolbarActive() {
    bar.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  function syncToolbarState() {
    if (!selectionInEditor()) {
      clearToolbarActive();
      return;
    }
    const map = {
      bold: () => isInlineOn('bold'),
      italic: () => isInlineOn('italic'),
      ul: () => {
        try { if (document.queryCommandState('insertUnorderedList')) return true; } catch (_) {}
        return selectionInTag('ul');
      },
      ol: () => {
        try { if (document.queryCommandState('insertOrderedList')) return true; } catch (_) {}
        return selectionInTag('ol');
      },
    };
    bar.querySelectorAll('[data-cmd]').forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (!map[cmd]) {
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
        return;
      }
      let on = false;
      try { on = !!map[cmd](); } catch (_) { on = false; }
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function runFormat(cmd) {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    if (cmd === 'bold') toggleInline('bold');
    else if (cmd === 'italic') toggleInline('italic');
    else if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    else if (cmd === 'image') {
      if (typeof opts.onPickMedia === 'function') opts.onPickMedia();
    }
  }

  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-cmd]')) e.preventDefault();
  });

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    const saved = saveSelection();
    surface.focus();
    restoreSelection(saved);
    runFormat(cmd);
    requestAnimationFrame(() => syncToolbarState());
    emit();
  });

  surface.addEventListener('keyup', syncToolbarState);
  surface.addEventListener('mouseup', syncToolbarState);
  surface.addEventListener('focus', syncToolbarState);
  surface.addEventListener('blur', () => {
    // 点工具栏时 surface 不失焦；真正失焦时清掉高亮
    setTimeout(() => {
      if (document.activeElement === surface) return;
      if (bar.contains(document.activeElement)) return;
      if (!selectionInEditor()) clearToolbarActive();
    }, 0);
  });
  document.addEventListener('selectionchange', syncToolbarState);

  surface.addEventListener('input', () => {
    ensureMediaAttrs();
    ensureCaretSinks();
    emit();
  });
  let selectedMedia = null;
  let resizeDrag = null;
  let mediaMove = null; // { fig, startX, startY, active, dropBefore, lastX, lastY }
  let dropLine = null;
  let mediaAutoScrollRaf = 0;
  let destroyed = false;

  function mediaMaxWidth() {
    return Math.max(160, (surface.clientWidth || 280) - 16);
  }

  function ensureDropLine() {
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'doc-drop-line';
      dropLine.setAttribute('aria-hidden', 'true');
    }
    if (dropLine.parentNode !== surface) surface.appendChild(dropLine);
    return dropLine;
  }

  function clearDropIndicator() {
    if (!dropLine) return;
    dropLine.classList.remove('is-visible');
    if (mediaMove) mediaMove.dropBefore = null;
  }

  function stopMediaAutoScroll() {
    if (mediaAutoScrollRaf) {
      cancelAnimationFrame(mediaAutoScrollRaf);
      mediaAutoScrollRaf = 0;
    }
  }

  function tickMediaAutoScroll() {
    mediaAutoScrollRaf = 0;
    if (!mediaMove || !mediaMove.active) return;
    const maxScroll = surface.scrollHeight - surface.clientHeight;
    if (maxScroll <= 0) return;

    const rect = surface.getBoundingClientRect();
    const y = mediaMove.lastY;
    const edge = Math.min(48, Math.max(28, rect.height * 0.18));
    let delta = 0;
    if (y < rect.top + edge) {
      const t = Math.min(1, (rect.top + edge - y) / edge);
      delta = -Math.ceil(4 + t * 18);
    } else if (y > rect.bottom - edge) {
      const t = Math.min(1, (y - (rect.bottom - edge)) / edge);
      delta = Math.ceil(4 + t * 18);
    }
    if (!delta) return;

    const prev = surface.scrollTop;
    surface.scrollTop = Math.max(0, Math.min(maxScroll, prev + delta));
    if (surface.scrollTop !== prev) {
      updateDropIndicator(mediaMove.lastX, mediaMove.lastY);
    }
    mediaAutoScrollRaf = requestAnimationFrame(tickMediaAutoScroll);
  }

  function syncMediaAutoScroll(x, y) {
    if (!mediaMove || !mediaMove.active) {
      stopMediaAutoScroll();
      return;
    }
    mediaMove.lastX = x;
    mediaMove.lastY = y;
    const maxScroll = surface.scrollHeight - surface.clientHeight;
    if (maxScroll <= 0) {
      stopMediaAutoScroll();
      return;
    }
    const rect = surface.getBoundingClientRect();
    const edge = Math.min(48, Math.max(28, rect.height * 0.18));
    const nearEdge = y < rect.top + edge || y > rect.bottom - edge;
    if (nearEdge) {
      if (!mediaAutoScrollRaf) mediaAutoScrollRaf = requestAnimationFrame(tickMediaAutoScroll);
    } else {
      stopMediaAutoScroll();
    }
  }

  function isDropLineEl(el) {
    return !!(el && (el === dropLine || (el.classList && el.classList.contains('doc-drop-line'))));
  }

  function nextContentSibling(el) {
    let n = el ? el.nextElementSibling : null;
    while (n && isDropLineEl(n)) n = n.nextElementSibling;
    return n;
  }

  function prevContentSibling(el) {
    let n = el ? el.previousElementSibling : null;
    while (n && isDropLineEl(n)) n = n.previousElementSibling;
    return n;
  }

  function surfaceBlockFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (let i = 0; i < stack.length; i++) {
      const el = stack[i];
      if (!el || el === surface || isDropLineEl(el)) continue;
      let node = el;
      while (node && node.parentElement !== surface) node = node.parentElement;
      if (node && node.parentElement === surface && !isDropLineEl(node)) return node;
    }
    // 落在编辑区空白：按 Y 找最近的块
    const sRect = surface.getBoundingClientRect();
    const localY = y - sRect.top + surface.scrollTop;
    const kids = [...surface.children].filter((c) => !isDropLineEl(c));
    if (!kids.length) return null;
    let best = kids[kids.length - 1];
    let bestDist = Infinity;
    for (let i = 0; i < kids.length; i++) {
      const top = kids[i].offsetTop;
      const bottom = top + kids[i].offsetHeight;
      if (localY >= top && localY <= bottom) return kids[i];
      const dist = localY < top ? top - localY : localY - bottom;
      if (dist < bestDist) {
        bestDist = dist;
        best = kids[i];
      }
    }
    return best;
  }

  function placeDropLineAt(block, before) {
    const line = ensureDropLine();
    const sRect = surface.getBoundingClientRect();
    const bRect = block.getBoundingClientRect();
    const top = (before ? bRect.top : bRect.bottom) - sRect.top + surface.scrollTop;
    line.style.top = Math.max(0, top - 1) + 'px';
    line.classList.add('is-visible');
  }

  function updateDropIndicator(x, y) {
    if (!mediaMove || !mediaMove.active) return;
    const fig = mediaMove.fig;
    const block = surfaceBlockFromPoint(x, y);
    if (!block || block === fig) {
      clearDropIndicator();
      return;
    }
    const rect = block.getBoundingClientRect();
    // 空段很矮，用更大滞回，避免插入线导致 before/after 来回跳
    const h = Math.max(1, rect.height);
    const ratio = (y - rect.top) / h;
    let before;
    const prev = mediaMove.dropBefore;
    if (prev && prev.ref === block) {
      before = prev.before;
      if (before && ratio > 0.72) before = false;
      else if (!before && ratio < 0.28) before = true;
    } else {
      before = ratio < 0.5;
    }
    // 已在相邻位置则不显示
    if (before && nextContentSibling(fig) === block) {
      clearDropIndicator();
      return;
    }
    if (!before && prevContentSibling(fig) === block) {
      clearDropIndicator();
      return;
    }
    // 目标未变则只更新位置，避免无意义重绘
    if (prev && prev.ref === block && prev.before === before) {
      placeDropLineAt(block, before);
      return;
    }
    placeDropLineAt(block, before);
    mediaMove.dropBefore = { ref: block, before };
  }

  function commitMediaMove() {
    if (!mediaMove || !mediaMove.active || !mediaMove.dropBefore) return false;
    const { fig } = mediaMove;
    const { ref, before } = mediaMove.dropBefore;
    if (!fig || !ref || !surface.contains(fig) || !surface.contains(ref)) return false;
    if (before) ref.before(fig);
    else ref.after(fig);
    selectMedia(fig);
    return true;
  }

  function endMediaMove() {
    if (!mediaMove) return;
    const fig = mediaMove.fig;
    const wasActive = mediaMove.active;
    let moved = false;
    stopMediaAutoScroll();
    if (wasActive) {
      moved = commitMediaMove();
      if (fig) fig.classList.remove('is-dragging');
      document.body.classList.remove('is-media-dragging');
      clearDropIndicator();
      ensureCaretSinks();
      if (!moved && fig && surface.contains(fig)) selectMedia(fig);
      emit();
    }
    mediaMove = null;
  }

  function applyMediaWidth(fig, width) {
    const max = mediaMaxWidth();
    const w = typeof clampDisplayWidth === 'function'
      ? clampDisplayWidth(Math.min(max, width))
      : Math.round(Math.min(max, Math.max(72, width)));
    if (!w) return;
    fig.setAttribute('data-width', String(w));
    fig.style.width = w + 'px';
  }

  function mediaBox(fig) {
    const media = fig.querySelector('img, video');
    const fw = fig.offsetWidth || 1;
    const fh = fig.offsetHeight || 1;
    let nw = 0;
    let nh = 0;
    if (media) {
      if (media.tagName === 'IMG') {
        nw = media.naturalWidth || 0;
        nh = media.naturalHeight || 0;
      } else {
        nw = media.videoWidth || 0;
        nh = media.videoHeight || 0;
      }
    }
    const aspect = (nw > 0 && nh > 0) ? (nw / nh) : (fw / Math.max(1, fh));
    return { startW: fw, startH: fh, aspect };
  }

  function startResize(fig, dir, e) {
    applyMediaWidth(fig, fig.offsetWidth);
    const box = mediaBox(fig);
    resizeDrag = {
      fig,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: box.startW,
      startH: box.startH,
      aspect: box.aspect,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizeMove(e) {
    if (!resizeDrag) return;
    const { fig, dir, startX, startY, startW, startH, aspect } = resizeDrag;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const signX = (dir === 'se' || dir === 'ne') ? 1 : -1;
    const signY = (dir === 'se' || dir === 'sw') ? 1 : -1;
    const fromX = startW + dx * signX;
    const fromY = (startH + dy * signY) * (aspect || 1);
    const w = Math.abs(dx) >= Math.abs(dy) ? fromX : fromY;
    applyMediaWidth(fig, w);
  }

  function clearMediaChrome(fig) {
    if (!fig) return;
    fig.querySelectorAll('.doc-media-chrome').forEach((el) => el.remove());
    fig.classList.remove('is-selected');
  }

  function deselectMedia() {
    if (selectedMedia) clearMediaChrome(selectedMedia);
    selectedMedia = null;
  }

  function removeMediaFig(fig) {
    if (!fig || !surface.contains(fig)) return;
    const next = fig.nextElementSibling;
    const prev = fig.previousElementSibling;
    fig.remove();
    deselectMedia();
    ensureCaretSinks();
    if (next) placeCaretIn(next, false);
    else if (prev) placeCaretIn(prev, true);
    emit();
  }

  function selectMedia(fig) {
    if (!fig || !surface.contains(fig)) return;
    if (selectedMedia === fig) return;
    deselectMedia();
    selectedMedia = fig;
    fig.classList.add('is-selected');
    const chrome = document.createElement('div');
    chrome.className = 'doc-media-chrome';
    const isVideo = fig.classList.contains('doc-video') || fig.getAttribute('data-kind') === 'video';
    chrome.innerHTML =
      `<button type="button" class="doc-media-del" title="${isVideo ? '删除视频' : '删除图片'}">×</button>` +
      '<span class="doc-resize nw" data-dir="nw"></span>' +
      '<span class="doc-resize ne" data-dir="ne"></span>' +
      '<span class="doc-resize sw" data-dir="sw"></span>' +
      '<span class="doc-resize se" data-dir="se"></span>';
    fig.appendChild(chrome);
    const vid = fig.querySelector('video');
    if (vid && !vid.videoWidth) {
      vid.addEventListener('loadedmetadata', () => {
        if (selectedMedia === fig && !fig.getAttribute('data-width')) {
          applyMediaWidth(fig, fig.offsetWidth);
        }
      }, { once: true });
    }
  }

  function onResizeEnd() {
    if (!resizeDrag) return;
    resizeDrag = null;
    document.body.classList.remove('is-media-resizing');
    emit();
  }

  function onMediaPointerMove(e) {
    if (!mediaMove || resizeDrag) return;
    if (e.pointerId != null && mediaMove.pointerId != null && e.pointerId !== mediaMove.pointerId) return;
    const dx = e.clientX - mediaMove.startX;
    const dy = e.clientY - mediaMove.startY;
    if (!mediaMove.active) {
      if ((dx * dx) + (dy * dy) < 36) return; // 约 6px 才算开始拖
      mediaMove.active = true;
      document.body.classList.add('is-media-dragging');
      deselectMedia(); // 拖动时先收起缩放角，避免抢手势
      mediaMove.fig.classList.add('is-dragging');
    }
    e.preventDefault();
    mediaMove.lastX = e.clientX;
    mediaMove.lastY = e.clientY;
    updateDropIndicator(e.clientX, e.clientY);
    syncMediaAutoScroll(e.clientX, e.clientY);
  }

  function onMediaPointerUp(e) {
    if (!mediaMove) return;
    if (e.pointerId != null && mediaMove.pointerId != null && e.pointerId !== mediaMove.pointerId) return;
    endMediaMove();
  }

  function onMediaPointerCancel() {
    if (!mediaMove) return;
    stopMediaAutoScroll();
    if (mediaMove.fig) mediaMove.fig.classList.remove('is-dragging');
    document.body.classList.remove('is-media-dragging');
    clearDropIndicator();
    mediaMove = null;
  }

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
  document.addEventListener('pointermove', onMediaPointerMove);
  document.addEventListener('pointerup', onMediaPointerUp);
  document.addEventListener('pointercancel', onMediaPointerCancel);

  surface.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        e.preventDefault();
        const file = it.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => insertMediaNode('image', reader.result);
        reader.readAsDataURL(file);
        return;
      }
    }
    setTimeout(() => { ensureMediaAttrs(); ensureCaretSinks(); emit(); }, 0);
  });
  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('.doc-resize, .doc-media-del')) return;
    const fig = e.target && e.target.closest && e.target.closest('figure.doc-media');
    if (!fig || !surface.contains(fig)) return;
    selectMedia(fig);
    mediaMove = {
      fig,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      dropBefore: null,
      pointerId: e.pointerId,
    };
  });
  surface.addEventListener('mousedown', (e) => {
    const handle = e.target && e.target.closest && e.target.closest('.doc-resize');
    if (!handle) return;
    mediaMove = null; // 缩放优先，取消待定拖移
    const fig = handle.closest('figure.doc-media');
    if (!fig || !surface.contains(fig)) return;
    document.body.classList.add('is-media-resizing');
    startResize(fig, handle.getAttribute('data-dir') || 'se', e);
  });
  surface.addEventListener('click', (e) => {
    const del = e.target && e.target.closest && e.target.closest('.doc-media-del');
    if (del) {
      const fig = del.closest('figure.doc-media');
      e.preventDefault();
      e.stopPropagation();
      if (fig) removeMediaFig(fig);
      return;
    }
    if (e.target && e.target.closest && e.target.closest('.doc-resize')) {
      e.preventDefault();
      return;
    }
    const fig = e.target && e.target.closest && e.target.closest('figure.doc-media');
    if (fig && surface.contains(fig)) {
      e.preventDefault();
      if (!fig.classList.contains('is-dragging')) selectMedia(fig);
      return;
    }
    deselectMedia();
  });
  function resolveFromFig(fig) {
    const parsed = typeof parseMediaFig === 'function' ? parseMediaFig(fig) : null;
    const kind = (parsed && parsed.kind) || 'image';
    const dataSrc = (parsed && parsed.dataSrc) || String((fig && fig.getAttribute('data-src')) || '');
    if (!dataSrc) return { kind };
    if (dataSrc.startsWith('data:')) return { kind, dataUrl: dataSrc };
    const pIdx = typeof parsePendingIndex === 'function' ? parsePendingIndex(dataSrc) : null;
    if (pIdx != null && pending[pIdx]) {
      const val = pending[pIdx].value;
      if (typeof val === 'string' && val.startsWith('data:')) return { kind, dataUrl: val };
      if (val && typeof val === 'object' && val.srcPath) return { kind, srcPath: val.srcPath };
      if (typeof val === 'string' && !val.startsWith('pending:')) return { kind, rel: val };
      return { kind };
    }
    return { kind, rel: dataSrc.replace(/^\/+/, '').replace(/\\/g, '/') };
  }
  surface.addEventListener('contextmenu', (e) => {
    const fig = e.target && e.target.closest && e.target.closest('figure.doc-media');
    if (!fig || !surface.contains(fig)) return;
    e.preventDefault();
    if (typeof openMediaContextMenu !== 'function') return;
    openMediaContextMenu({
      fig,
      clientX: e.clientX,
      clientY: e.clientY,
      canDelete: true,
      resolveLocal: () => resolveFromFig(fig),
      onDelete: (f) => removeMediaFig(f),
    });
  });
  surface.addEventListener('keydown', (e) => {
    if (selectedMedia && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      removeMediaFig(selectedMedia);
      return;
    }
    if (e.key === 'Escape' && selectedMedia) {
      e.preventDefault();
      deselectMedia();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const fig = el && el.closest && el.closest('figure.doc-media');
    if (!fig) return;
    ensureCaretSinks();
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      const sink = fig.previousElementSibling;
      if (sink) {
        e.preventDefault();
        placeCaretIn(sink, true);
      }
    } else {
      const sink = fig.nextElementSibling;
      if (sink) {
        e.preventDefault();
        placeCaretIn(sink, false);
      }
    }
  });

  function getDoc() {
    ensureMediaAttrs();
    ensureCaretSinks();
    return htmlRootToDoc(surface);
  }

  async function blobToDataUrl(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function getPayload() {
    const raw = getDoc();
    const compact = [];
    const oldToNew = {};
    async function rewriteNode(node) {
      if (!node || typeof node !== 'object') return node;
      const out = { ...node };
      if (out.attrs && (out.type === 'image' || out.type === 'video')) {
        out.attrs = { ...out.attrs };
        let src = String(out.attrs.src || '');
        const idx = parsePendingIndex(src);
        if (idx != null && pending[idx]) {
          if (oldToNew[idx] == null) {
            oldToNew[idx] = compact.length;
            let value = pending[idx].value;
            if (typeof value === 'string' && /^blob:/i.test(value)) {
              value = await blobToDataUrl(value);
            }
            compact.push({ kind: pending[idx].kind, value });
          }
          out.attrs.src = pendingKey(oldToNew[idx]);
        } else if (/^data:/i.test(src)) {
          const newIdx = compact.length;
          compact.push({
            kind: out.type === 'video' ? 'video' : 'image',
            value: src,
          });
          out.attrs.src = pendingKey(newIdx);
        } else if (/^blob:/i.test(src)) {
          const newIdx = compact.length;
          const dataUrl = await blobToDataUrl(src);
          compact.push({
            kind: out.type === 'video' ? 'video' : 'image',
            value: dataUrl,
          });
          out.attrs.src = pendingKey(newIdx);
        }
      }
      if (Array.isArray(out.content)) {
        out.content = [];
        for (const c of node.content) out.content.push(await rewriteNode(c));
      }
      return out;
    }
    return { doc: await rewriteNode(raw), pendingMedia: compact };
  }

  function setDoc(doc, pendingPreview) {
    deselectMedia();
    pending.length = 0;
    const html = docToHtml(doc || { type: 'doc', content: [{ type: 'paragraph' }] }, {
      pendingPreview: pendingPreview || {},
    });
    surface.innerHTML = html || '<p><br></p>';
    ensureMediaAttrs();
    ensureCaretSinks();
    emit();
  }

  function clear() {
    deselectMedia();
    pending.length = 0;
    surface.innerHTML = '<p><br></p>';
    placeCaretIn(surface.firstElementChild, false);
    try { document.execCommand('removeFormat'); } catch (_) {}
    clearToolbarActive();
    emit();
    requestAnimationFrame(() => clearToolbarActive());
  }

  function isEmpty(attachments) {
    return isTaskContentEmpty({ doc: getDoc(), attachments: attachments || [] });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('selectionchange', syncToolbarState);
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    document.removeEventListener('pointermove', onMediaPointerMove);
    document.removeEventListener('pointerup', onMediaPointerUp);
    document.removeEventListener('pointercancel', onMediaPointerCancel);
    stopMediaAutoScroll();
    if (mediaMove) {
      if (mediaMove.fig) mediaMove.fig.classList.remove('is-dragging');
      mediaMove = null;
    }
    resizeDrag = null;
    document.body.classList.remove('is-media-resizing');
    document.body.classList.remove('is-media-dragging');
    clearDropIndicator();
    if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
    dropLine = null;
    deselectMedia();
    pending.length = 0;
    onChange = null;
    try { host.innerHTML = ''; } catch (_) { /* ignore */ }
  }

  return {
    getDoc,
    getPayload,
    setDoc,
    clear,
    isEmpty,
    destroy,
    insertMediaNode,
    insertExistingRel,
    countKinds,
    surface,
    setOnChange(fn) { onChange = fn; },
  };
}
