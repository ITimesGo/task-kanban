/** 新建区：固定右侧 / 收起为 FAB */

const CREATE_PANEL_MOTION_MS = 240;
const CREATE_FAB_MOTION_MS = 180;

function normalizeMode(m) {
  return m === 'collapsed' ? 'collapsed' : 'docked';
}

function initialOpenForMode(mode) {
  return normalizeMode(mode) === 'docked';
}

function panelVisibility(mode, open) {
  const m = normalizeMode(mode);
  const showPanel = m === 'docked' || !!open;
  const showFab = m === 'collapsed' && !open;
  return { showPanel, showFab };
}

function reduceCreatePanelAction(state, action, payload) {
  const mode = normalizeMode(state && state.mode);
  const open = !!(state && state.open);
  switch (action) {
    case 'openFab':
      return { mode: 'collapsed', open: true };
    case 'collapse':
      return { mode: 'collapsed', open: false };
    case 'pin':
      return { mode: 'docked', open: true };
    case 'unpin':
      return { mode: 'collapsed', open: true };
    case 'applyMode': {
      const next = normalizeMode(payload && payload.mode);
      const reason = (payload && payload.reason) || 'mode-change';
      if (reason === 'same-mode' && next === mode) return { mode, open };
      if (reason === 'cold' || reason === 'mode-change' || next !== mode) {
        return { mode: next, open: initialOpenForMode(next) };
      }
      return { mode: next, open };
    }
    default:
      return { mode, open };
  }
}

let createPanelModeState = { mode: 'docked', open: true };
let createPanelMotionTimer = 0;
let createFabMotionTimer = 0;

function getCreatePanelMode() {
  return createPanelModeState.mode;
}

function isCreatePanelOpen() {
  return panelVisibility(createPanelModeState.mode, createPanelModeState.open).showPanel;
}

/** 收起时展开新建栏（不改默认视图偏好）。返回是否刚执行了展开。 */
function ensureCreatePanelOpen({ animate = true, focus = true } = {}) {
  const wasOpen = isCreatePanelOpen();
  if (!wasOpen) {
    commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, 'openFab'), {
      persist: false,
      animate,
    });
  }
  if (focus) {
    const delay = (!wasOpen && animate && !prefersReducedMotion())
      ? Math.round(CREATE_PANEL_MOTION_MS * 0.35)
      : 0;
    window.setTimeout(() => {
      const ed = document.querySelector('#createEditor .ProseMirror, #createEditor .rich-surface, #createEditor [contenteditable="true"]');
      if (ed && typeof ed.focus === 'function') ed.focus();
    }, delay);
  }
  return !wasOpen;
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setFabVisible(fab, visible, { instant = false } = {}) {
  if (!fab) return;
  if (createFabMotionTimer) {
    clearTimeout(createFabMotionTimer);
    createFabMotionTimer = 0;
  }
  if (visible) {
    fab.hidden = false;
    fab.classList.remove('hidden');
    if (instant || prefersReducedMotion()) {
      fab.classList.add('is-open');
      return;
    }
    fab.classList.remove('is-open');
    void fab.offsetWidth;
    requestAnimationFrame(() => {
      if (!fab.hidden) fab.classList.add('is-open');
    });
  } else if (instant || prefersReducedMotion() || !fab.classList.contains('is-open')) {
    fab.classList.remove('is-open');
    fab.hidden = true;
    fab.classList.add('hidden');
  } else {
    fab.classList.remove('is-open');
    createFabMotionTimer = window.setTimeout(() => {
      createFabMotionTimer = 0;
      fab.hidden = true;
      fab.classList.add('hidden');
    }, CREATE_FAB_MOTION_MS);
  }
}

