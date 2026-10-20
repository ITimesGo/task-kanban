(function bootEditWindow() {
  const helpers = window.EditWindowHelpers || {};
  const id = helpers.parseEditTaskIdFromSearch
    ? helpers.parseEditTaskIdFromSearch(location.search)
    : null;
  if (!id) return;

  const isWarm = id === '__warm__';

  document.documentElement.classList.add('edit-window');
  if (document.body) document.body.classList.add('edit-window');
  else document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('edit-window');
  });
  window.__IS_EDIT_WINDOW__ = true;
  window.__EDIT_TASK_ID__ = isWarm ? null : id;
  window.__EDIT_WINDOW_WARM__ = isWarm;

  let tasksChangedBound = false;

  function setEditWindowTitle(text) {
    const title = (helpers.editWindowTitle || ((t) => '编辑 · ' + t))(text);
    document.title = title;
    const titleEl = document.getElementById('titlebar-title');
    if (titleEl) titleEl.textContent = title;
  }

  function mountEdit(task) {
    editing = task;
    detailState = { mode: 'edit', dataUrl: [] };
    window.__EDIT_TASK_ID__ = task && task.id != null ? String(task.id) : null;
    setEditWindowTitle(task && task.text);
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

  function bindTasksChanged() {
    if (tasksChangedBound || typeof API.onTasksChanged !== 'function') return;
    tasksChangedBound = true;
    API.onTasksChanged(async () => {
      if (window.__editWindowIsDirty && window.__editWindowIsDirty()) return;
      const tid = window.__EDIT_TASK_ID__;
      if (!tid) return;
      if (typeof loadTags === 'function') await loadTags();
      const fresh = typeof API.getTask === 'function' ? await API.getTask(tid) : null;
      if (!fresh) return;
      mountEdit(fresh);
    });
  }

  async function activateWithTask(task) {
    if (!task) {
      alert('任务不存在');
      try { window.close(); } catch (_) { /* ignore */ }
      return;
    }
    window.__EDIT_WINDOW_WARM__ = false;
    const tagsP = typeof loadTags === 'function' ? loadTags() : Promise.resolve();
    mountEdit(task);
    await tagsP;
    if (typeof refreshEditTagPicker === 'function') refreshEditTagPicker();
    bindTasksChanged();
  }

  (async () => {
    try {
      if (typeof initTheme === 'function') initTheme();
      if (typeof initAlwaysOnTop === 'function') initAlwaysOnTop();

      // 预热窗：先挂监听（避免 activate 早于 loadTags 丢事件），再预热标签
      if (isWarm) {
        let pendingTask = null;
        let ready = false;
        const accept = (task) => {
          if (!ready) { pendingTask = task; return; }
          activateWithTask(task);
        };
        if (typeof API.onEditActivate === 'function') {
          API.onEditActivate(accept);
        }
        if (typeof loadTags === 'function') {
          try { await loadTags(); } catch (_) { /* ignore */ }
        }
        ready = true;
        if (pendingTask) activateWithTask(pendingTask);
        return;
      }

      let task = typeof API.getTaskSync === 'function' ? API.getTaskSync(id) : null;
      if (!task && typeof API.getTask === 'function') {
        task = await API.getTask(id);
      } else if (!task) {
        task = (await API.getAllTasks()).find((t) => String(t.id) === String(id));
      }
      await activateWithTask(task);
    } catch (err) {
      console.error(err);
      alert((err && err.message) || '打开编辑窗口失败');
    }
  })();
})();
