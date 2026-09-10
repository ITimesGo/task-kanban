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

function insertTextAtCursor(ta, text) {
  if (!ta || !text) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const caret = start + text.length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
}

/**
 * @param {object} opts
 * @param {() => HTMLElement|null} opts.getZone 粘贴生效区域
 * @param {() => HTMLTextAreaElement|null} opts.getTextarea
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

    // 焦点不在输入框时，纯文字写入描述
    if (plainText && ta && target !== ta) {
      e.preventDefault();
      insertTextAtCursor(ta, plainText);
      if (opts.onTextChange) opts.onTextChange();
    }
  });
}