function syncCreatePanelDom({ animate = true } = {}) {
  const { showPanel, showFab } = panelVisibility(createPanelModeState.mode, createPanelModeState.open);
  const layout = document.getElementById('layout');
  const panel = document.getElementById('createPanel');
  const fab = document.getElementById('createFab');
  const wasCollapsed = !!(layout && layout.classList.contains('is-create-collapsed'));
  const willCollapse = !showPanel;
  const visibilityChanged = wasCollapsed !== willCollapse;
  const doAnimate = animate && visibilityChanged && !prefersReducedMotion();

  if (createPanelMotionTimer) {
    clearTimeout(createPanelMotionTimer);
    createPanelMotionTimer = 0;
  }

  if (layout) {
    layout.classList.toggle('is-create-motion', doAnimate);
  }

  if (showPanel) {
    if (panel) {
      panel.hidden = false;
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
    }
    // 展开前先按当前窗口钳好目标宽，避免先冲到旧的 400 再闪回
    if (window.__layoutSplit && typeof window.__layoutSplit.prepareExpandWidth === 'function') {
      window.__layoutSplit.prepareExpandWidth();
    } else if (window.__layoutSplit && typeof window.__layoutSplit.reapplyWidth === 'function') {
      window.__layoutSplit.reapplyWidth();
    }
    // 展开：先以宽度 0 挂回布局，再下一帧去掉 collapsed，才能播宽度动画；列表随 flex 变宽
    if (doAnimate && wasCollapsed && layout && panel) {
      layout.classList.add('is-create-collapsed');
      if (window.__layoutSplit && typeof window.__layoutSplit.setInteractive === 'function') {
        window.__layoutSplit.setInteractive(false);
      }
      void panel.offsetWidth;
    }
    if (layout) layout.classList.remove('is-create-collapsed');
    if (window.__layoutSplit) {
      if (typeof window.__layoutSplit.setInteractive === 'function') {
        window.__layoutSplit.setInteractive(true);
      }
      if (!doAnimate && typeof window.__layoutSplit.reapplyWidth === 'function') {
        window.__layoutSplit.reapplyWidth();
      }
    }
    setFabVisible(fab, false, { instant: !doAnimate });
    if (doAnimate && layout) {
      createPanelMotionTimer = window.setTimeout(() => {
        createPanelMotionTimer = 0;
        layout.classList.remove('is-create-motion');
        if (window.__layoutSplit && typeof window.__layoutSplit.reapplyWidth === 'function') {
          window.__layoutSplit.reapplyWidth();
        }
      }, CREATE_PANEL_MOTION_MS);
    } else if (layout) {
      layout.classList.remove('is-create-motion');
    }
    return;
  }

  // 收起：宽度收到 0，列表被 flex 拉开；结束后再 hidden
  setFabVisible(fab, false, { instant: true });
  if (panel) {
    panel.hidden = false;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'true');
  }
  if (layout) layout.classList.add('is-create-collapsed');
  if (window.__layoutSplit && typeof window.__layoutSplit.setInteractive === 'function') {
    window.__layoutSplit.setInteractive(false);
  }

  const settle = () => {
    createPanelMotionTimer = 0;
    if (layout) layout.classList.remove('is-create-motion');
    if (panel) {
      panel.hidden = true;
      panel.classList.add('hidden');
    }
    if (showFab) setFabVisible(fab, true, { instant: !doAnimate });
  };

  if (!doAnimate) {
    settle();
    return;
  }
  createPanelMotionTimer = window.setTimeout(settle, CREATE_PANEL_MOTION_MS);
}

function persistCreatePanelMode(nextMode) {
  if (typeof loadViewDefaults !== 'function' || typeof saveViewDefaults !== 'function') return;
  const cur = loadViewDefaults();
  if (cur.createPanelMode === nextMode) return;
  saveViewDefaults({ ...cur, createPanelMode: nextMode });
  if (typeof fillViewDefaultsForm === 'function') {
    try { fillViewDefaultsForm(); } catch (_) { /* settings may be closed */ }
  }
}

function commitCreatePanelState(next, { persist = false, animate = true } = {}) {
  createPanelModeState = {
    mode: normalizeMode(next.mode),
    open: !!next.open,
  };
  if (persist) persistCreatePanelMode(createPanelModeState.mode);
  syncCreatePanelDom({ animate });
}

function applyCreatePanelMode(nextMode, { reason = 'mode-change' } = {}) {
  commitCreatePanelState(
    reduceCreatePanelAction(createPanelModeState, 'applyMode', { mode: nextMode, reason }),
    { persist: false, animate: reason !== 'cold' }
  );
}

function bindCreatePanelModeUi() {
  const fab = document.getElementById('createFab');
  const collapseBtn = document.getElementById('createCollapseBtn');
  if (fab) {
    fab.addEventListener('click', () => {
      commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, 'openFab'), {
        persist: false,
        animate: true,
      });
      const ed = document.querySelector('#createEditor .ProseMirror, #createEditor .rich-surface, #createEditor [contenteditable="true"]');
      if (ed && typeof ed.focus === 'function') {
        window.setTimeout(() => ed.focus(), CREATE_PANEL_MOTION_MS * 0.35);
      }
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      // 收起只改本次会话；启动仍按设置「默认视图」里的 createPanelMode
      commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, 'collapse'), {
        persist: false,
        animate: true,
      });
    });
  }
}

function bootCreatePanelModeUi() {
  bindCreatePanelModeUi();
  syncCreatePanelDom({ animate: false });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootCreatePanelModeUi);
  else bootCreatePanelModeUi();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeMode,
    initialOpenForMode,
    panelVisibility,
    reduceCreatePanelAction,
    applyCreatePanelMode,
    getCreatePanelMode,
    isCreatePanelOpen,
    ensureCreatePanelOpen,
    syncCreatePanelDom,
  };
}

if (typeof window !== 'undefined') {
  window.ensureCreatePanelOpen = ensureCreatePanelOpen;
  window.isCreatePanelOpen = isCreatePanelOpen;
}
