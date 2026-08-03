const ui = (() => {
  const cardsEl = document.getElementById('cards');
  const thumbsEl = document.getElementById('newThumbs');
  const detailBody = document.getElementById('detailBody');
  const detailActions = document.getElementById('detailActions');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function renderCards(tasks, { onQuickToggle, onOpen }) {
    cardsEl.innerHTML = '';
    if (!tasks.length) {
      cardsEl.innerHTML = '<p class="empty">暂无任务</p>';
      return;
    }
    for (const t of tasks) {
      const card = document.createElement('div');
      card.className = 'card' + (t.status === 'done' ? ' done' : '');
      const done = t.status === 'done';
      let thumb = '';
      if (t.images.length) {
        thumb = `<img class="thumb" loading="lazy" src="${esc(API.imageUrl(t.images[0]))}">`;
      }
      card.innerHTML = `
        <button class="quick${done ? ' done' : ''}">${done ? '取消完成' : '完成'}</button>
        <div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>
        ${thumb}
        <div class="time">${fmtTime(t.createdAt)}</div>`;
      card.querySelector('.quick').addEventListener('click', (e) => { e.stopPropagation(); onQuickToggle(t); });
      card.addEventListener('click', () => onOpen(t));
      cardsEl.appendChild(card);
    }
  }

  function renderNewThumbs({ images, onRemove, onPreview }) {
    thumbsEl.innerHTML = '';
    images.forEach((d, i) => {
      const tile = document.createElement('div');
      tile.className = 'thumb-tile';
      const img = document.createElement('img');
      img.src = d; // dataUrl
      img.title = '点击放大';
      img.addEventListener('click', () => onPreview(d));
      const btn = document.createElement('button');
      btn.className = 'remove'; btn.textContent = '×';
      btn.addEventListener('click', () => onRemove(i));
      tile.append(img, btn);
      thumbsEl.appendChild(tile);
    });
  }

  function renderDetail(t) {
    const done = t.status === 'done';
    detailBody.innerHTML = `
      <h2>任务详情</h2>
      <div class="status-badge ${done ? 'done' : 'pending'}">${done ? '已执行' : '待执行'}</div>
      <div class="text">${esc(t.text) || '<span class="muted">（无文字）</span>'}</div>
      ${t.images.map((r) => `<img class="detail-img" data-src="${esc(API.imageUrl(r))}" src="${esc(API.imageUrl(r))}">`).join('')}
      <div class="meta">创建于 ${fmtTime(t.createdAt)}</div>
      <div class="meta">更新于 ${fmtTime(t.updatedAt)}</div>`;
    detailBody.querySelectorAll('.detail-img').forEach((im) =>
      im.addEventListener('click', () => window.showLightbox(im.src)));
  }

  return { esc, fmtTime, renderCards, renderNewThumbs, renderDetail, detailBody, detailActions, thumbsEl };
})();
