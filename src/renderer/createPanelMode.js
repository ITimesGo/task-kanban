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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeMode,
    initialOpenForMode,
    panelVisibility,
    reduceCreatePanelAction,
  };
}
