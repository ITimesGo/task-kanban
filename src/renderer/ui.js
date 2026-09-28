const ui = (() => {
  const cardsEl = document.getElementById('cards');
  const thumbsEl = document.getElementById('newThumbs');
  const detailBody = document.getElementById('detailBody');
  const detailActions = document.getElementById('detailActions');
  let tagMap = {}; // tagId -> tagName

  const STATUS_UNDO_MS = 1000;
  /** @type {Map<string, { gen: number, toDone: boolean, endsAt: number, raf: number|null, width: number, onUndo: Function, onCommit: Function }>} */
  const pendingUndoById = new Map();
  let statusUndoGen = 0;

  function setTagMap(map) { tagMap = map || {}; }

  function abandonCardStatusUndo(id) {
    const key = String(id);
    const p = pendingUndoById.get(key);
    if (!p) return;
    p.gen = -1;
    if (p.raf) cancelAnimationFrame(p.raf);
    pendingUndoById.delete(key);
  }

  // 几何居中的勾选 SVG（避免 ✓ 字形在圆内偏左上）
  const CHECK_ICO = '<svg class="card-check-ico" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.1 6.3l2.7 2.7 5.1-5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function statusActionIcon(done) {
    // 稳态：空心圆=待执行，勾=已完成；撤销倒计时另用 ↩
    if (done) return { cls: '', html: CHECK_ICO };
    return { cls: ' is-pending-mark', html: '' };
  }

  function resetToggleButton(btn, t) {
    if (!btn) return;
    const done = t.status === 'done';
    const ico = statusActionIcon(done);
    btn.className = 'card-action' + (done ? ' is-done' : '');
    btn.style.width = '';
    btn.style.height = '';
    btn.removeAttribute('aria-busy');
    btn.title = done ? '取消完成' : '标记完成';
    btn.setAttribute('aria-label', done ? '取消完成' : '标记完成');
    btn.innerHTML = `<span class="card-action-ico${ico.cls}" aria-hidden="true">${ico.html}</span>`;
  }

  function paintUndoButton(btn, remainMs, toDone) {
    const progress = Math.max(0, Math.min(1, 1 - remainMs / STATUS_UNDO_MS));
    const labelText = '↩';
    let fill = btn.querySelector('.card-action-fill');
    let label = btn.querySelector('.card-action-label');
    if (!fill || !label || !btn.classList.contains('is-countdown')) {
      btn.className = 'card-action is-countdown' + (toDone ? ' is-to-done' : ' is-to-pending');
      btn.setAttribute('aria-busy', 'true');
      btn.title = '点击撤销';
      btn.innerHTML = `
        <span class="card-action-fill"></span>
        <span class="card-action-label">${labelText}</span>`;
      fill = btn.querySelector('.card-action-fill');
      label = btn.querySelector('.card-action-label');
    } else {
      btn.classList.toggle('is-to-done', !!toDone);
      btn.classList.toggle('is-to-pending', !toDone);
      if (label) label.textContent = labelText;
    }
    btn.setAttribute('aria-label', `撤销倒计时，剩余约 ${Math.max(1, Math.ceil(remainMs / 1000))} 秒`);
    if (fill) fill.style.transform = `scaleX(${progress.toFixed(4)})`;
  }

  function beginCardStatusUndo(card, task, { onUndo, onCommit } = {}) {
    if (!card || !task || task.id == null) {
      if (typeof onCommit === 'function') onCommit();
      return;
    }
    const id = String(task.id);
    abandonCardStatusUndo(id);

    const btn = card.querySelector('[data-action="toggle"]');
    if (!btn) {
      if (typeof onCommit === 'function') onCommit();
      return;
    }

    // 书签固定尺寸，不清宽度锁；只清旧监听
    const cleanBtn = btn.cloneNode(false);
    cleanBtn.type = 'button';
    cleanBtn.setAttribute('data-action', 'toggle');
    cleanBtn.className = btn.className;
    btn.replaceWith(cleanBtn);
    const actionBtn = cleanBtn;

    const toDone = task.status === 'done';
    const gen = ++statusUndoGen;
    const endsAt = performance.now() + STATUS_UNDO_MS;
    const entry = {
      gen,
      toDone,
      endsAt,
      raf: null,
      width: 0,
      onUndo,
      onCommit,
    };
    pendingUndoById.set(id, entry);

    const finishCommit = async () => {
      const cur = pendingUndoById.get(id);
      if (!cur || cur.gen !== gen) return;
      if (cur.raf) cancelAnimationFrame(cur.raf);
      pendingUndoById.delete(id);
      if (typeof onCommit === 'function') await onCommit();
    };

    const finishUndo = async () => {
      const cur = pendingUndoById.get(id);
      if (!cur || cur.gen !== gen) return;
      if (cur.raf) cancelAnimationFrame(cur.raf);
      pendingUndoById.delete(id);
      if (typeof onUndo === 'function') await onUndo();
    };

    actionBtn.onclick = (e) => {
      e.stopPropagation();
      finishUndo();
    };

    const tick = (now) => {
      const cur = pendingUndoById.get(id);
      if (!cur || cur.gen !== gen) return;
      const liveBtn = cardsEl && cardsEl.querySelector(`.card[data-task-id="${CSS.escape(id)}"] [data-action="toggle"]`);
      const targetBtn = liveBtn || actionBtn;
      if (liveBtn) {
        liveBtn.onclick = (e) => {
          e.stopPropagation();
          finishUndo();
        };
      }
      const remain = cur.endsAt - now;
      if (remain <= 0) {
        finishCommit();
        return;
      }
      if (targetBtn && targetBtn.isConnected) paintUndoButton(targetBtn, remain, cur.toDone);
      cur.raf = requestAnimationFrame(tick);
    };

    paintUndoButton(actionBtn, STATUS_UNDO_MS, toDone);
    entry.raf = requestAnimationFrame(tick);
  }

  // 柔和色板：每对是 [文字色, 背景色]，按 id 哈希稳定取色（色相差开，避免看起来都像同一种蓝）
  const PASTEL = [
    ['#409eff', '#ecf5ff'],
    ['#7c3aed', '#f3eefe'],
    ['#db2777', '#fce7f0'],
    ['#ea580c', '#fff4e6'],
    ['#0e9f6e', '#e6f6ef'],
    ['#d97706', '#fef3c7'],
    ['#0891b2', '#e0f7fa'],
    ['#e11d48', '#ffe4e6'],
  ];
  function hashColor(id) {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PASTEL[h % PASTEL.length];
  }

  function tagChips(t, { detail = false } = {}) {
    const ids = (t.tags || []).filter((id) => tagMap[id]);
    if (!ids.length) return '';
    const chips = ids.map((id) => {
      const [fg, bg] = hashColor(id);
      const cls = detail ? 'chip chip--detail' : 'chip';
      // 淡边框：同色约 28% 透明度，跟标签色配套又不抢眼
      return `<span class="${cls}" style="color:${fg};background:${bg};border-color:${fg}47">${esc(tagMap[id])}</span>`;
    }).join('');
    return `<div class="chips${detail ? ' chips--detail' : ''}">${chips}</div>`;
  }

  const CLOCK_ICON = '<svg class="card-time-ico" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M8 5v3.2l2 1.2" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** 卡片时间：相对时间为主，完整时间在 title；与彩色标签同级但视觉类别不同 */
  function cardTimeChip(iso, timeLabel) {
    const tip = iso ? `${timeLabel}：${fmtTime(iso)}` : `${timeLabel}：—`;
    const shown = iso ? (fmtRelative(iso) || fmtTimeShort(iso) || '—') : '—';
    return `<span class="card-time${iso ? '' : ' is-empty'}" title="${esc(tip)}">${CLOCK_ICON}<span class="card-time-text">${esc(shown)}</span></span>`;
  }

  function cardMetaChips(t, timeField, timeLabel, opts = {}) {
    const ids = (t.tags || []).filter((id) => tagMap[id]);
    const tagHtml = ids.map((id) => {
      const [fg, bg] = hashColor(id);
      return `<span class="chip" style="color:${fg};background:${bg};border-color:${fg}47">${esc(tagMap[id])}</span>`;
    }).join('');
    const isSelected = !!opts.isSelected;
    const pickHtml = `<button type="button" class="card-pick${isSelected ? ' on' : ''}" title="${isSelected ? '取消勾选' : '勾选'}" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${isSelected ? '取消勾选' : '勾选'}"><span class="card-pick-ring" aria-hidden="true">${isSelected ? CHECK_ICO : ''}</span></button>`;
    return `<div class="chips chips--meta">${tagHtml}<span class="card-meta-end">${cardTimeChip(t[timeField], timeLabel)}${pickHtml}</span></div>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // 通用关闭/删除图标（几何居中，避免 × 字形偏上）
  const CLOSE_ICON = '<svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true"><path d="M2.2 2.2l7.6 7.6M9.8 2.2L2.2 9.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const PLAY_BADGE = '<span class="thumb-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>';
  const ATT_ICON = '<svg class="att-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  function mediaSrc(item) {
    return API.mediaSrc(item);
  }

  function hydrateVideoThumbs(root) {
    if (!root || typeof bindVideoThumb !== 'function') return;
    root.querySelectorAll('video.thumb[data-video-src]').forEach((vid) => {
      const src = vid.getAttribute('data-video-src') || vid.getAttribute('src') || '';
      if (!src) return;
      bindVideoThumb(vid, src, () => window.showLightbox(src, { type: 'video' }));
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  /** 紧凑绝对时间：2026/8/13 15:02 */
  function fmtTimeShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 相对时间 */
  function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const t = d.getTime();
    if (!Number.isFinite(t)) return '';
    const diff = Date.now() - t;
    const sec = Math.round(diff / 1000);
    if (sec < 45) return '刚刚';
    if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} 分钟前`;
    if (sec < 86400) return `${Math.max(1, Math.round(sec / 3600))} 小时前`;
    if (sec < 86400 * 7) return `${Math.max(1, Math.round(sec / 86400))} 天前`;
    return fmtTimeShort(iso);
  }

  function metaTimeRow(label, iso, icon) {
    const empty = !iso;
    const abs = empty ? '尚未处理' : fmtTimeShort(iso);
    const rel = empty ? '' : fmtRelative(iso);
    const tip = empty ? `${label}：尚未处理` : `${label}：${fmtTime(iso)}`;
    return `<div class="prop-row${empty ? ' is-empty' : ''}" title="${esc(tip)}" role="listitem">
      <span class="prop-icon" aria-hidden="true">${icon}</span>
      <span class="prop-label">${esc(label)}</span>
      <span class="prop-abs">${esc(abs)}</span>
      ${rel ? `<span class="prop-rel">${esc(rel)}</span>` : ''}
    </div>`;
  }

  /** 详情顶栏时间 chip：完整日期时间，钉在滚动区之上 */
  function metaTimeChip(label, iso) {
    const empty = !iso;
    const abs = empty ? '尚未处理' : fmtTimeShort(iso);
    const tip = empty ? `${label}：尚未处理` : `${label}：${fmtTime(iso)}`;
    return `<span class="meta-chip${empty ? ' is-empty' : ''}" title="${esc(tip)}">
      <span class="meta-chip-label">${esc(label)}</span>
      <span class="meta-chip-value">${esc(abs)}</span>
    </span>`;
  }

  function resolveSavedFig(fig) {
    const parsed = typeof parseMediaFig === 'function' ? parseMediaFig(fig) : null;
    const kind = (parsed && parsed.kind) || 'image';
    const dataSrc = (parsed && parsed.dataSrc) || String((fig && fig.getAttribute('data-src')) || '');
    if (!dataSrc) return { kind };
    if (dataSrc.startsWith('data:')) return { kind, dataUrl: dataSrc };
    if (dataSrc.startsWith('pending:')) return { kind };
    return { kind, rel: dataSrc.replace(/^\/+/, '').replace(/\\/g, '/') };
  }

  function openSavedMediaMenu(e, fig) {
    if (typeof openMediaContextMenu !== 'function' || !fig) return;
    openMediaContextMenu({
      fig,
      clientX: e.clientX,
      clientY: e.clientY,
      canDelete: false,
      resolveLocal: () => resolveSavedFig(fig),
    });
  }

  let cardsMediaMenuBound = false;
  function ensureCardsMediaMenu() {
    if (cardsMediaMenuBound || !cardsEl) return;
    cardsMediaMenuBound = true;
    cardsEl.addEventListener('contextmenu', (e) => {
      const fig = e.target && e.target.closest && e.target.closest('.doc-preview figure.doc-media');
      if (!fig) return;
      e.preventDefault();
      e.stopPropagation();
      openSavedMediaMenu(e, fig);
    });
  }

  function renderCards(tasks, {
    onQuickToggle,
    onOpen,
    emptyText,
    timeField = 'createdAt',
    timeLabel = '创建',
    matchById,
    selectedIds,
    onToggleSelect,
  } = {}) {
    ensureCardsMediaMenu();
    cardsEl.innerHTML = '';
    if (!tasks.length) {
      cardsEl.innerHTML = `<p class="empty">${esc(emptyText || '暂无任务')}</p>`;
      return;
    }
    const selected = selectedIds instanceof Set ? selectedIds : null;
    const hasSelection = !!(selected && selected.size);
    for (const t of tasks) {
      const card = document.createElement('div');
      const isSelected = !!(selected && t.id != null && selected.has(String(t.id)));
      card.className = 'card'
        + (t.status === 'done' ? ' done' : '')
        + (hasSelection ? ' select-mode' : '')
        + (isSelected ? ' is-selected' : '');
      const done = t.status === 'done';
      const atts = (t.attachments || []).map((a) => {
        const rel = typeof a === 'string' ? a : a.rel;
        const name = rel ? rel.split('/').pop() : (typeof a === 'object' && a.name) || '';
        return name ? `<span class="card-att" title="${esc(name)}">${ATT_ICON}<span>${esc(name)}</span></span>` : '';
      }).filter(Boolean).join('');
      const attRow = atts ? `<div class="att-chips">${atts}</div>` : '';
      const matchRow = matchHintHtml(matchById && t.id != null ? matchById[t.id] : null);
      const ocrRow = cardOcrProgressHtml(t.id);
      card.dataset.taskId = t.id;
      const actionLabel = done ? '取消完成' : '标记完成';
      const statusIco = done
        ? `<span class="card-action-ico" aria-hidden="true">${CHECK_ICO}</span>`
        : '<span class="card-action-ico is-pending-mark" aria-hidden="true"></span>';
      card.innerHTML = `
        <button type="button" class="card-action${done ? ' is-done' : ''}" data-action="toggle" title="${actionLabel}" aria-label="${actionLabel}">${statusIco}</button>
        <div class="card-main">
          <div class="card-title">
            ${typeof cardDocPreviewHtml === 'function' ? cardDocPreviewHtml(t) : `<div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>`}
          </div>
          ${matchRow}
          ${attRow}
          ${cardMetaChips(t, timeField, timeLabel, { isSelected })}
          ${ocrRow}
        </div>`;
      card.querySelector('.card-pick').addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onToggleSelect === 'function') onToggleSelect(t);
      });
      const toggleBtn = card.querySelector('[data-action="toggle"]');
      if (toggleBtn) {
        const pending = pendingUndoById.get(String(t.id));
        if (pending) {
          const remain = Math.max(0, pending.endsAt - performance.now());
          if (remain > 0) {
            paintUndoButton(toggleBtn, remain, pending.toDone);
            toggleBtn.onclick = (e) => {
              e.stopPropagation();
              const cur = pendingUndoById.get(String(t.id));
              if (!cur) return;
              const undo = cur.onUndo;
              abandonCardStatusUndo(t.id);
              if (typeof undo === 'function') undo();
            };
          } else {
            const commit = pending.onCommit;
            abandonCardStatusUndo(t.id);
            if (typeof commit === 'function') commit();
          }
        } else {
          toggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof onQuickToggle === 'function') onQuickToggle(t);
          };
        }
      }
      card.addEventListener('click', () => onOpen(t));
      cardsEl.appendChild(card);
    }
  }

  function cardOcrProgressHtml(taskId) {
    const map = window.ocrTaskProgress;
    const p = map && taskId != null ? map[taskId] : null;
    if (!p || p.status === 'done') return '';
    const cur = p.current || 0;
    const total = p.total || 0;
    const pct = total ? Math.round((cur / total) * 100) : 0;
    return `<div class="card-ocr" aria-live="polite">
      <div class="card-ocr-label">识别图内文字 ${cur}/${total}</div>
      <div class="card-ocr-track"><div class="card-ocr-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  /** 搜索命中提示：每条命中单独一行（来源 + 片段） */
  function matchHintHtml(info) {
    if (!info) return '';
    const hits = Array.isArray(info.hits) && info.hits.length
      ? info.hits
      : (info.primary ? [info.primary] : []);
    if (!hits.length) return '';
    const rows = hits.map((hit) => {
      const kind = hit.source === 'ocr' ? 'ocr' : hit.source === 'attachment' ? 'att' : 'text';
      const snip = highlightQuery(hit.snippet || '', hit.query || '');
      return `<div class="card-match" title="${esc((hit.label || '') + '：' + (hit.snippet || ''))}">
        <span class="card-match-badge is-${kind}">${esc(hit.label || '')}</span>
        <span class="card-match-snip">${snip}</span>
      </div>`;
    }).join('');
    return `<div class="card-match-list">${rows}</div>`;
  }

  function highlightQuery(text, query) {
    const raw = String(text == null ? '' : text);
    const q = String(query == null ? '' : query).trim();
    if (!raw) return '';
    if (!q) return esc(raw);
    const lower = raw.toLowerCase();
    const ql = q.toLowerCase();
    let out = '';
    let i = 0;
    while (i < raw.length) {
      const at = lower.indexOf(ql, i);
      if (at < 0) {
        out += esc(raw.slice(i));
        break;
      }
      out += esc(raw.slice(i, at));
      out += `<mark>${esc(raw.slice(at, at + q.length))}</mark>`;
      i = at + q.length;
    }
    return out;
  }

  function appendThumbTile(parent, { kind, src, onRemove, onPreview }) {
    const tile = document.createElement('div');
    tile.className = 'thumb-tile' + (kind === 'video' ? ' is-video' : '');
    if (kind === 'video') {
      const vid = document.createElement('video');
      vid.className = 'thumb';
      vid.muted = true;
      vid.preload = 'metadata';
      vid.playsInline = true;
      vid.draggable = false;
      vid.title = '点击播放';
      vid.setAttribute('data-video-src', src);
      tile.appendChild(vid);
      tile.insertAdjacentHTML('beforeend', PLAY_BADGE);
      const play = () => onPreview(src, { type: 'video' });
      if (typeof bindVideoThumb === 'function') {
        bindVideoThumb(vid, src, play);
      } else {
        vid.src = src;
        vid.addEventListener('click', (e) => { e.stopPropagation(); play(); });
      }
    } else {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = src;
      img.draggable = false;
      img.title = '点击放大';
      img.addEventListener('click', () => onPreview(src, { type: 'image' }));
      tile.appendChild(img);
    }
    if (onRemove) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'remove';
      btn.title = '删除';
      btn.draggable = false;
      btn.setAttribute('aria-label', '删除');
      btn.innerHTML = CLOSE_ICON;
      btn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      btn.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
      tile.appendChild(btn);
    }
    parent.appendChild(tile);
  }

  function bindThumbReorder(box, onReorder) {
    const tiles = [...box.querySelectorAll('.thumb-tile')];
    if (tiles.length < 2 || typeof onReorder !== 'function') return;
    let suppressClick = false;
    tiles.forEach((tile, i) => {
      tile.draggable = true;
      tile.dataset.index = String(i);
      tile.classList.add('is-reorderable');
      tile.title = (tile.querySelector('.thumb') && tile.querySelector('.thumb').title
        ? tile.querySelector('.thumb').title + ' · '
        : '') + '拖动调整顺序';
      tile.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        suppressClick = true;
        window.__kanbanThumbDrag = true;
        tile.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(THUMB_DND_TYPE, String(i));
        e.dataTransfer.setData('text/plain', `kanban-thumb:${i}`);
      });
      tile.addEventListener('dragend', () => {
        window.__kanbanThumbDrag = false;
        tile.classList.remove('is-dragging');
        tiles.forEach((t) => t.classList.remove('drop-target'));
        setTimeout(() => { suppressClick = false; }, 0);
      });
      tile.addEventListener('dragover', (e) => {
        if (!isThumbReorderEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        tiles.forEach((t) => t.classList.toggle('drop-target', t === tile));
      });
      tile.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && tile.contains(e.relatedTarget)) return;
        tile.classList.remove('drop-target');
      });
      tile.addEventListener('drop', (e) => {
        if (!isThumbReorderEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        tile.classList.remove('drop-target');
        const raw = e.dataTransfer.getData(THUMB_DND_TYPE) || e.dataTransfer.getData('text/plain') || '';
        const from = Number(String(raw).replace(/^kanban-thumb:/, ''));
        const to = Number(tile.dataset.index);
        if (Number.isInteger(from) && Number.isInteger(to) && from !== to) onReorder(from, to);
      });
      tile.addEventListener('click', (e) => {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
    });
    box.addEventListener('dragover', (e) => {
      if (!isThumbReorderEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    });
  }

  function renderNewThumbs({ media, onRemove, onPreview, onReorder, el }) {
    const box = el || thumbsEl;
    if (!box) return;
    box.innerHTML = '';
    (media || []).forEach((m, i) => {
      const kind = m && m.kind === 'video' ? 'video' : 'image';
      const src = mediaSrc(m);
      appendThumbTile(box, {
        kind,
        src,
        onRemove: () => onRemove(i),
        onPreview,
      });
    });
    bindThumbReorder(box, onReorder);
  }

  // 按扩展名返回文件类型 SVG 图标（市面通行风格：文件轮廓 + 类型角签）
  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const kind = {
      // 常见类型映射到角签文字与颜色
      pdf: ['PDF', '#f56c6c'],
      zip: ['ZIP', '#ea580c'], rar: ['RAR', '#ea580c'], '7z': ['7Z', '#ea580c'], gz: ['GZ', '#ea580c'], tar: ['TAR', '#ea580c'],
      doc: ['DOC', '#409eff'], docx: ['DOCX', '#409eff'],
      xls: ['XLS', '#0e9f6e'], xlsx: ['XLSX', '#0e9f6e'], csv: ['CSV', '#0e9f6e'],
      ppt: ['PPT', '#db2777'], pptx: ['PPTX', '#db2777'],
      txt: ['TXT', '#606266'], md: ['MD', '#606266'], json: ['JSON', '#606266'],
      mp3: ['MP3', '#7c3aed'], mp4: ['MP4', '#7c3aed'], avi: ['AVI', '#7c3aed'], mov: ['MOV', '#7c3aed'],
      exe: ['EXE', '#409eff'], dmg: ['DMG', '#409eff'], apk: ['APK', '#409eff'],
      html: ['HTML', '#ea580c'], css: ['CSS', '#409eff'], js: ['JS', '#db2777'], ts: ['TS', '#409eff'],
    };
    // 图片类型用图形图标而非角签
    if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) {
      return `<svg class="att-ficon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0e9f6e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    }
    const [label, color] = kind[ext] || ['FILE', '#909399'];
    return `<span class="att-fbadge" style="--fc:${color}">${esc(label)}</span>`;
  }

  function renderDetail(t) {
    const done = t.status === 'done';
    // 主栏：状态 + 标签；时间栏独立不变
    const tagsHtml = tagChips(t, { detail: true });
    document.getElementById('detailHead').innerHTML =
      `<span class="status-badge ${done ? 'done' : 'pending'}">${done ? '已执行' : '待执行'}</span>${tagsHtml}`;
    const metaEl = document.getElementById('detailMeta');
    metaEl.hidden = false;
    metaEl.innerHTML = `
      <div class="meta-chips" role="list" aria-label="时间信息">
        ${metaTimeChip('创建', t.createdAt)}
        ${metaTimeChip('状态', t.statusAt)}
        ${metaTimeChip('编辑', t.updatedAt)}
      </div>`;
    const atts = (t.attachments || []).map((a) => {
      const rel = typeof a === 'string' ? a : a.rel;
      return rel;
    }).filter(Boolean).map((rel) => {
      const name = rel.split('/').pop();
      return `<div class="att-row" data-rel="${esc(rel)}" role="button" tabindex="0"
           title="${esc(name)}（点击用外部软件打开）">
         <span class="att-badge">${ATT_ICON}</span>
         <span class="att-name">${esc(name)}</span>
         <svg class="att-arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M7 7h10v10"/></svg>
       </div>`;
    }).join('');
    detailBody.innerHTML = `
      ${typeof detailDocHtml === 'function' ? detailDocHtml(t) : `<div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>`}
      ${atts ? `
        <section class="att-section">
          <header class="att-head"><h3>附件</h3><span class="att-count">${(t.attachments || []).length}</span></header>
          <div class="att-list">${atts}</div>
        </section>`
      : ''}`;
    detailBody.querySelectorAll('.doc-view img, .doc-image img').forEach((im) => {
      im.addEventListener('click', () => {
        const fig = im.closest('[data-src]');
        const raw = (fig && fig.getAttribute('data-src')) || im.src;
        const src = raw && !String(raw).startsWith('pending:')
          ? (API.imageUrl && !/^https?:|data:|taskimage:/i.test(raw) ? API.imageUrl(raw) : raw)
          : im.src;
        window.showLightbox(src, { type: 'image' });
      });
    });
    detailBody.querySelectorAll('.doc-video').forEach((fig) => {
      const vid = fig.querySelector('video');
      if (!vid) return;
      const syncAspect = () => {
        if (!vid.videoWidth || !vid.videoHeight) return;
        vid.style.aspectRatio = vid.videoWidth + ' / ' + vid.videoHeight;
      };
      if (vid.videoWidth) syncAspect();
      else vid.addEventListener('loadedmetadata', syncAspect, { once: true });
      if (typeof captureVideoPoster === 'function') {
        captureVideoPoster(vid.currentSrc || vid.src).then((poster) => {
          if (poster) vid.setAttribute('poster', poster);
        });
      }
    });
    detailBody.querySelectorAll('.att-row').forEach((row) => {
      const open = () => API.openAttachment(row.dataset.rel);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    detailBody.oncontextmenu = (e) => {
      const fig = e.target && e.target.closest && e.target.closest('.doc-view figure.doc-media, figure.doc-media');
      if (!fig || !detailBody.contains(fig)) return;
      e.preventDefault();
      openSavedMediaMenu(e, fig);
    };
  }

  // 下拉多选：selectedIds 为选中的 tag id 数组；onChange 回调新选择。
  // 最多显示 2 个已选标签，超出显示 +N（参考 element-plus select 多选）。
  // els 可传入自定义节点，默认首页 #tagFilter*
  function resolveTagEls(els) {
    if (els && els.selected) return els;
    return {
      selected: document.getElementById('tagFilterSelected'),
      control: document.getElementById('tagFilterControl'),
      options: document.getElementById('tagFilterOptions'),
      search: document.getElementById('tagFilterSearch'),
    };
  }

  function renderTagSelected(selectedIds, onRemove, els) {
    const { selected: sel, control } = resolveTagEls(els);
    if (!sel) return;
    // 兼容旧调用：renderTagSelected(ids, els)
    if (onRemove && typeof onRemove === 'object' && !Array.isArray(onRemove)) {
      els = onRemove;
      onRemove = null;
    }
    const pairs = (selectedIds || [])
      .map((id) => ({ id, name: tagMap[id] }))
      .filter((p) => p.name);
    if (control) control.classList.toggle('has-value', pairs.length > 0);
    if (!pairs.length) {
      sel.innerHTML = '<span class="ms-placeholder">选择标签</span>';
      return;
    }
    const MAX = 2;
    const shown = pairs.slice(0, MAX);
    const extra = pairs.length - MAX;
    const names = pairs.map((p) => p.name);
    const more = extra > 0
      ? `<button type="button" class="ms-more" title="${esc(names.join(', '))}">+${extra}</button>`
      : '';
    sel.innerHTML = shown.map((p) =>
      `<span class="ms-tag ms-tag-removable" data-id="${esc(p.id)}">`
      + `<span class="ms-tag-label">${esc(p.name)}</span>`
      + `<button type="button" class="ms-tag-x" data-id="${esc(p.id)}" title="移除" aria-label="移除 ${esc(p.name)}">${CLOSE_ICON}</button>`
      + `</span>`
    ).join('') + more;
    if (typeof onRemove === 'function') {
      sel.querySelectorAll('.ms-tag-x').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(btn.dataset.id);
        });
      });
    }
  }

  /** 新建/编辑：展示全部已选芯片，带 × 可移除 */
  function renderTagSelectedRemovable(selectedIds, onRemove, els) {
    const { selected: sel, control } = resolveTagEls(els);
    if (!sel) return;
    const pairs = (selectedIds || [])
      .map((id) => ({ id, name: tagMap[id] }))
      .filter((p) => p.name);
    if (control) control.classList.toggle('has-value', pairs.length > 0);
    if (!pairs.length) {
      const emptyHint = (els && els.emptyPlaceholder) || '选择标签';
      sel.innerHTML = `<span class="ms-placeholder">${esc(emptyHint)}</span>`;
      return;
    }
    sel.innerHTML = pairs.map((p) =>
      `<span class="ms-tag ms-tag-removable" data-id="${esc(p.id)}">`
      + `<span class="ms-tag-label">${esc(p.name)}</span>`
      + `<button type="button" class="ms-tag-x" data-id="${esc(p.id)}" title="移除" aria-label="移除 ${esc(p.name)}">${CLOSE_ICON}</button>`
      + `</span>`
    ).join('');
    sel.querySelectorAll('.ms-tag-x').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onRemove === 'function') onRemove(btn.dataset.id);
      });
    });
  }

  // 渲染下拉选项，支持关键字过滤（element-plus filterable 风格）
  function drawOptions(tags, selectedIds, query, onChange, els) {
    const { options: box } = resolveTagEls(els);
    if (!box) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
    box.innerHTML = filtered.length
      ? filtered.map((t) =>
          `<label class="ms-option" data-id="${esc(t.id)}"><input type="checkbox" ${selectedIds.includes(t.id) ? 'checked' : ''}/>${esc(t.name)}</label>`
        ).join('')
      : '<div class="ms-option empty">无匹配标签</div>';
    box.querySelectorAll('.ms-option').forEach((opt) => {
      const input = opt.querySelector('input');
      if (!input) return; // 空态“无匹配标签”无功能
      opt.addEventListener('click', (e) => {
        e.stopPropagation(); // 避免点击选项时触发外层收起
        const id = opt.dataset.id;
        onChange(id, input.checked); // click 触发时 checkbox 已被切换，直接用其新状态
      });
    });
  }

  const TAG_RENAME_ICO = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  const TAG_DEL_ICO = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
  const TAG_HANDLE_ICO = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg>';
  const TAG_DND_TYPE = 'application/x-kanban-tag';

  function isTagReorderEvent(e) {
    const types = e.dataTransfer && e.dataTransfer.types ? [...e.dataTransfer.types] : [];
    return types.includes(TAG_DND_TYPE);
  }

  function bindTagOptionReorder(box, onReorder, canReorder) {
    const opts = [...box.querySelectorAll('.ms-option-manage')];
    if (opts.length < 2 || typeof onReorder !== 'function') return;
    const allow = () => (typeof canReorder === 'function' ? canReorder() !== false : true);
    let dragFrom = null;
    let fromId = null;
    let lastOver = null;
    let committed = false;
    let rowH = 36;

    const clearPreview = () => {
      opts.forEach((o) => {
        o.classList.remove('drop-target', 'drop-before', 'drop-after', 'shift-up', 'shift-down', 'is-dragging');
        o.style.removeProperty('--ms-opt-shift');
      });
      box.classList.remove('is-tag-reordering');
    };

    const applyShiftPreview = (fromOpt, overOpt) => {
      if (!fromOpt || !overOpt || fromOpt === overOpt) {
        opts.forEach((o) => o.classList.remove('shift-up', 'shift-down', 'drop-before', 'drop-after', 'drop-target'));
        return;
      }
      const fromIdx = opts.indexOf(fromOpt);
      const toIdx = opts.indexOf(overOpt);
      if (fromIdx < 0 || toIdx < 0) return;
      const movingDown = fromIdx < toIdx;
      opts.forEach((o, i) => {
        o.classList.remove('shift-up', 'shift-down', 'drop-before', 'drop-after', 'drop-target');
        o.style.setProperty('--ms-opt-shift', `${rowH}px`);
        if (o === fromOpt) return;
        if (movingDown && i > fromIdx && i <= toIdx) o.classList.add('shift-up');
        else if (!movingDown && i >= toIdx && i < fromIdx) o.classList.add('shift-down');
      });
      overOpt.classList.add(movingDown ? 'drop-after' : 'drop-before');
      overOpt.classList.add('drop-target');
    };

    /** transform 让位后，用视觉矩形找最近行（含原位，方便放回） */
    const findOverByY = (clientY) => {
      let best = null;
      let bestDist = Infinity;
      for (const o of opts) {
        const r = o.getBoundingClientRect();
        const mid = (r.top + r.bottom) / 2;
        const d = Math.abs(clientY - mid);
        if (d < bestDist) {
          bestDist = d;
          best = o;
        }
      }
      return best;
    };

    const resolveFromId = (e) => {
      const raw = (e && e.dataTransfer)
        ? (e.dataTransfer.getData(TAG_DND_TYPE) || e.dataTransfer.getData('text/plain') || '')
        : '';
      const fromData = String(raw).replace(/^kanban-tag:/, '');
      return fromData || fromId || (dragFrom && dragFrom.dataset.id) || '';
    };

    const commitReorder = (e, overOpt) => {
      if (committed) return;
      committed = true;
      if (!allow() || (typeof isConfirmOpen === 'function' && isConfirmOpen())) {
        clearPreview();
        return;
      }
      const srcId = resolveFromId(e);
      const target = overOpt || lastOver || (e && findOverByY(e.clientY));
      const toId = target && target.dataset ? target.dataset.id : '';
      clearPreview();
      // 放回原位：不调 API，仅结束拖动
      if (srcId && toId && srcId !== toId) onReorder(srcId, toId);
    };

    opts.forEach((opt) => {
      const handle = opt.querySelector('.ms-opt-handle');
      if (!handle) return;
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        if (!allow() || (typeof isConfirmOpen === 'function' && isConfirmOpen())) {
          e.preventDefault();
          return;
        }
        const id = opt.dataset.id;
        if (!id) { e.preventDefault(); return; }
        dragFrom = opt;
        fromId = id;
        lastOver = null;
        committed = false;
        rowH = Math.round(opt.getBoundingClientRect().height) || 36;
        box.classList.add('is-tag-reordering');
        opt.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TAG_DND_TYPE, id);
        e.dataTransfer.setData('text/plain', `kanban-tag:${id}`);
        try { e.dataTransfer.setDragImage(opt, 12, Math.min(16, rowH / 2)); } catch (_) { /* ignore */ }
      });
      handle.addEventListener('dragend', () => {
        // drop 可能落在 transform 空隙，未冒泡到行；用最后悬停目标兜底提交
        if (!committed && fromId && lastOver && lastOver.dataset.id !== fromId) {
          commitReorder(null, lastOver);
        } else {
          clearPreview();
        }
        dragFrom = null;
        fromId = null;
        lastOver = null;
      });
      opt.addEventListener('dragover', (e) => {
        if (!isTagReorderEvent(e)) return;
        if (!allow() || (typeof isConfirmOpen === 'function' && isConfirmOpen())) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const over = findOverByY(e.clientY) || opt;
        if (lastOver === over) return;
        lastOver = over;
        applyShiftPreview(dragFrom, over);
      });
      opt.addEventListener('drop', (e) => {
        if (!isTagReorderEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        commitReorder(e, findOverByY(e.clientY) || opt);
      });
    });
    box.addEventListener('dragover', (e) => {
      if (!isTagReorderEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const over = findOverByY(e.clientY);
      if (over && lastOver !== over) {
        lastOver = over;
        applyShiftPreview(dragFrom, over);
      }
    });
    box.addEventListener('drop', (e) => {
      if (!isTagReorderEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      commitReorder(e, findOverByY(e.clientY) || lastOver);
    });
  }

  /**
   * 新建/编辑：可管理选项（改名/删除/排序）+ 条件创建条
   * cbs: { onChange, onRename, onDelete, onCreate, onReorder, canReorder }
   */
  function drawManageableTagOptions(tags, selectedIds, query, cbs, els) {
    const { options: box } = resolveTagEls(els);
    if (!box) return;
    const onChange = cbs && cbs.onChange;
    const onRename = cbs && cbs.onRename;
    const onDelete = cbs && cbs.onDelete;
    const onCreate = cbs && cbs.onCreate;
    const onReorder = cbs && cbs.onReorder;
    const canReorderCb = cbs && cbs.canReorder;
    const raw = (query || '').trim();
    const qLower = raw.toLowerCase();
    const filtered = qLower ? tags.filter((t) => t.name.toLowerCase().includes(qLower)) : tags;
    const exact = qLower ? tags.some((t) => t.name.toLowerCase() === qLower) : false;
    const canCreate = raw.length > 0 && !exact;
    const showHandle = !raw && tags.length >= 2
      && (typeof canReorderCb !== 'function' || canReorderCb() !== false);

    let html = '';
    if (!tags.length && !raw) {
      html = '<div class="ms-option empty">尚无标签，输入名称后可创建</div>';
    } else if (filtered.length) {
      html = filtered.map((t) =>
        `<div class="ms-option ms-option-manage" data-id="${esc(t.id)}">`
        + (showHandle
          ? `<span class="ms-opt-handle" title="拖动调整顺序" aria-label="拖动调整顺序 ${esc(t.name)}" draggable="true">${TAG_HANDLE_ICO}</span>`
          : '')
        + `<label class="ms-option-main"><input type="checkbox" ${selectedIds.includes(t.id) ? 'checked' : ''}/><span class="ms-option-name">${esc(t.name)}</span></label>`
        + `<span class="ms-opt-actions">`
        + `<button type="button" class="ms-opt-btn ms-opt-rename" data-id="${esc(t.id)}" title="改名" aria-label="改名 ${esc(t.name)}">${TAG_RENAME_ICO}</button>`
        + `<button type="button" class="ms-opt-btn ms-opt-del" data-id="${esc(t.id)}" title="删除" aria-label="删除 ${esc(t.name)}">${TAG_DEL_ICO}</button>`
        + `</span></div>`
      ).join('');
      if (canCreate) {
        html += `<button type="button" class="ms-create-row" data-name="${esc(raw)}">创建 “${esc(raw)}”</button>`;
      }
    } else if (canCreate) {
      html = `<button type="button" class="ms-create-row" data-name="${esc(raw)}">创建 “${esc(raw)}”</button>`;
    } else {
      html = '<div class="ms-option empty">无匹配标签</div>';
    }
    box.innerHTML = html;

    box.querySelectorAll('.ms-option-manage').forEach((opt) => {
      const input = opt.querySelector('input');
      const main = opt.querySelector('.ms-option-main');
      if (main && input) {
        main.addEventListener('click', (e) => {
          e.stopPropagation();
          if (opt.classList.contains('is-renaming')) {
            e.preventDefault();
            return;
          }
          const id = opt.dataset.id;
          if (typeof onChange === 'function') onChange(id, input.checked);
        });
        input.addEventListener('click', (e) => {
          if (opt.classList.contains('is-renaming')) {
            e.preventDefault();
            e.stopPropagation();
          }
        });
      }
      const renameBtn = opt.querySelector('.ms-opt-rename');
      if (renameBtn) {
        renameBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onRename === 'function') onRename(opt.dataset.id, opt);
        });
      }
      const delBtn = opt.querySelector('.ms-opt-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onDelete === 'function') onDelete(opt.dataset.id);
        });
      }
    });
    const createBtn = box.querySelector('.ms-create-row');
    if (createBtn) {
      createBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onCreate === 'function') onCreate(createBtn.dataset.name || raw);
      });
    }
    if (showHandle && typeof onReorder === 'function') {
      bindTagOptionReorder(box, onReorder, canReorderCb);
    }
  }

  function renderManageableTagFilter(tags, selectedIds, cbs, els) {
    const nodes = resolveTagEls(els);
    const search = nodes.search;
    drawManageableTagOptions(tags, selectedIds, search ? search.value : '', cbs, nodes);
    if (search) {
      search.oninput = () => drawManageableTagOptions(tags, selectedIds, search.value, cbs, nodes);
    }
  }

  function renderTagFilter(tags, selectedIds, onChange, els) {
    const nodes = resolveTagEls(els);
    const search = nodes.search;
    drawOptions(tags, selectedIds, search ? search.value : '', onChange, nodes);
    if (search) search.oninput = () => drawOptions(tags, selectedIds, search.value, onChange, nodes);
  }

  function animateCardOut(taskId) {
    return new Promise((resolve) => {
      const id = String(taskId);
      const card = cardsEl && cardsEl.querySelector(`.card[data-task-id="${CSS.escape(id)}"]`);
      if (!card || card.classList.contains('is-leaving')) {
        resolve();
        return;
      }
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        resolve();
        return;
      }
      const height = card.offsetHeight;
      card.classList.add('is-leaving');
      card.style.height = `${height}px`;
      card.style.overflow = 'hidden';
      // 强制回流后再过渡到收起
      void card.offsetHeight;
      card.style.height = '0px';
      card.style.marginBottom = '0px';
      card.style.paddingTop = '0px';
      card.style.paddingBottom = '0px';
      card.style.opacity = '0';
      card.style.transform = 'translateY(-6px) scale(0.98)';

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        card.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target !== card) return;
        if (e.propertyName !== 'height' && e.propertyName !== 'opacity') return;
        finish();
      };
      card.addEventListener('transitionend', onEnd);
      setTimeout(finish, 380);
    });
  }

  return { esc, fmtTime, renderCards, renderNewThumbs, renderDetail, renderTagFilter, renderManageableTagFilter, renderTagSelected, renderTagSelectedRemovable, setTagMap, detailBody, detailActions, thumbsEl, drawOptions, drawManageableTagOptions, animateCardOut, beginCardStatusUndo, ATT_ICON, CLOSE_ICON };
})();
