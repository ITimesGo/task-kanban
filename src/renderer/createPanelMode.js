/** 新建区：固定右侧 / 收起为 FAB */

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

function getCreatePanelMode() {
  return createPanelModeState.mode;
}

function syncCreatePanelDom() {
  const { showPanel, showFab } = panelVisibility(createPanelModeState.mode, createPanelModeState.open);
  const layout = document.getElementById('layout');
  const panel = document.getElementById('createPanel');
  const fab = document.getElementById('createFab');
  const pinBtn = document.getElementById('createPinBtn');
  if (layout) layout.classList.toggle('is-create-collapsed', !showPanel);
  if (panel) {
    panel.hidden = !showPanel;
    panel.classList.toggle('hidden', !showPanel);
    panel.setAttribute('aria-hidden', showPanel ? 'false' : 'true');
  }
  if (window.__layoutSplit && typeof window.__layoutSplit.setInteractive === 'function') {
    window.__layoutSplit.setInteractive(showPanel);
  }
  if (showPanel && window.__layoutSplit && typeof window.__layoutSplit.reapplyWidth === 'function') {
    window.__layoutSplit.reapplyWidth();
  }
  if (fab) {
    fab.hidden = !showFab;
    fab.classList.toggle('hidden', !showFab);
  }
  if (pinBtn) {
    const pinned = createPanelModeState.mode === 'docked';
    pinBtn.classList.toggle('is-pinned', pinned);
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pinBtn.title = pinned ? '取消固定' : '固定在右侧';
    pinBtn.setAttribute('aria-label', pinBtn.title);
  }
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

function commitCreatePanelState(next, { persist } = {}) {
  createPanelModeState = {
    mode: normalizeMode(next.mode),
    open: !!next.open,
  };
  if (persist) persistCreatePanelMode(createPanelModeState.mode);
  syncCreatePanelDom();
}

function applyCreatePanelMode(nextMode, { reason = 'mode-change' } = {}) {
  commitCreatePanelState(
    reduceCreatePanelAction(createPanelModeState, 'applyMode', { mode: nextMode, reason }),
    { persist: false }
  );
}

function bindCreatePanelModeUi() {
  const fab = document.getElementById('createFab');
  const pinBtn = document.getElementById('createPinBtn');
  const collapseBtn = document.getElementById('createCollapseBtn');
  if (fab) {
    fab.addEventListener('click', () => {
      commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, 'openFab'), { persist: false });
      const ed = document.querySelector('#createEditor .ProseMirror, #createEditor .rich-surface, #createEditor [contenteditable="true"]');
      if (ed && typeof ed.focus === 'function') {
        requestAnimationFrame(() => ed.focus());
      }
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, 'collapse'), { persist: true });
    });
  }
  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      const action = createPanelModeState.mode === 'docked' ? 'unpin' : 'pin';
      commitCreatePanelState(reduceCreatePanelAction(createPanelModeState, action), { persist: true });
    });
  }
}

function bootCreatePanelModeUi() {
  bindCreatePanelModeUi();
  syncCreatePanelDom();
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
    syncCreatePanelDom,
  };
}
