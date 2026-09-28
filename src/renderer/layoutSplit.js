/** 主布局：创建区可拖宽，宽度记在本机；窄窗时优先保证列表可读宽度 */
(function initLayoutSplit() {
  const KEY = 'kanban-create-panel-width';
  const DEFAULT_W = 400;
  const MIN_W = 320; // 空间充足时的首选最小宽
  const MIN_LIST = 280;
  const SPLIT_W = 8;

  const layout = document.getElementById('layout');
  const panel = document.getElementById('createPanel');
  const split = document.getElementById('layoutSplit');
  if (!layout || !panel || !split) return;

  function layoutWidth() {
    return layout.clientWidth || window.innerWidth || 1000;
  }

  /** 创建区上限：优先给列表留出 MIN_LIST，不再用 MIN_W 抬高上限 */
  function maxWidth() {
    const lw = layoutWidth();
    const byList = lw - MIN_LIST - SPLIT_W;
    const byPct = Math.floor(lw * 0.65);
    return Math.max(0, Math.min(byPct, byList));
  }

  function clamp(w) {
    const max = maxWidth();
    const n = Math.round(Number(w));
    if (!Number.isFinite(n)) return Math.min(DEFAULT_W, max) || max;
    if (max <= 0) return 0;
    // 窄窗时 max < MIN_W：允许创建区低于 320，避免挤扁列表
    const min = Math.min(MIN_W, max);
    return Math.min(max, Math.max(min, n));
  }

  function readSaved() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null || raw === '') return DEFAULT_W;
      const n = Number(raw);
      return Number.isFinite(n) ? n : DEFAULT_W;
    } catch (_) {
      return DEFAULT_W;
    }
  }

  function load() {
    return clamp(readSaved());
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
    split.setAttribute('aria-valuemax', String(maxWidth()));
    if (persist) save(next);
    return next;
  }

  /** 按本地偏好钳制目标宽（收起时也更新，避免展开先冲到旧宽度再闪回） */
  function applyPreferred() {
    return apply(readSaved());
  }

  function isCollapsed() {
    return !!(layout.classList.contains('is-create-collapsed') || panel.hidden);
  }

  applyPreferred();

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
    if (isCollapsed()) return false;
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
      apply(Math.min(MIN_W, maxWidth()), { persist: true });
    }
  });

  window.addEventListener('resize', () => {
    // 收起时也要钳目标宽；展开动画才能直接落到正确宽度
    if (isCollapsed() || !isInteractive()) {
      applyPreferred();
      return;
    }
    apply(panel.getBoundingClientRect().width || readSaved());
  });

  window.__layoutSplit = {
    reapplyWidth() {
      if (isCollapsed()) {
        applyPreferred();
        return;
      }
      apply(panel.getBoundingClientRect().width || readSaved());
    },
    /** 展开动画开始前调用：写入当前窗口下的目标宽 */
    prepareExpandWidth() {
      return applyPreferred();
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
