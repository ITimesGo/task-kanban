/** 创建/编辑区粘贴：文字 + 图片（须在 paste 同步阶段 preventDefault） */

function collectClipboardImageFiles(cd) {
  if (!cd) return [];
  const out = [];
  const keys = new Set();
  const add = (f) => {
    if (!f) return;
    const t = String(f.type || '').toLowerCase();
    if (!t.startsWith('image/') && !isImageFile(f)) return;
    // files + items 常指向同一张图，用 size+type 去重
    const k = `${f.size}:${t}`;
    if (keys.has(k)) return;
    keys.add(k);
    out.push(f);
  };
  const imageItems = [...(cd.items || [])].filter(
    (it) => it.kind === 'file' && /^image\//i.test(it.type || '')
  );
  if (imageItems.length) {
    for (const it of imageItems) add(it.getAsFile());
    return out;
  }
  for (const f of cd.files || []) add(f);
  return out;
}

function isTextareaLike(el) {
  return !!(el && typeof el.value === 'string' && typeof el.setSelectionRange === 'function');
}

function isContentEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return !!(el.getAttribute && el.getAttribute('contenteditable') === 'true');
}

function insertTextAtCursor(el, text) {
  if (!el || !text) return;
  if (isTextareaLike(el)) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const caret = start + text.length;
    el.focus();
    el.setSelectionRange(caret, caret);
    return;
  }
  if (isContentEditable(el)) {
    el.focus();
    try {
      if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
        document.execCommand('insertText', false, text);
        return;
      }
    } catch (_) {}
    try {
      document.execCommand('insertHTML', false, String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>'));
      return;
    } catch (_) {}
    // 最后手段：追加到末尾
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
  }
}

/**
 * @param {object} opts
 * @param {() => HTMLElement|null} opts.getZone 粘贴生效区域
 * @param {() => HTMLElement|null} opts.getTextarea 描述输入（textarea 或 contenteditable）
 * @param {(items: any[]) => void} opts.addImages
 * @param {() => void} [opts.onTextChange]
 * @param {number} [opts.maxMb]
 */
function bindContentPaste(opts) {
  const maxMb = opts.maxMb || 10;
  const maxBytes = maxMb * 1024 * 1024;

  document.addEventListener('paste', (e) => {
    if (e.defaultPrevented) return;

    const zone = opts.getZone();
    if (!zone) return;

    const target = e.target;
    const inZone = target && (zone.contains(target) || target === zone);
    if (!inZone) return;

    const cd = e.clipboardData;
    const plainText = cd ? (cd.getData('text/plain') || '') : '';
    const imageFiles = collectClipboardImageFiles(cd);
    const ta = opts.getTextarea();

    if (imageFiles.length) {
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const added = [];
        for (const f of imageFiles) {
          if (f.size > maxBytes) { alert(`图片超过${maxMb}MB`); continue; }
          const resolved = await resolveImageDrop(f);
          if (resolved) added.push(resolved);
        }
        if (added.length) opts.addImages(added);
        if (plainText && ta) insertTextAtCursor(ta, plainText);
        if (opts.onTextChange) opts.onTextChange();
      })();
      return;
    }

    let clip = null;
    try { clip = API.pasteImageSync(); } catch (_) { clip = null; }
    if (clip && clip.error) {
      alert(clip.error);
      e.preventDefault();
      return;
    }
    if (typeof clip === 'string' && clip.startsWith('data:')) {
      e.preventDefault();
      e.stopPropagation();
      opts.addImages([clip]);
      return;
    }
    if (clip && typeof clip === 'object' && clip.srcPath) {
      e.preventDefault();
      e.stopPropagation();
      opts.addImages([{ srcPath: clip.srcPath }]);
      return;
    }

    // 焦点不在输入框时，纯文字写入描述（兼容 textarea / contenteditable）
    if (plainText && ta && target !== ta && !ta.contains(target)) {
      e.preventDefault();
      insertTextAtCursor(ta, plainText);
      if (opts.onTextChange) opts.onTextChange();
    }
  });
}
