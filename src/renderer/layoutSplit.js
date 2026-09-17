/** 主布局：创建区可拖宽，宽度记在本机 */
(function initLayoutSplit() {
  const KEY = 'kanban-create-panel-width';
  const DEFAULT_W = 400;
  const MIN_W = 320;
  const MIN_LIST = 280;
  const SPLIT_W = 6;

  const layout = document.getElementById('layout');
  const panel = document.getElementById('createPanel');
  const split = document.getElementById('layoutSplit');
  if (!layout || !panel || !split) return;

  function maxWidth() {
    const lw = layout.clientWidth || window.innerWidth || 1000;
    return Math.max(MIN_W, Math.min(Math.floor(lw * 0.65), lw - MIN_LIST - SPLIT_W));
  }

  function clamp(w) {
    const n = Math.round(Number(w));
    if (!Number.isFinite(n)) return DEFAULT_W;
    return Math.min(maxWidth(), Math.max(MIN_W, n));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null || raw === '') return DEFAULT_W;
      return clamp(raw);
    } catch (_) {
      return DEFAULT_W;
    }
  }

  function save(w) {
    try { localStorage.setItem(KEY, String(w)); } catch (_) {}
  }

  function apply(w, { persist } = {}) {
    const next = clamp(w);
    layout.style.setProperty('--create-panel-width', next + 'px');
    panel.style.width = next + 'px';
    panel.style.flex = '0 0 auto';
    split.setAttribute('aria-valuenow', String(next));
    if (persist) save(next);
    return next;
  }

  apply(load());

  let dragging = false;
  let startX = 0;
  let startW = 0;

  function onMove(e) {
    if (!dragging) return;
    const dx = startX - e.clientX; // 向左拖 → 变宽
    apply(startW + dx);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-resizing-layout');
    apply(panel.getBoundingClientRect().width, { persist: true });
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  function isInteractive() {
    const layoutEl = document.getElementById('layout');
    if (layoutEl && layoutEl.classList.contains('is-create-collapsed')) return false;
    return !split.classList.contains('is-inactive');
  }

  split.addEventListener('mousedown', (e) => {
    if (!isInteractive()) return;
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.body.classList.add('is-resizing-layout');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  split.addEventListener('dblclick', () => {
    if (!isInteractive()) return;
    apply(DEFAULT_W, { persist: true });
  });

  split.addEventListener('keydown', (e) => {
    if (!isInteractive()) return;
    const cur = panel.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      apply(cur + 16, { persist: true });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      apply(cur - 16, { persist: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      apply(maxWidth(), { persist: true });
    } else if (e.key === 'End') {
      e.preventDefault();
      apply(MIN_W, { persist: true });
    }
  });

  window.addEventListener('resize', () => {
    if (!isInteractive() || panel.hidden) return;
    apply(panel.getBoundingClientRect().width || load());
  });

  window.__layoutSplit = {
    reapplyWidth() {
      const layoutEl = document.getElementById('layout');
      if (layoutEl && layoutEl.classList.contains('is-create-collapsed')) return;
      if (panel.hidden) return;
      apply(panel.getBoundingClientRect().width || load());
    },
    setInteractive(on) {
      const enabled = !!on;
      split.classList.toggle('is-inactive', !enabled);
      split.style.pointerEvents = enabled ? '' : 'none';
      split.tabIndex = enabled ? 0 : -1;
      split.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    },
  };
})();
