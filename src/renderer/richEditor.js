/** 轻量富文本编辑器：白名单工具栏 + contenteditable，序列化为 doc JSON */

function createRichEditor(host, options) {
  const opts = options || {};
  const pending = []; // { kind, value, previewUrl }
  let onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

  host.innerHTML = '';
  host.classList.add('rich-editor');

  const bar = document.createElement('div');
  bar.className = 'rich-toolbar';
  // 待办：用描边方框 + 对勾 SVG，避免 □ 字符在激活态发虚、对不齐
  const checkLabel = '<svg class="rich-tb-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
    + '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M4.2 8.1l2.4 2.4 5-5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg><span>待办</span>';
  bar.innerHTML = [
    ['bold', 'B', '加粗'],
    ['italic', 'I', '斜体'],
    ['check', checkLabel, '待办清单：再点一次退出当前项'],
    ['ol', '1. 列表', '有序列表'],
    ['image', '图片', '插入图片/视频'],
  ].map(([cmd, label, title]) =>
    `<button type="button" class="rich-tb${cmd === 'check' ? ' rich-tb--check' : ''}" data-cmd="${cmd}" title="${title}">${label}</button>`
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

  // viewBox 几何居中，避免笔画视觉偏左上
  const MEDIA_ZOOM_ICO = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M11 8v6M8 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MEDIA_DEL_ICO = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  /** 按图片真实高度缩放工具条，矮图用更小圆钮，避免超出 */
  function syncMediaToolbarLayout(fig) {
    if (!fig) return;
    const media = fig.querySelector('img, video');
    const box = media || fig;
    const h = (box.getBoundingClientRect && box.getBoundingClientRect().height) || 0;
    const w = (box.getBoundingClientRect && box.getBoundingClientRect().width) || 0;
    // 矮/窄图缩小圆钮；窄且够高时改竖排，放大镜不删
    fig.classList.toggle('is-media-compact', (h > 0 && h < 40) || (w > 0 && w < 56));
    fig.classList.toggle('is-media-narrow', w > 0 && w < 56 && h >= 40);
  }

  function ensureMediaActionButtons() {
    surface.querySelectorAll('figure.doc-media').forEach((fig) => {
      const isVideo = fig.classList.contains('doc-video') || fig.getAttribute('data-kind') === 'video';
      let bar = fig.querySelector(':scope > .doc-media-actions');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'doc-media-actions';
        // 把散落的旧按钮收进工具条
        fig.querySelectorAll(':scope > .doc-media-zoom, :scope > .doc-media-del').forEach((el) => {
          bar.appendChild(el);
        });
        fig.appendChild(bar);
      }
      if (!bar.querySelector('.doc-media-zoom')) {
        const zoom = document.createElement('button');
        zoom.type = 'button';
        zoom.className = 'doc-media-zoom';
        zoom.title = isVideo ? '预览视频' : '预览图片';
        zoom.setAttribute('aria-label', zoom.title);
        zoom.innerHTML = MEDIA_ZOOM_ICO;
        bar.appendChild(zoom);
      }
      if (!bar.querySelector('.doc-media-del')) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'doc-media-del';
        del.title = isVideo ? '删除视频' : '删除图片';
        del.setAttribute('aria-label', del.title);
        del.innerHTML = MEDIA_DEL_ICO;
        bar.appendChild(del);
      }
      // 保证顺序：放大镜在左、删除在右
      const zoomBtn = bar.querySelector('.doc-media-zoom');
      const delBtn = bar.querySelector('.doc-media-del');
      if (zoomBtn && delBtn && zoomBtn.nextElementSibling !== delBtn) {
        bar.insertBefore(zoomBtn, delBtn);
      }
      const media = fig.querySelector('img, video');
      if (media) {
        const bump = () => syncMediaToolbarLayout(fig);
        if (media.tagName === 'IMG') {
          if (media.complete) bump();
          else media.addEventListener('load', bump, { once: true });
        } else if (media.videoWidth) bump();
        else media.addEventListener('loadedmetadata', bump, { once: true });
      }
      syncMediaToolbarLayout(fig);
      if (typeof ResizeObserver !== 'undefined' && !fig._mediaToolbarRo) {
        const ro = new ResizeObserver(() => syncMediaToolbarLayout(fig));
        ro.observe(fig);
        if (media) ro.observe(media);
        fig._mediaToolbarRo = ro;
      }
    });
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
    ensureMediaActionButtons();
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
    // 待办项内插图会嵌进 li，保存/编辑易乱；先降成普通段再插
    leaveTaskItemIfNeeded();
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
    leaveTaskItemIfNeeded();
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
      if (el.nodeType === 1) {
        // 待办壳不能当「当前块」去 replace/innerHTML，否则会拆掉勾选结构
        if (el.classList && el.classList.contains('task-check')) {
          el = el.parentElement;
          continue;
        }
        if (el.classList && el.classList.contains('task-item')) {
          const p = el.querySelector('.task-item-body > p') || el.querySelector('.task-item-body p');
          if (p) return p;
          const body = el.querySelector('.task-item-body');
          if (body) {
            el = body;
            continue;
          }
        }
        if (el.classList && el.classList.contains('task-item-body')) {
          const p = el.querySelector(':scope > p') || el.querySelector('p');
          if (p) return p;
          el = el.parentElement;
          continue;
        }
        if (/^(P|DIV|LI|H[1-6])$/i.test(el.tagName)) return el;
      }
      el = el.parentElement;
    }
    // 禁止 surface.querySelector('p')：会误命中文首段，加粗空段时改错行甚至整页被清
    ensureCaretSinks();
    const sel = window.getSelection();
    if (sel && sel.anchorNode && surface.contains(sel.anchorNode)) {
      let n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      while (n && n !== surface) {
        if (n.nodeType === 1 && /^(P|DIV|LI|H[1-6])$/i.test(n.tagName)
          && !(n.classList && (n.classList.contains('task-item') || n.classList.contains('task-item-body') || n.classList.contains('task-check')))) {
          return n;
        }
        n = n.parentElement;
      }
    }
    let p = surface.querySelector(':scope > p');
    if (!p) {
      p = document.createElement('p');
      p.innerHTML = '<br>';
      surface.insertBefore(p, surface.firstChild);
    }
    return p;
  }

  /** 插图 / 有序列表前：先退出待办项，避免 figure/ol 嵌进 task-item-body */
  function leaveTaskItemIfNeeded() {
    if (typeof promoteNestedTaskLists === 'function') promoteNestedTaskLists();
    const li = closestTaskItem();
    if (!li) return false;
    breakOutOfTaskItem(li, { keepContent: true });
    cleanupEmptyListShells();
    return true;
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
      // 只清空壳，绝不 surface.innerHTML=''（会毁掉列表/图片）
      const target = (block && block !== surface) ? block : currentBlockEl();
      if (target && target !== surface) {
        target.innerHTML = '<br>';
        placeCaretIn(target, false);
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
          const p = (target && target.isConnected ? target : currentBlockEl());
          if (p && p !== surface) {
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
      check: () => !!closestTaskItem(),
      ol: () => {
        try { if (document.queryCommandState('insertOrderedList')) return true; } catch (_) {}
        return selectionInTag('ol') && !closestTaskItem();
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

  function closestTaskItem(from) {
    let el = from || selectionAnchorEl();
    while (el && el !== surface) {
      if (el.nodeType === 1 && el.matches && el.matches('li.task-item, li[data-type="taskItem"]')) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function closestTaskList(from) {
    const item = closestTaskItem(from);
    if (!item) return null;
    return item.closest('ul.task-list, ul[data-type="taskList"]');
  }

  function makeTaskCheckBoxEl() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'task-check-box');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('class', 'task-check-rect');
    rect.setAttribute('x', '1.5');
    rect.setAttribute('y', '1.5');
    rect.setAttribute('width', '13');
    rect.setAttribute('height', '13');
    rect.setAttribute('rx', '3');
    rect.setAttribute('ry', '3');
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', '#48484a');
    rect.setAttribute('stroke-width', '1.75');
    const tick = document.createElementNS(ns, 'path');
    tick.setAttribute('class', 'task-check-tick');
    tick.setAttribute('d', 'M4.2 8.2l2.4 2.4 5-5.2');
    tick.setAttribute('fill', 'none');
    tick.setAttribute('stroke', '#ffffff');
    tick.setAttribute('stroke-width', '1.85');
    tick.setAttribute('stroke-linecap', 'round');
    tick.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(rect);
    svg.appendChild(tick);
    return svg;
  }

  function ensureTaskCheckBox(btn) {
    if (!btn) return;
    const existing = btn.querySelector('svg.task-check-box');
    if (existing && existing.querySelector('.task-check-rect')) {
      // 清掉旧版残留文字/方块字符，只留 SVG
      [...btn.childNodes].forEach((n) => {
        if (n !== existing) n.remove();
      });
      return;
    }
    btn.querySelectorAll('.task-check-box').forEach((n) => n.remove());
    [...btn.childNodes].forEach((n) => n.remove());
    btn.appendChild(makeTaskCheckBoxEl());
  }

  function makeTaskItemEl(checked, bodyHtml) {
    const li = document.createElement('li');
    li.className = 'task-item' + (checked ? ' is-checked' : '');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', checked ? 'true' : 'false');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-check';
    btn.contentEditable = 'false';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('aria-checked', checked ? 'true' : 'false');
    btn.setAttribute('aria-label', '完成此项');
    btn.appendChild(makeTaskCheckBoxEl());
    const body = document.createElement('div');
    body.className = 'task-item-body';
    body.innerHTML = bodyHtml || '<p><br></p>';
    li.appendChild(btn);
    li.appendChild(body);
    return li;
  }

  /** 勾选按钮不可编辑；li/body 继承 surface，支持跨待办拖选。旧版 input 就地升级为 button */
  function normalizeTaskItemEditability() {
    surface.querySelectorAll('li.task-item, li[data-type="taskItem"]').forEach((li) => {
      li.removeAttribute('contenteditable');
      let btn = li.querySelector(':scope > .task-check');
      const legacyInput = li.querySelector(':scope > label.task-check input[type="checkbox"], :scope > input[type="checkbox"]');
      if (legacyInput && (!btn || btn.tagName === 'LABEL')) {
        const checked = !!(legacyInput.checked || li.classList.contains('is-checked') || li.getAttribute('data-checked') === 'true');
        const wrap = legacyInput.closest('label.task-check') || legacyInput;
        const neu = document.createElement('button');
        neu.type = 'button';
        neu.className = 'task-check';
        neu.contentEditable = 'false';
        neu.tabIndex = 0;
        neu.setAttribute('role', 'checkbox');
        neu.setAttribute('aria-checked', checked ? 'true' : 'false');
        neu.setAttribute('aria-label', '完成此项');
        neu.appendChild(makeTaskCheckBoxEl());
        wrap.replaceWith(neu);
        btn = neu;
        syncTaskItemChecked(li, checked);
      }
      if (btn) {
        btn.contentEditable = 'false';
        if (btn.tagName === 'BUTTON') {
          btn.type = 'button';
          btn.setAttribute('role', 'checkbox');
          const checked = li.classList.contains('is-checked') || li.getAttribute('data-checked') === 'true';
          syncTaskItemChecked(li, checked);
          ensureTaskCheckBox(btn);
        }
      }
      let body = li.querySelector(':scope > .task-item-body');
      if (!body) {
        body = document.createElement('div');
        body.className = 'task-item-body';
        [...li.childNodes].forEach((n) => {
          if (n.nodeType === 1 && n.classList && n.classList.contains('task-check')) return;
          if (n.nodeType === 1 && n.tagName === 'INPUT') return;
          body.appendChild(n);
        });
        if (!body.childNodes.length) body.innerHTML = '<p><br></p>';
        li.appendChild(body);
      }
      body.removeAttribute('contenteditable');
    });
  }

  function taskItemIsEmpty(li) {
    const body = li && li.querySelector('.task-item-body');
    if (!body) return true;
    if (body.querySelector('img,video,figure')) return false;
    const t = String(body.textContent || '')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
    return !t;
  }

  function placeCaretInTaskItem(li, atEnd) {
    const body = li && li.querySelector('.task-item-body');
    const p = body && (body.querySelector('p') || body.firstElementChild || body);
    placeCaretIn(p, atEnd);
  }

  function isCaretAtStartOfTaskItem(li) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const body = li.querySelector('.task-item-body');
    if (!body || !body.contains(sel.anchorNode)) return false;
    try {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEnd(sel.anchorNode, sel.anchorOffset);
      const before = String(pre.toString() || '')
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
        .replace(/\u00a0/g, ' ')
        .trim();
      return !before;
    } catch (_) {
      return false;
    }
  }

  /**
   * 退出当前这一条待办 → 普通段落（列表在此处拆开）。
   * Notion / Linear 同款：空项 Enter、行首 Backspace、再点「待办」都走这里。
   */
  function breakOutOfTaskItem(li, { keepContent = false } = {}) {
    const list = li && li.closest('ul.task-list, ul[data-type="taskList"]');
    if (!list || !li) return null;
    const items = [...list.querySelectorAll(':scope > li.task-item')];
    const idx = items.indexOf(li);
    if (idx < 0) return null;

    const afterItems = items.slice(idx + 1);
    const body = li.querySelector('.task-item-body');
    const p = document.createElement('p');
    if (keepContent && body && !taskItemIsEmpty(li)) {
      // 把正文挪进段落
      const first = body.firstElementChild;
      if (first && first.tagName === 'P' && body.children.length === 1) {
        p.innerHTML = first.innerHTML || '<br>';
      } else {
        while (body.firstChild) p.appendChild(body.firstChild);
        if (!p.innerHTML) p.innerHTML = '<br>';
      }
    } else {
      p.innerHTML = '<br>';
    }

    li.remove();

    // 后面还有待办：先挂到临时列表，插在段落后
    let afterList = null;
    if (afterItems.length) {
      afterList = document.createElement('ul');
      afterList.className = 'task-list';
      afterList.setAttribute('data-type', 'taskList');
      for (const it of afterItems) afterList.appendChild(it);
    }

    if (!list.querySelector(':scope > li.task-item')) {
      // 前面也没了：整表换成段落（+ 后续列表）
      if (afterList) list.replaceWith(p, afterList);
      else list.replaceWith(p);
    } else {
      list.after(p);
      if (afterList) p.after(afterList);
    }

    placeCaretIn(p, keepContent);
    return p;
  }

  /** 有序/无序 li（非待办）：光标常在内部 p 上，必须升到 li，否则会把 task-list 嵌进 ol>li 导致勾选失效 */
  function plainListItemHost(from) {
    const el = from || selectionAnchorEl() || currentBlockEl();
    if (!el || !el.closest) return null;
    if (el.closest('li.task-item, li[data-type="taskItem"]')) return null;
    const li = el.closest('ol > li, ul:not(.task-list) > li');
    if (!li || !surface.contains(li)) return null;
    if (li.classList && li.classList.contains('task-item')) return null;
    return li;
  }

  /** 从待办/普通 li 抽出纯正文 HTML（去掉勾选控件，避免互转丢框或嵌套） */
  function extractPlainBodyHtml(liOrBlock) {
    if (!liOrBlock) return '<p><br></p>';
    const body = liOrBlock.querySelector && liOrBlock.querySelector(':scope > .task-item-body');
    if (body) {
      const html = body.innerHTML || '<br>';
      return /<p[\s>]/i.test(html) ? html : `<p>${html}</p>`;
    }
    const clone = liOrBlock.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll('.task-check, input[type="checkbox"], label.task-check').forEach((n) => n.remove());
      const nestedBody = clone.querySelector('.task-item-body');
      if (nestedBody) {
        const html = nestedBody.innerHTML || '<br>';
        return /<p[\s>]/i.test(html) ? html : `<p>${html}</p>`;
      }
    }
    const only = clone.childElementCount === 1 && clone.firstElementChild;
    if (only && only.tagName === 'P') {
      const inner = only.innerHTML || '<br>';
      return `<p>${inner}</p>`;
    }
    const raw = clone.innerHTML || '<br>';
    if (/<p[\s>]/i.test(raw)) return raw;
    return `<p>${raw}</p>`;
  }

  function listItemBodyHtml(liOrBlock) {
    return extractPlainBodyHtml(liOrBlock);
  }

  function ensureTaskItemHasCheck(li) {
    if (!li) return li;
    if (li.querySelector(':scope > button.task-check, :scope > .task-check[role="checkbox"]')) {
      normalizeTaskItemEditability();
      return li;
    }
    const checked = li.classList.contains('is-checked') || li.getAttribute('data-checked') === 'true';
    const neu = makeTaskItemEl(checked, extractPlainBodyHtml(li));
    li.replaceWith(neu);
    if (!neu.closest('ul.task-list, ul[data-type="taskList"]')) {
      const ul = document.createElement('ul');
      ul.className = 'task-list';
      ul.setAttribute('data-type', 'taskList');
      neu.replaceWith(ul);
      ul.appendChild(neu);
    }
    normalizeTaskItemEditability();
    return neu;
  }

  /** 整份待办列表 → 有序列表（勾选状态记在 data-was-checked，可互转还原） */
  function convertTaskListToOrdered(taskLi) {
    const list = taskLi && taskLi.closest('ul.task-list, ul[data-type="taskList"]');
    if (!list) return null;
    const items = [...list.querySelectorAll(':scope > li.task-item, :scope > li[data-type="taskItem"]')];
    if (!items.length) return null;
    const idx = Math.max(0, items.indexOf(taskLi));
    const ol = document.createElement('ol');
    for (const it of items) {
      const oli = document.createElement('li');
      const checked = it.classList.contains('is-checked') || it.getAttribute('data-checked') === 'true';
      if (checked) oli.setAttribute('data-was-checked', 'true');
      oli.innerHTML = extractPlainBodyHtml(it);
      ol.appendChild(oli);
    }
    list.replaceWith(ol);
    const focus = ol.children[Math.min(idx, ol.children.length - 1)];
    const p = focus && (focus.querySelector('p') || focus);
    if (p) placeCaretIn(p, true);
    promoteNestedTaskLists();
    cleanupEmptyListShells();
    return ol;
  }

  /** 整份普通 ol/ul → 待办列表（还原 data-was-checked） */
  function convertPlainListToTask(plainLi) {
    const list = plainLi && plainLi.parentElement;
    if (!list || (list.tagName !== 'OL' && list.tagName !== 'UL')) return null;
    if (list.classList && list.classList.contains('task-list')) return null;
    const items = [...list.children].filter((c) => c.tagName === 'LI');
    if (!items.length) return null;
    const idx = Math.max(0, items.indexOf(plainLi));
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.setAttribute('data-type', 'taskList');
    let focusItem = null;
    items.forEach((oli, i) => {
      const checked = oli.getAttribute('data-was-checked') === 'true';
      const ti = makeTaskItemEl(checked, extractPlainBodyHtml(oli));
      ul.appendChild(ti);
      if (i === idx) focusItem = ti;
    });
    list.replaceWith(ul);
    promoteNestedTaskLists();
    normalizeTaskItemEditability();
    if (focusItem) placeCaretInTaskItem(focusItem, true);
    cleanupEmptyListShells();
    return ul;
  }

  function convertOrderedListToTask(plainLi) {
    return convertPlainListToTask(plainLi);
  }

  /** 清掉转换后残留的空 ol/ul/li 壳 */
  function cleanupEmptyListShells() {
    let guard = 0;
    while (guard++ < 8) {
      let removed = false;
      surface.querySelectorAll('li').forEach((li) => {
        if (!li.isConnected || !surface.contains(li)) return;
        if (li.classList && li.classList.contains('task-item')) return;
        if (li.querySelector('img,video,figure,.task-list,.task-item')) return;
        const t = String(li.textContent || '').replace(/[\u200b\ufeff]/g, '').trim();
        if (t) return;
        const parent = li.parentElement;
        li.remove();
        removed = true;
        if (parent && (parent.tagName === 'OL' || parent.tagName === 'UL')
          && !parent.classList.contains('task-list')
          && !parent.querySelector('li')) {
          parent.remove();
        }
      });
      surface.querySelectorAll('ol, ul:not(.task-list)').forEach((list) => {
        if (!list.isConnected || !surface.contains(list)) return;
        if (!list.querySelector('li')) {
          list.remove();
          removed = true;
        }
      });
      if (!removed) break;
    }
  }

  /**
   * 待办被嵌进 ol/ul（含直接子级 ul.task-list）时抬到顶层。
   * 否则父级 padding-left 会看起来像「待办前多出缩进」。
   */
  function promoteNestedTaskLists() {
    // ol > ul.task-list / ul > ul.task-list（多行转换误替换 li 时常见）
    for (const tl of [...surface.querySelectorAll('ol > ul.task-list, ul:not(.task-list) > ul.task-list')]) {
      if (!tl.isConnected) continue;
      const parent = tl.parentElement;
      if (!parent) continue;
      if (parent.children.length === 1) parent.replaceWith(tl);
      else parent.before(tl);
    }
    const nested = [...surface.querySelectorAll('ol > li .task-list, ul:not(.task-list) > li .task-list')];
    for (const tl of nested) {
      if (!tl.isConnected) continue;
      const hostLi = tl.closest('ol > li, ul:not(.task-list) > li');
      if (!hostLi || hostLi.classList.contains('task-item')) continue;
      const parentList = hostLi.parentElement;
      const onlyTask = [...hostLi.childNodes].every((n) => {
        if (n === tl || (n.contains && n.contains(tl))) return true;
        if (n.nodeType === 3 && !String(n.textContent || '').trim()) return true;
        return false;
      });
      if (parentList && parentList.children.length === 1 && onlyTask) {
        parentList.replaceWith(tl);
      } else if (onlyTask) {
        hostLi.replaceWith(tl);
      } else {
        hostLi.parentNode.insertBefore(tl, hostLi);
      }
    }
    cleanupEmptyListShells();
  }

  function isTaskItemEl(el) {
    return !!(el && el.classList
      && (el.classList.contains('task-item') || el.getAttribute('data-type') === 'taskItem'));
  }

  /** 选区覆盖的可转块：顶层段落 / 普通 li / 待办 li（多行选中时全部纳入） */
  function selectedConvertibleBlocks() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      const one = closestTaskItem() || plainListItemHost() || currentBlockEl();
      return one && one !== surface ? [one] : [];
    }
    const range = sel.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) {
      const one = closestTaskItem() || plainListItemHost() || currentBlockEl();
      return one && one !== surface ? [one] : [];
    }
    if (range.collapsed) {
      const one = closestTaskItem() || plainListItemHost() || currentBlockEl();
      return one && one !== surface ? [one] : [];
    }
    const units = [];
    const pushIfHit = (el) => {
      if (!el || !surface.contains(el)) return;
      try {
        if (range.intersectsNode(el)) units.push(el);
      } catch (_) { /* ignore */ }
    };
    for (const child of [...surface.children]) {
      if (!child || child.nodeType !== 1) continue;
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        for (const li of [...child.children]) {
          if (li.tagName === 'LI') pushIfHit(li);
        }
      } else if (/^(P|DIV|H[1-6])$/i.test(child.tagName)) {
        pushIfHit(child);
      }
    }
    if (units.length) return units;
    const one = closestTaskItem() || plainListItemHost() || currentBlockEl();
    return one && one !== surface ? [one] : [];
  }

  /** 把多个块合成一份待办列表（勿把 ul 塞进 ol/li，否则会带着父级缩进） */
  function convertBlocksToTaskList(blocks) {
    const items = (blocks || []).filter((b) => b && b.isConnected);
    if (!items.length) return null;
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.setAttribute('data-type', 'taskList');
    let focusItem = null;
    for (const block of items) {
      const checked = isTaskItemEl(block)
        ? (block.classList.contains('is-checked') || block.getAttribute('data-checked') === 'true')
        : block.getAttribute('data-was-checked') === 'true';
      const ti = makeTaskItemEl(!!checked, extractPlainBodyHtml(block));
      ul.appendChild(ti);
      if (!focusItem) focusItem = ti;
    }

    const first = items[0];
    const parent = first.parentElement;
    const sameParent = items.every((b) => b.parentElement === parent);
    const parentIsPlainList = !!(parent
      && (parent.tagName === 'OL' || parent.tagName === 'UL')
      && !(parent.classList && parent.classList.contains('task-list')));
    const parentIsTaskList = !!(parent && parent.classList && parent.classList.contains('task-list'));

    if (sameParent && (parentIsPlainList || parentIsTaskList) && items.every((b) => b.tagName === 'LI')) {
      const allLis = [...parent.children].filter((c) => c.tagName === 'LI');
      if (items.length >= allLis.length) {
        // 整表替换：ol/ul → task-list，避免嵌套缩进
        parent.replaceWith(ul);
      } else {
        // 部分项：插到列表外侧，再删选中项
        parent.before(ul);
        for (const b of items) {
          if (b.isConnected) b.remove();
        }
        if (!parent.querySelector('li')) parent.remove();
      }
    } else if (first.tagName === 'LI' && parentIsPlainList) {
      parent.before(ul);
      for (const b of items) {
        if (b.isConnected) b.remove();
      }
      if (parent.isConnected && !parent.querySelector('li')) parent.remove();
    } else {
      first.replaceWith(ul);
      for (let i = 1; i < items.length; i++) {
        if (items[i].isConnected) items[i].remove();
      }
    }

    promoteNestedTaskLists();
    cleanupEmptyListShells();
    normalizeTaskItemEditability();
    if (focusItem) placeCaretInTaskItem(focusItem, true);
    return ul;
  }

  function toggleTaskList() {
    promoteNestedTaskLists();
    normalizeTaskItemEditability();
    const blocks = selectedConvertibleBlocks();

    // 多行选中：整批转待办；若已全是待办则整批退出
    if (blocks.length > 1) {
      if (blocks.every(isTaskItemEl)) {
        for (let i = blocks.length - 1; i >= 0; i--) {
          breakOutOfTaskItem(blocks[i], { keepContent: true });
        }
        cleanupEmptyListShells();
        emit();
        return;
      }
      convertBlocksToTaskList(blocks);
      emit();
      return;
    }

    const curItem = closestTaskItem();
    if (curItem) {
      // 已在待办但勾选框丢了：补回，不要当成「退出」
      if (!curItem.querySelector(':scope > button.task-check, :scope > .task-check[role="checkbox"]')) {
        const fixed = ensureTaskItemHasCheck(curItem);
        if (fixed) placeCaretInTaskItem(fixed, true);
        emit();
        return;
      }
      // 再点待办：退出成普通段
      breakOutOfTaskItem(curItem, { keepContent: true });
      cleanupEmptyListShells();
      emit();
      return;
    }
    // 普通 ol/ul 光标在单项上 → 整表变待办
    const listHost = plainListItemHost();
    if (listHost && listHost.parentElement
      && (listHost.parentElement.tagName === 'OL' || listHost.parentElement.tagName === 'UL')
      && !(listHost.parentElement.classList && listHost.parentElement.classList.contains('task-list'))) {
      convertPlainListToTask(listHost);
      emit();
      return;
    }
    let block = (blocks[0] && blocks[0] !== surface) ? blocks[0] : (listHost || currentBlockEl());
    const list = document.createElement('ul');
    list.className = 'task-list';
    list.setAttribute('data-type', 'taskList');

    const bodyHtml = (block && block !== surface)
      ? listItemBodyHtml(block)
      : '<p><br></p>';
    const li = makeTaskItemEl(false, bodyHtml);
    list.appendChild(li);

    if (!block || block === surface) {
      surface.appendChild(list);
      normalizeTaskItemEditability();
      placeCaretInTaskItem(li, false);
      emit();
      return;
    }
    block.replaceWith(list);
    cleanupEmptyListShells();
    normalizeTaskItemEditability();
    placeCaretInTaskItem(li, true);
    emit();
  }

  function toggleOrderedList() {
    promoteNestedTaskLists();
    const taskLi = closestTaskItem();
    if (taskLi) {
      // 待办 → 有序：整表转换，不用 execCommand
      convertTaskListToOrdered(taskLi);
      emit();
      return;
    }
    try { document.execCommand('insertOrderedList'); } catch (_) { /* ignore */ }
  }

  function handleTaskItemEnter(li) {
    if (!li) return;
    // 空项再 Enter → 退出待办，变成普通段落（可继续写或切「1. 列表」）
    if (taskItemIsEmpty(li)) {
      breakOutOfTaskItem(li, { keepContent: false });
      emit();
      return;
    }
    const neu = makeTaskItemEl(false, '<p><br></p>');
    li.after(neu);
    placeCaretInTaskItem(neu, false);
    emit();
  }

  /** 行首 Backspace：空项直接退出；有内容则把该项降成普通段 */
  function handleTaskItemBackspace(li) {
    if (!li || !isCaretAtStartOfTaskItem(li)) return false;
    breakOutOfTaskItem(li, { keepContent: !taskItemIsEmpty(li) });
    emit();
    return true;
  }

  function closestOrderedLi() {
    if (closestTaskItem()) return null;
    const el = selectionAnchorEl();
    if (!el || !el.closest) return null;
    const li = el.closest('ol > li');
    if (!li || !surface.contains(li)) return null;
    return li;
  }

  function orderedLiIsEmpty(li) {
    if (!li) return true;
    if (li.querySelector('img,video,figure')) return false;
    const t = String(li.textContent || '')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
    return !t;
  }

  /** 有序列表空项 Enter → 退出成普通段（与待办一致，避免卡在 1. 2. 里） */
  function handleOrderedLiEnter(li) {
    const list = li && li.parentElement;
    if (!list || list.tagName !== 'OL') return;
    if (!orderedLiIsEmpty(li)) {
      // 交给浏览器默认：续下一项
      return false;
    }
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    const only = list.children.length <= 1;
    if (only) list.replaceWith(p);
    else {
      li.remove();
      list.after(p);
    }
    placeCaretIn(p, false);
    emit();
    return true;
  }

  function syncTaskItemChecked(li, checked) {
    if (!li) return;
    const on = !!checked;
    li.setAttribute('data-checked', on ? 'true' : 'false');
    li.classList.toggle('is-checked', on);
    const btn = li.querySelector('.task-check[role="checkbox"], button.task-check');
    if (btn) btn.setAttribute('aria-checked', on ? 'true' : 'false');
    const input = li.querySelector('input[type="checkbox"]');
    if (input) input.checked = on;
  }

  function runFormat(cmd) {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    if (cmd === 'bold') toggleInline('bold');
    else if (cmd === 'italic') toggleInline('italic');
    else if (cmd === 'check') toggleTaskList();
    else if (cmd === 'ol') {
      toggleOrderedList();
    }
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

  function toggleTaskCheckFromHit(hit) {
    if (!hit || !surface.contains(hit)) return;
    // 先定位 li，再 normalize（升级会替换 hit，不能先替换再 closest）
    const li = hit.closest('li.task-item, li[data-type="taskItem"]');
    if (!li || !surface.contains(li)) return;
    promoteNestedTaskLists();
    normalizeTaskItemEditability();
    if (!li.isConnected || !surface.contains(li)) return;
    const next = !li.classList.contains('is-checked');
    syncTaskItemChecked(li, next);
    emit();
  }

  // 勾选按钮：只认 class，避免原生 checkbox 二次翻转
  surface.addEventListener('click', (e) => {
    const hit = e.target && e.target.closest && e.target.closest(
      'button.task-check, .task-check[role="checkbox"], li.task-item input[type="checkbox"]'
    );
    if (!hit || !surface.contains(hit)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTaskCheckFromHit(hit);
  });
  surface.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const hit = e.target && e.target.closest && e.target.closest(
      'button.task-check, .task-check[role="checkbox"]'
    );
    if (!hit || !surface.contains(hit)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTaskCheckFromHit(hit);
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
    const fig = resizeDrag.fig;
    resizeDrag = null;
    document.body.classList.remove('is-media-resizing');
    if (fig) syncMediaToolbarLayout(fig);
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
    setTimeout(() => {
      ensureMediaAttrs();
      ensureCaretSinks();
      normalizeTaskItemEditability();
      emit();
    }, 0);
  });
  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('.doc-resize, .doc-media-del, .doc-media-zoom')) return;
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
    const zoom = e.target && e.target.closest && e.target.closest('.doc-media-zoom');
    if (zoom) {
      const fig = zoom.closest('figure.doc-media');
      e.preventDefault();
      e.stopPropagation();
      if (fig && surface.contains(fig)) openMediaPreview(fig);
      return;
    }
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

  function openMediaPreview(fig) {
    if (!fig || typeof window.showLightbox !== 'function') return;
    const resolved = resolveFromFig(fig);
    const kind = resolved.kind === 'video' ? 'video' : 'image';
    let src = '';
    if (resolved.dataUrl) src = resolved.dataUrl;
    else if (resolved.srcPath && typeof API !== 'undefined' && API.localFileUrl) {
      src = API.localFileUrl(resolved.srcPath);
    } else if (resolved.rel && typeof API !== 'undefined') {
      src = typeof API.mediaSrc === 'function'
        ? API.mediaSrc(resolved.rel, kind)
        : (API.imageUrl ? API.imageUrl(resolved.rel) : '');
    }
    if (!src) {
      const media = fig.querySelector('img, video');
      src = (media && (media.currentSrc || media.getAttribute('src') || '')) || '';
    }
    if (!src || String(src).startsWith('pending:')) return;
    window.showLightbox(src, { type: kind });
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
    if (e.key === 'Enter' && !e.shiftKey) {
      const taskLi = closestTaskItem();
      if (taskLi) {
        e.preventDefault();
        handleTaskItemEnter(taskLi);
        return;
      }
      const olLi = closestOrderedLi();
      if (olLi && handleOrderedLiEnter(olLi)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Backspace') {
      const taskLi = closestTaskItem();
      if (taskLi && handleTaskItemBackspace(taskLi)) {
        e.preventDefault();
        return;
      }
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
      editorShell: true,
    });
    surface.innerHTML = html || '<p><br></p>';
    ensureMediaAttrs();
    ensureCaretSinks();
    normalizeTaskItemEditability();
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
