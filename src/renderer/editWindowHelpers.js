function parseEditTaskIdFromSearch(search) {
  const q = String(search || '');
  const sp = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
  const id = String(sp.get('edit') || '').trim();
  return id || null;
}

function editWindowTitle(_text) {
  return '编辑';
}

/** @param {{ dirty: boolean, action?: string, response?: number }} opts */
function resolveDirtyCloseAction({ dirty, action, response }) {
  if (!dirty) return 'close';
  if (action === 'save' || action === 'discard' || action === 'cancel') return action;
  // 兼容旧 MessageBox 下标
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
}

if (typeof window !== 'undefined') {
  window.EditWindowHelpers = {
    parseEditTaskIdFromSearch,
    editWindowTitle,
    resolveDirtyCloseAction,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseEditTaskIdFromSearch,
    editWindowTitle,
    resolveDirtyCloseAction,
  };
}
