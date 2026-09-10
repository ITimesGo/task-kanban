const ui = (() => {
  const cardsEl = document.getElementById('cards');
  const thumbsEl = document.getElementById('newThumbs');
  const detailBody = document.getElementById('detailBody');
  const detailActions = document.getElementById('detailActions');
  let tagMap = {}; // tagId -> tagName

  function setTagMap(map) { tagMap = map || {}; }

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

  function renderCards(tasks, { onQuickToggle, onOpen, emptyText, timeField = 'createdAt', timeLabel = '创建', matchById } = {}) {
    cardsEl.innerHTML = '';
    if (!tasks.length) {
      cardsEl.innerHTML = `<p class="empty">${esc(emptyText || '暂无任务')}</p>`;
      return;
    }
    for (const t of tasks) {
      const card = document.createElement('div');
      card.className = 'card' + (t.status === 'done' ? ' done' : '');
      const done = t.status === 'done';
      const media = API.taskMediaItems(t);
      const thumbs = media.slice(0, 4).map((m) => {
        const src = mediaSrc(m);
        if (m.kind === 'video') {
          return `<span class="thumb-wrap is-video"><video class="thumb" data-video-src="${esc(src)}" src="${esc(src)}" muted preload="metadata" playsinline></video>${PLAY_BADGE}</span>`;
        }
        return `<img class="thumb" loading="lazy" src="${esc(src)}">`;
      }).join('');
      const more = media.length > 4 ? `<span class="thumb-more">+${media.length - 4}</span>` : '';
      const thumbWrap = media.length
        ? `<div class="thumbs-row">${thumbs}${more}</div>`
        : '';
      // 附件：卡片上显示回形针图标 + 文件名，与标签区分
      const atts = (t.attachments || []).map((a) => {
        const rel = typeof a === 'string' ? a : a.rel;
        const name = rel ? rel.split('/').pop() : (typeof a === 'object' && a.name) || '';
        return name ? `<span class="card-att" title="${esc(name)}">${ATT_ICON}<span>${esc(name)}</span></span>` : '';
      }).filter(Boolean).join('');
      const attRow = atts ? `<div class="att-chips">${atts}</div>` : '';
      const matchRow = matchHintHtml(matchById && t.id != null ? matchById[t.id] : null);
      const ocrRow = cardOcrProgressHtml(t.id);
      const tv = t[timeField];
      const timeText = tv ? `${esc(timeLabel)} ${fmtTime(tv)}` : `${esc(timeLabel)} —`;
      card.dataset.taskId = t.id;
      card.innerHTML = `
        <button class="check${done ? ' done' : ''}" title="${done ? '取消完成' : '标记完成'}">${done ? '✓' : ''}</button>
        <div class="card-main">
          <div class="card-title">
            <div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>
            <div class="time">${timeText}</div>
          </div>
          ${matchRow}
          ${thumbWrap}
          ${attRow}
          ${tagChips(t)}
          ${ocrRow}
        </div>`;
      card.querySelector('.check').addEventListener('click', (e) => { e.stopPropagation(); onQuickToggle(t); });
      card.addEventListener('click', () => onOpen(t));
      cardsEl.appendChild(card);
    }
    hydrateVideoThumbs(cardsEl);
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
    // 顶栏一体：状态 + 时间信息；正文/图/附件可滚
    document.getElementById('detailHead').innerHTML =
      `<span class="status-badge ${done ? 'done' : 'pending'}">${done ? '已执行' : '待执行'}</span>`;
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
      <div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>
      ${tagChips(t, { detail: true })}
      ${(() => {
        const media = API.taskMediaItems(t);
        if (!media.length) return '';
        return `<div class="detail-img-list">${media.map((m) => {
          const src = mediaSrc(m);
          if (m.kind === 'video') {
            return `<div class="detail-media is-video" data-src="${esc(src)}">
              <video class="detail-video" src="${esc(src)}" controls playsinline preload="metadata"></video>
              <button type="button" class="detail-video-expand" data-src="${esc(src)}" title="全屏预览">全屏</button>
            </div>`;
          }
          return `<img class="detail-img" data-src="${esc(src)}" data-type="image" src="${esc(src)}" alt="">`;
        }).join('')}</div>`;
      })()}
      ${atts ? `
        <section class="att-section">
          <header class="att-head"><h3>附件</h3><span class="att-count">${(t.attachments || []).length}</span></header>
          <div class="att-list">${atts}</div>
        </section>`
      : ''}`;
    detailBody.querySelectorAll('.detail-img[data-type="image"], img.detail-img').forEach((im) => {
      if (im.closest('.detail-media')) return;
      im.addEventListener('click', () => window.showLightbox(im.dataset.src || im.src, { type: 'image' }));
    });
    detailBody.querySelectorAll('.detail-video-expand').forEach((btn) => {
      btn.addEventListener('click', () => window.showLightbox(btn.dataset.src, { type: 'video' }));
    });
    detailBody.querySelectorAll('video.detail-video').forEach((vid) => {
      // 截首帧作 poster，避免灰底
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

  function renderTagSelected(selectedIds, els) {
    const { selected: sel, control } = resolveTagEls(els);
    if (!sel) return;
    const tags = selectedIds.map((id) => tagMap[id]).filter(Boolean);
    if (control) control.classList.toggle('has-value', tags.length > 0);
    if (!tags.length) {
      sel.innerHTML = '<span class="ms-placeholder">选择标签</span>';
      return;
    }
    const MAX = 2;
    const shown = tags.slice(0, MAX);
    const extra = tags.length - MAX;
    const more = extra > 0 ? `<button type="button" class="ms-more" title="${esc(tags.join(', '))}">+${extra}</button>` : '';
    sel.innerHTML = shown.map((n) => `<span class="ms-tag">${esc(n)}</span>`).join('') + more;
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

  function renderTagFilter(tags, selectedIds, onChange, els) {
    const nodes = resolveTagEls(els);
    const search = nodes.search;
    drawOptions(tags, selectedIds, search ? search.value : '', onChange, nodes);
    if (search) search.oninput = () => drawOptions(tags, selectedIds, search.value, onChange, nodes);
  }

  return { esc, fmtTime, renderCards, renderNewThumbs, renderDetail, renderTagFilter, renderTagSelected, setTagMap, detailBody, detailActions, thumbsEl, drawOptions, ATT_ICON, CLOSE_ICON };
})();
