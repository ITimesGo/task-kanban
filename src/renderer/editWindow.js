(function bootEditWindow() {
  const helpers = window.EditWindowHelpers || {};
  const id = helpers.parseEditTaskIdFromSearch
    ? helpers.parseEditTaskIdFromSearch(location.search)
    : null;
  if (!id) return;

  document.documentElement.classList.add('edit-window');
  if (document.body) document.body.classList.add('edit-window');
  else document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('edit-window');
  });
  window.__IS_EDIT_WINDOW__ = true;
  window.__EDIT_TASK_ID__ = id;

  function setEditWindowTitle(text) {
    const title = (helpers.editWindowTitle || ((t) => '编辑 · ' + t))(text);
    document.title = title;
    const titleEl = document.getElementById('titlebar-title');
    if (titleEl) titleEl.textContent = title;
  }

  function mountEdit(task) {
    editing = task;
    detailState = { mode: 'edit', dataUrl: [] };
    setEditWindowTitle(task.text);
    const overlay = document.getElementById('detailOverlay');
    if (overlay) overlay.classList.remove('hidden');
    if (typeof updateOpenDetail === 'function') updateOpenDetail();
  }

  window.__editWindowIsDirty = () =>
    typeof window._editIsDirty === 'function' && !!window._editIsDirty();

  window.__editWindowSave = async () => {
    if (typeof window.saveCurrentEdit === 'function') {
      return !!(await window.saveCurrentEdit());
    }
    return false;
  };

  (async () => {
    try {
      if (typeof initTheme === 'function') initTheme();
      if (typeof initAlwaysOnTop === 'function') initAlwaysOnTop();

      let task = typeof API.getTaskSync === 'function' ? API.getTaskSync(id) : null;
      if (!task && typeof API.getTask === 'function') {
        task = await API.getTask(id);
      } else if (!task) {
        task = (await API.getAllTasks()).find((t) => String(t.id) === String(id));
      }
      if (!task) {
        alert('任务不存在');
        try { window.close(); } catch (_) { /* ignore */ }
        return;
      }

      const tagsP = typeof loadTags === 'function' ? loadTags() : Promise.resolve();
      mountEdit(task);
      await tagsP;
      if (typeof refreshEditTagPicker === 'function') refreshEditTagPicker();

      if (typeof API.onTasksChanged === 'function') {
        API.onTasksChanged(async () => {
          if (window.__editWindowIsDirty && window.__editWindowIsDirty()) return;
          if (typeof loadTags === 'function') await loadTags();
          const fresh = typeof API.getTask === 'function'
            ? await API.getTask(id)
            : null;
          if (!fresh) return;
          mountEdit(fresh);
        });
      }
    } catch (err) {
      console.error(err);
      alert((err && err.message) || '打开编辑窗口失败');
    }
  })();
})();
