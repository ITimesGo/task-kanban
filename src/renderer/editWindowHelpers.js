function parseEditTaskIdFromSearch(search) {
  const q = String(search || '');
  const sp = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
  const id = String(sp.get('edit') || '').trim();
  return id || null;
}

function editWindowTitle(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim() || '未命名';
  const slice = raw.length > 24 ? raw.slice(0, 24) + '…' : raw;
  return `编辑 · ${slice}`;
}

function resolveDirtyCloseAction({ dirty, response }) {
  if (!dirty) return 'close';
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
