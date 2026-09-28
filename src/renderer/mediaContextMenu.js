/** 图片/视频右键菜单（应用内浮层） */

(function () {
  let menuEl = null;
  let closer = null;
  let ocrReadyCache = { at: 0, value: false };

  function closeMediaContextMenu() {
    if (closer) {
      try { closer(); } catch (_) { /* ignore */ }
      closer = null;
    }
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }

  function buildPayload(local) {
    const kind = local && local.kind === 'video' ? 'video' : 'image';
    const payload = { kind };
    if (local && local.dataUrl) payload.dataUrl = local.dataUrl;
    else if (local && local.rel) payload.rel = local.rel;
    else if (local && local.srcPath) payload.srcPath = local.srcPath;
    return payload;
  }

  async function getOcrReadyCached() {
    const now = Date.now();
    if (now - ocrReadyCache.at < 3000) return ocrReadyCache.value;
    try {
      if (typeof API === 'undefined' || typeof API.listPlugins !== 'function') {
        ocrReadyCache = { at: now, value: false };
        return false;
      }
      const list = await API.listPlugins();
      const p = (list || []).find((x) => x.id === 'ocr');
      ocrReadyCache = { at: now, value: !!(p && p.installed && p.enabled) };
    } catch (_) {
      ocrReadyCache = { at: now, value: false };
    }
    return ocrReadyCache.value;
  }

  async function runAction(id, opts, local) {
    const payload = buildPayload(local);
    try {
      if (id === 'ocr') {
        if (typeof runMediaOcr === 'function') await runMediaOcr(local);
        else if (typeof opts.onExtra === 'function') opts.onExtra('ocr');
        return;
      }
      if (id === 'delete') {
        if (typeof opts.onDelete === 'function') opts.onDelete(opts.fig);
        return;
      }
      if (typeof API === 'undefined') {
        alert('操作失败');
        return;
      }
      let res;
      if (id === 'copy') res = await API.copyMedia(payload);
      else if (id === 'saveAs') res = await API.saveMediaAs(payload);
      else if (id === 'open') res = await API.openMedia(payload);
      else if (id === 'showInFolder') res = await API.showMediaInFolder(payload);
      else return;
      if (!res) return;
      if (res.cancelled) return;
      if (!res.ok) alert(res.error || '操作失败');
    } catch (err) {
      alert((err && err.message) || '操作失败');
    }
  }

  function mountMenu(opts, items, local, kind) {
    const menu = document.createElement('div');
    menu.id = 'mediaCtxMenu';
    menu.className = 'media-ctx-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'media-ctx-item' + (it.disabled ? ' is-disabled' : '');
      btn.setAttribute('role', 'menuitem');
      btn.textContent = it.label;
      if (it.disabled) {
        btn.disabled = true;
        if (it.title) btn.title = it.title;
      } else {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeMediaContextMenu();
          if (typeof opts.onExtra === 'function'
            && Array.isArray(opts.extraItems)
            && opts.extraItems.some((x) => x && x.id === it.id)
            && it.id !== 'ocr') {
            opts.onExtra(it.id);
            return;
          }
          runAction(it.id, opts, { ...local, kind });
        });
      }
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    menuEl = menu;

    const pad = 8;
    let x = Number(opts.clientX) || 0;
    let y = Number(opts.clientY) || 0;
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const onPointer = (e) => {
      if (menuEl && menuEl.contains(e.target)) return;
      closeMediaContextMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeMediaContextMenu();
    };
    const onScroll = () => closeMediaContextMenu();
    setTimeout(() => {
      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('blur', closeMediaContextMenu);
    }, 0);
    closer = () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', closeMediaContextMenu);
    };
  }

  /**
   * @param {{
   *   fig?: Element,
   *   clientX: number,
   *   clientY: number,
   *   canDelete?: boolean,
   *   resolveLocal: () => { kind: string, rel?: string, dataUrl?: string, srcPath?: string },
   *   onDelete?: (fig: Element) => void,
   *   extraItems?: Array<{ id: string, label: string, disabled?: boolean, title?: string }>,
   *   onExtra?: (id: string) => void,
   * }} opts
   */
  async function openMediaContextMenu(opts) {
    if (!opts || typeof opts.resolveLocal !== 'function') return;
    if (typeof buildMediaMenuItems !== 'function') return;

    closeMediaContextMenu();

    const parsed = (opts.fig && typeof parseMediaFig === 'function')
      ? parseMediaFig(opts.fig)
      : {};
    const local = opts.resolveLocal() || {};
    const kind = local.kind || parsed.kind || 'image';
    const hasLocalPath = !!(local.rel || local.srcPath);
    const hasDataUrl = !!(local.dataUrl || (parsed.isDataUrl && parsed.dataSrc));
    const extraItems = Array.isArray(opts.extraItems) ? opts.extraItems.slice() : [];

    // 图片 + OCR 插件就绪：统一提供「提取文字」（预览/详情/编辑/卡片一致）
    if (kind === 'image' && !extraItems.some((x) => x && x.id === 'ocr')) {
      const ready = await getOcrReadyCached();
      if (ready) {
        const canRun = !!(local.rel || local.dataUrl || local.srcPath);
        const busy = typeof lb !== 'undefined' && lb && lb.ocrBusy;
        extraItems.unshift({
          id: 'ocr',
          label: busy ? '识别中…' : '提取文字',
          disabled: !canRun || !!busy,
          title: busy
            ? '正在识别'
            : (canRun ? '离线识别图片中的文字' : '图片未就绪'),
        });
      }
    }

    const items = [
      ...extraItems,
      ...buildMediaMenuItems({
        kind,
        hasLocalPath,
        hasDataUrl,
        canDelete: !!opts.canDelete,
      }),
    ];

    mountMenu(opts, items, local, kind);
  }

  window.openMediaContextMenu = openMediaContextMenu;
  window.closeMediaContextMenu = closeMediaContextMenu;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { openMediaContextMenu, closeMediaContextMenu };
  }
})();
