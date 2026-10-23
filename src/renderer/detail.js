async function settleStatusChange(id) {
  const key = String(id);
  const { list } = buildFilteredList();
  lastFilteredList = list;
  const stillVisible = list.some((x) => String(x.id) === key);

  // 待执行等筛选：卡片离场后只摘这一张，避免整表 renderCards 闪烁
  if (!stillVisible && ui && typeof ui.animateCardOut === 'function') {
    await ui.animateCardOut(key);
    const card = document.querySelector(`#cards .card[data-task-id="${CSS.escape(key)}"]`);
    if (card) card.remove();

    if (typeof pruneSelection === 'function') pruneSelection(list);
    if (typeof syncSelectionUI === 'function') syncSelectionUI();

    const total = list.length;
    const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (page > maxPage) {
      page = maxPage;
      await refresh({ reload: false });
      return;
    }
    if (typeof renderPagination === 'function') renderPagination(total, maxPage);

    const cardsRoot = document.getElementById('cards');
    const left = cardsRoot ? cardsRoot.querySelectorAll('.card').length : 0;
    if (left === 0) {
      if (total === 0 && cardsRoot) {
        cardsRoot.innerHTML = `<p class="empty">${searchQuery && searchQuery.trim() ? '没有匹配的任务' : '暂无任务'}</p>`;
      } else {
        await refresh({ reload: false });
      }
      return;
    }
    // 后台对齐磁盘，不重绘列表
    try {
      if (typeof API.getAllTasks === 'function') {
        const next = await API.getAllTasks();
        if (Array.isArray(next)) tasks = next;
      }
    } catch (_) { /* ignore */ }
    return;
  }

  // 「全部」等仍可见：只复位该卡状态钮，勿整表刷新
  const card = document.querySelector(`#cards .card[data-task-id="${CSS.escape(key)}"]`);
  const task = (tasks || []).find((x) => x && String(x.id) === key);
  if (card && task && ui && typeof ui.resetToggleButton === 'function') {
    card.classList.toggle('done', task.status === 'done');
    ui.resetToggleButton(card.querySelector('[data-action="toggle"]'), task);
    try {
      if (typeof API.getAllTasks === 'function') {
        const next = await API.getAllTasks();
        if (Array.isArray(next)) tasks = next;
      }
    } catch (_) { /* ignore */ }
    return;
  }

  await refresh();
}

async function toggleStatus(t, { skipUndo = false } = {}) {
  if (!t || t.id == null) return;
  const id = String(t.id);
  if (typeof clearSelection === 'function') clearSelection({ render: false });
  // 先占住刷新锁：toggle IPC 会立刻 fan-out tasks:changed；待执行筛选下否则会先拆掉卡片，动画全无
  const useUndo = !skipUndo && ui && typeof ui.beginCardStatusUndo === 'function';
  if (useUndo && typeof ui.holdStatusAnim === 'function') ui.holdStatusAnim(id);
  let updated;
  try {
    updated = await API.toggleStatus(t.id);
  } catch (err) {
    if (useUndo && typeof ui.releaseStatusAnim === 'function') ui.releaseStatusAnim(id);
    throw err;
  }
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) tasks[idx] = updated;
  if (editing && editing.id === t.id) {
    editing = updated;
    updateOpenDetail();
  }

  if (!useUndo) {
    await settleStatusChange(id);
    return;
  }

  const card = document.querySelector(`#cards .card[data-task-id="${CSS.escape(id)}"]`);
  if (!card) {
    try {
      await settleStatusChange(id);
    } finally {
      if (typeof ui.releaseStatusAnim === 'function') ui.releaseStatusAnim(id);
    }
    return;
  }

  card.classList.toggle('done', updated.status === 'done');
  ui.beginCardStatusUndo(card, updated, {
    onUndo: async () => {
      try {
        await toggleStatus(updated, { skipUndo: true });
      } finally {
        if (typeof ui.releaseStatusAnim === 'function') ui.releaseStatusAnim(id);
      }
    },
    onCommit: async () => {
      try {
        await settleStatusChange(id);
      } finally {
        if (typeof ui.releaseStatusAnim === 'function') ui.releaseStatusAnim(id);
      }
    },
  });
}

let _detailCloseTimer = 0;
let _detailCloseHandler = null;

function cancelDetailOverlayCloseAnim(overlay) {
  if (_detailCloseTimer) {
    clearTimeout(_detailCloseTimer);
    _detailCloseTimer = 0;
  }
  if (_detailCloseHandler && overlay) {
    overlay.removeEventListener('transitionend', _detailCloseHandler);
    _detailCloseHandler = null;
  }
}

function showDetailOverlay() {
  const overlay = document.getElementById('detailOverlay');
  if (!overlay) return;
  cancelDetailOverlayCloseAnim(overlay);
  overlay.classList.remove('hidden');
  // 独立编辑窗铺满客户区，不做缩放淡入
  if (window.__IS_EDIT_WINDOW__) {
    overlay.classList.add('is-open');
    return;
  }
  if (overlay.classList.contains('is-open')) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-open');
    });
  });
}

function hideDetailOverlay(afterHidden) {
  const overlay = document.getElementById('detailOverlay');
  const done = () => {
    if (typeof afterHidden === 'function') afterHidden();
  };
  if (!overlay || overlay.classList.contains('hidden')) {
    done();
    return;
  }
  if (window.__IS_EDIT_WINDOW__ || !overlay.classList.contains('is-open')) {
    cancelDetailOverlayCloseAnim(overlay);
    overlay.classList.remove('is-open');
    overlay.classList.add('hidden');
    done();
    return;
  }
  cancelDetailOverlayCloseAnim(overlay);
  overlay.classList.remove('is-open');
  const finish = () => {
    cancelDetailOverlayCloseAnim(overlay);
    if (!overlay.classList.contains('is-open')) {
      overlay.classList.add('hidden');
    }
    done();
  };
  _detailCloseHandler = (e) => {
    if (e.target !== overlay) return;
    if (e.propertyName && e.propertyName !== 'opacity') return;
    finish();
  };
  overlay.addEventListener('transitionend', _detailCloseHandler);
  _detailCloseTimer = window.setTimeout(finish, 360);
}

async function openDetail(t) {
  editing = t;
  detailState = { mode: 'view', dataUrl: [] };
  updateOpenDetail();
  showDetailOverlay();
}

function attSnapshotKey(a) {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    if (a.srcPath) return `path:${a.srcPath}`;
    if (a.rel) return `rel:${a.rel}`;
    if (a.name) return `name:${a.name}`;
  }
  return String(a);
}

function isEditDirty() {
  if (!detailState || detailState.mode !== 'edit') return false;
  const check = window._editIsDirty;
  return typeof check === 'function' ? !!check() : false;
}

/** 编辑态有未保存改动时确认；返回是否可以离开（保存 / 不保存 / 取消） */
async function confirmLeaveEditIfDirty() {
  if (!isEditDirty()) return true;
  const action = await showDirtyConfirm({
    detail: '保存后离开，或不保存丢弃更改。',
  });
  if (action === 'cancel') return false;
  if (action === 'save') {
    if (typeof window.saveCurrentEdit !== 'function') return false;
    return !!(await window.saveCurrentEdit());
  }
  return true;
}

async function leaveEditToDetailView() {
  if (!(await confirmLeaveEditIfDirty())) return false;
  if (typeof window._cleanupEditTagMenu === 'function') {
    try { window._cleanupEditTagMenu(); } catch (_) { /* ignore */ }
  }
  window._editIsDirty = null;
  detailState.mode = 'view';
  updateOpenDetail();
  return true;
}

async function closeDetailModal() {
  if (window.__IS_EDIT_WINDOW__) {
    try { window.close(); } catch (_) { /* ignore */ }
    return;
  }
  // 编辑态点右上角关闭：退回详情只读（与「取消」一致），不直接关掉弹窗
  if (detailState && detailState.mode === 'edit') {
    await leaveEditToDetailView();
    return;
  }
  hideDetailOverlay(() => {
    disposeEditEditor();
    window._editIsDirty = null;
    if (detailState) detailState.mode = 'view';
    syncDetailPopoutBtn();
    if (typeof window.syncClipboardQuickTargetLabel === 'function') {
      window.syncClipboardQuickTargetLabel();
    }
  });
}

function disposeEditEditor() {
  window._editIsDirty = null;
  if (typeof window._cleanupEditTagMenu === 'function') {
    try { window._cleanupEditTagMenu(); } catch (_) { /* ignore */ }
    window._cleanupEditTagMenu = null;
  }
  const ed = window.editEditor;
  window.editEditor = null;
  window.applyClipboardToEdit = null;
  if (ed && typeof ed.destroy === 'function') {
    try { ed.destroy(); } catch (_) { /* ignore */ }
  }
}

function setEditWindowChromeTitle(text) {
  const helpers = window.EditWindowHelpers;
  const title = helpers && helpers.editWindowTitle
    ? helpers.editWindowTitle(text)
    : '编辑';
  document.title = title;
  const titleEl = document.getElementById('titlebar-title');
  if (titleEl) titleEl.textContent = title;
}

function updateOpenDetail() {
  if (window.__IS_EDIT_WINDOW__) {
    // 独立编辑窗：始终编辑态，不进只读（避免露出删除/完成）
    detailState.mode = 'edit';
    disposeEditEditor();
    renderEditDetail();
    syncDetailPopoutBtn();
    return;
  }
  if (detailState.mode === 'edit') {
    disposeEditEditor();
    renderEditDetail();
    syncDetailPopoutBtn();
    return;
  } else {
    disposeEditEditor();
    if (typeof window.syncClipboardQuickTargetLabel === 'function') {
      window.syncClipboardQuickTargetLabel();
    }
    ui.renderDetail(editing);
    const done = editing.status === 'done';
    ui.detailActions.innerHTML = `
      <div class="detail-footer-left">
        <button id="delBtn" class="danger" type="button">移入回收站</button>
        <button id="toggleBtn" type="button">${done ? '取消完成' : '标记完成'}</button>
      </div>
      <div class="detail-footer-right">
        <button id="editBtn" class="primary" type="button">编辑</button>
      </div>`;
    document.getElementById('toggleBtn').addEventListener('click', () => toggleStatus(editing));
    document.getElementById('editBtn').addEventListener('click', async () => {
      // 已有独立编辑窗则只聚焦，避免详情与独立窗并行编辑冲突
      if (editing && editing.id != null && typeof API.focusEditWindow === 'function') {
        try {
          const r = await API.focusEditWindow(editing.id);
          if (r && r.focused) return;
        } catch (_) { /* 无 handler 时退回就地编辑 */ }
      }
      detailState.mode = 'edit';
      detailState.dataUrl = [];
      updateOpenDetail();
    });
    document.getElementById('delBtn').addEventListener('click', deleteTask);
  }
  syncDetailPopoutBtn();
}

function syncDetailPopoutBtn() {
  const btn = document.getElementById('openEditWinBtn');
  if (!btn) return;
  // 详情只读/就地编辑均可显示；独立编辑窗内隐藏
  const show = !window.__IS_EDIT_WINDOW__
    && editing
    && editing.id != null;
  btn.hidden = !show;
}

/**
 * 打开独立编辑窗（详情弹出 / 卡片按钮共用）。
 * 若详情正就地编辑：先处理脏数据，再开窗，并退回只读，避免并行编辑。
 */
async function openIndependentEditForTask(taskId, btn) {
  if (taskId == null) return;
  if (window.__IS_EDIT_WINDOW__) return;

  if (detailState && detailState.mode === 'edit' && editing) {
    if (isEditDirty()) {
      const same = String(editing.id) === String(taskId);
      const choice = await showDirtyConfirm({
        detail: same
          ? '独立窗口会加载已保存的内容。可先保存再打开，或不保存直接打开。'
          : '当前任务有未保存修改。可先保存，或不保存后打开独立窗口。',
        saveLabel: '保存后打开',
        discardLabel: '不保存打开',
      });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        if (typeof window.saveCurrentEdit !== 'function') return;
        if (!(await window.saveCurrentEdit())) return;
      } else {
        window._editIsDirty = null;
      }
    }
    disposeEditEditor();
    detailState.mode = 'view';
    updateOpenDetail();
  }

  if (typeof API.openEditWindowFromButton === 'function') {
    await API.openEditWindowFromButton(btn, taskId);
  } else if (typeof API.openEditWindow === 'function') {
    await API.openEditWindow(taskId);
  }

  if (editing && String(editing.id) === String(taskId) && detailState && detailState.mode === 'edit') {
    window._editIsDirty = null;
    disposeEditEditor();
    detailState.mode = 'view';
    updateOpenDetail();
  }
}

async function openIndependentEditFromDetail(btn) {
  if (!editing || editing.id == null) return;
  await openIndependentEditForTask(editing.id, btn);
}

window.openIndependentEditForTask = openIndependentEditForTask;

function renderEditDetail() {
  $('#detailHead').innerHTML = '<h2>编辑任务</h2>';
  const metaEl = document.getElementById('detailMeta');
  if (metaEl) { metaEl.hidden = true; metaEl.innerHTML = ''; }
  ui.detailBody.innerHTML = `
    <div id="editDrop">
      <div id="editEditor" class="rich-editor-host"></div>
      <div class="edit-side">
        <div id="editTagWrap" class="task-tag-wrap">
          <div id="editTagControl" class="multi-select">
            <div id="editTagSelected" class="ms-selected"><span class="ms-placeholder">选择标签</span></div>
            <span class="ms-arrow">▾</span>
          </div>
          <div id="editTagDropdown" class="ms-dropdown hidden">
            <input id="editTagSearch" class="ms-search" type="text" placeholder="搜索标签…" />
            <div id="editTagOptions"></div>
          </div>
        </div>
        <div id="editAttachments" class="attachments"></div>
      </div>
      <div id="editProgress" class="upload-progress hidden">
        <div class="up-bar"><div class="up-fill" id="editProgressFill"></div></div>
        <span class="up-text" id="editProgressText"></span>
      </div>
    </div>`;

  const editTagIds = (editing.tags || []).slice();
  /** @type {{ id: string, input: HTMLInputElement, orig: string } | null} */
  let editTagRename = null;
  const editTagEls = () => ({
    selected: document.getElementById('editTagSelected'),
    control: document.getElementById('editTagControl'),
    options: document.getElementById('editTagOptions'),
    search: document.getElementById('editTagSearch'),
    emptyPlaceholder: tagList.length ? '选择标签' : '尚无标签，输入名称后可创建',
  });
  const closeEditTagDropdown = () => {
    const dd = document.getElementById('editTagDropdown');
    const ctrl = document.getElementById('editTagControl');
    if (dd) dd.classList.add('hidden');
    if (ctrl) ctrl.classList.remove('open');
    editTagRename = null;
    editTagRenameCommitPromise = null;
  };
  let editTagRenameCommitPromise = null;
  const cancelEditTagRename = () => {
    if (!editTagRename) return;
    editTagRename = null;
    editTagRenameCommitPromise = null;
    syncEditTagOptions();
  };
  const commitEditTagRename = () => {
    if (editTagRenameCommitPromise) return editTagRenameCommitPromise;
    if (!editTagRename) return Promise.resolve(true);
    const state = editTagRename;
    if (!state.input) {
      editTagRename = null;
      syncEditTagOptions();
      return Promise.resolve(true);
    }
    const next = String(state.input.value || '').trim();
    const p = (async () => {
      if (next === state.orig) {
        editTagRename = null;
        syncEditTagOptions();
        return true;
      }
      const res = await API.renameTag(state.id, next);
      if (!res.ok) {
        alert(res.error || '保存失败');
        if (editTagRename && editTagRename.input === state.input) {
          try { state.input.focus(); } catch (_) { /* ignore */ }
        }
        return false;
      }
      editTagRename = null;
      tagList = res.tags;
      afterTagMutation();
      return true;
    })();
    editTagRenameCommitPromise = p;
    p.finally(() => {
      if (editTagRenameCommitPromise === p) editTagRenameCommitPromise = null;
    });
    return p;
  };
  const startEditTagRename = (id, optEl) => {
    if (!optEl || editTagRename) return;
    const t = tagList.find((x) => x.id === id);
    if (!t) return;
    editTagRename = { id, input: null, orig: t.name };
    syncEditTagOptions();
    const box = document.getElementById('editTagOptions');
    const row = box && box.querySelector(`.ms-option-manage[data-id="${CSS.escape(id)}"]`);
    if (!row) {
      editTagRename = null;
      syncEditTagOptions();
      return;
    }
    const nameEl = row.querySelector('.ms-option-name');
    if (!nameEl) {
      editTagRename = null;
      syncEditTagOptions();
      return;
    }
    row.classList.add('is-renaming');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ms-rename-input';
    input.maxLength = 15;
    input.value = t.name;
    nameEl.replaceWith(input);
    editTagRename = { id, input, orig: t.name };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEditTagRename();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!editTagRename || editTagRename.input !== input) return;
        commitEditTagRename();
      }, 0);
    });
    try { input.focus(); input.select(); } catch (_) { /* ignore */ }
  };
  const createTagFromEditPicker = async (name) => {
    try {
      const res = await API.createTag(name);
      if (!res || !res.ok) {
        alert((res && res.error) || '新增失败');
        return;
      }
      const beforeIds = new Set(tagList.map((t) => t.id));
      tagList = res.tags;
      const created = tagList.find((t) => !beforeIds.has(t.id));
      const search = document.getElementById('editTagSearch');
      if (search) search.value = '';
      afterTagMutation(created ? { selectedId: created.id, selectEdit: true } : {});
    } catch (err) {
      alert('新增失败：' + (err && err.message ? err.message : err));
    }
  };
  const deleteTagFromEditPicker = async (id) => {
    const res = await confirmDeleteTag(id);
    if (!res) return;
    tagList = res.tags;
    afterTagMutation({ deletedId: id });
  };
  const reorderTagFromEditPicker = async (fromId, toId) => {
    if (editTagRename || editTagRenameCommitPromise) return;
    if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
    try {
      const res = await API.reorderTag(fromId, toId);
      if (!res || !res.ok) {
        alert((res && res.error) || '调整顺序失败');
        syncEditTagOptions();
        return;
      }
      tagList = res.tags;
      afterTagMutation();
    } catch (err) {
      alert('调整顺序失败：' + (err && err.message ? err.message : err));
      syncEditTagOptions();
    }
  };
  const syncEditTagOptions = () => {
    const els = editTagEls();
    ui.renderManageableTagFilter(tagList, editTagIds, {
      onChange: (id, checked) => {
        const i = editTagIds.indexOf(id);
        if (checked && i < 0) editTagIds.push(id);
        if (!checked && i >= 0) editTagIds.splice(i, 1);
        drawEditTags();
      },
      onRename: (id, optEl) => startEditTagRename(id, optEl),
      onDelete: (id) => { deleteTagFromEditPicker(id); },
      onCreate: (name) => { createTagFromEditPicker(name); },
      onReorder: (fromId, toId) => { reorderTagFromEditPicker(fromId, toId); },
      canReorder: () => !editTagRename && !editTagRenameCommitPromise
        && !(typeof isConfirmOpen === 'function' && isConfirmOpen()),
    }, els);
  };
  const drawEditTags = () => {
    const els = editTagEls();
    if (!els.control) return;
    ui.renderTagSelectedRemovable(editTagIds, (id) => {
      const i = editTagIds.indexOf(id);
      if (i >= 0) editTagIds.splice(i, 1);
      drawEditTags();
    }, els);
    syncEditTagOptions();
  };
  drawEditTags();
  setEditTagRedraw(({ deletedId, selectedId }) => {
    if (deletedId) {
      const i = editTagIds.indexOf(deletedId);
      if (i >= 0) editTagIds.splice(i, 1);
    }
    if (selectedId && !editTagIds.includes(selectedId)) editTagIds.push(selectedId);
    drawEditTags();
  });
  const editTagCtrl = document.getElementById('editTagControl');
  if (editTagCtrl) {
    editTagCtrl.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('editTagDropdown');
      if (!dd) return;
      const opening = dd.classList.contains('hidden');
      if (opening) {
        dd.classList.remove('hidden');
        editTagCtrl.classList.add('open');
        const search = document.getElementById('editTagSearch');
        if (search) { search.value = ''; try { search.focus(); } catch (_) {} }
        syncEditTagOptions();
      } else {
        requestCloseEditTagDropdown();
      }
    });
  }
  const requestCloseEditTagDropdown = async () => {
    if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
    if (editTagRename) {
      const ok = await commitEditTagRename();
      if (!ok) return;
    }
    closeEditTagDropdown();
  };
  const onDocClickEditTag = (e) => {
    if (e.target.closest('#editTagWrap')) return;
    if (e.target.closest('#confirmOverlay')) return;
    if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
    requestCloseEditTagDropdown();
  };
  document.addEventListener('click', onDocClickEditTag);
  const cleanupEditTagMenu = () => {
    document.removeEventListener('click', onDocClickEditTag);
    setEditTagRedraw(null);
    closeEditTagDropdown();
    if (window._cleanupEditTagMenu === cleanupEditTagMenu) {
      window._cleanupEditTagMenu = null;
    }
  };
  window._cleanupEditTagMenu = cleanupEditTagMenu;

  const editEditorHost = document.getElementById('editEditor');
  let editEditor = null;
  editEditor = createRichEditor(editEditorHost, {
    placeholder: '编辑任务描述…',
    onPickMedia: async () => {
      const items = await API.pickMedia();
      for (const it of items || []) {
        if (!it) continue;
        if (it.kind === 'video') {
          if (!editEditor.insertMediaNode('video', { srcPath: it.srcPath })) break;
        } else if (it.dataUrl) {
          if (!editEditor.insertMediaNode('image', it.dataUrl)) break;
        }
      }
    },
  });
  window.editEditor = editEditor;
  editEditor.setDoc(resolveTaskDoc(editing));

  window.applyClipboardToEdit = (payload) => {
    if (!payload || !payload.type || !editEditor) return false;
    if (payload.type === 'text') {
      const chunk = String(payload.text || '');
      if (!chunk) return false;
      const surface = editEditor.surface;
      if (!surface) return false;
      // 空编辑器直接落 DOM，避免先露出 placeholder 再插入
      const blank = !(surface.textContent || '').trim();
      if (blank) {
        const esc = (s) => String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        surface.innerHTML = chunk.split(/\n/).map((line) => (
          line ? `<p>${esc(line)}</p>` : '<p><br></p>'
        )).join('') || '<p><br></p>';
        try { surface.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* ignore */ }
      } else {
        surface.focus();
        try { document.execCommand('insertText', false, chunk); }
        catch (_) { surface.appendChild(document.createTextNode(chunk)); }
      }
      return true;
    }
    if (payload.type === 'image' && payload.dataUrl) {
      return editEditor.insertMediaNode('image', payload.dataUrl);
    }
    return false;
  };
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }

  _editPasteAdd = (items) => {
    for (const d of items || []) {
      if (!editEditor.insertMediaNode('image', d)) break;
    }
  };

  const editAttachments = (editing.attachments || []).map((a) => typeof a === 'string' ? a : a.rel);
  const editBaseline = {
    doc: JSON.stringify(editEditor.getDoc()),
    tags: editTagIds.slice().sort().join('\0'),
    atts: editAttachments.map(attSnapshotKey).join('\0'),
  };
  window._editIsDirty = () => {
    if (!editEditor) return false;
    const doc = JSON.stringify(editEditor.getDoc());
    const tags = editTagIds.slice().sort().join('\0');
    const atts = editAttachments.map(attSnapshotKey).join('\0');
    return doc !== editBaseline.doc || tags !== editBaseline.tags || atts !== editBaseline.atts;
  };
  const drawEditAttachments = () => {
    const box = document.getElementById('editAttachments');
    box.innerHTML = editAttachments.length ? editAttachments.map((a, i) => {
      const name = a.split(/[\\/]/).pop();
      return `<span class="att-item" title="${ui.esc(name)}"><span class="att-main">${ui.esc(name)}</span><button type="button" class="att-remove" data-i="${i}" aria-label="删除">${ui.CLOSE_ICON}</button></span>`;
    }).join('') : '';
    box.querySelectorAll('.att-remove').forEach((btn) => {
      btn.addEventListener('click', () => { editAttachments.splice(Number(btn.dataset.i), 1); drawEditAttachments(); });
    });
  };
  drawEditAttachments();

  const editDrop = $('#editDrop');
  const MAX_EDIT_MB = 10;
  editDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    editDrop.classList.add('drag-over');
  });
  editDrop.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && editDrop.contains(e.relatedTarget)) return;
    editDrop.classList.remove('drag-over');
  });
  editDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editDrop.classList.remove('drag-over');
    const allFiles = [...(e.dataTransfer?.files || [])];
    if (!allFiles.length) return;
    for (const f of allFiles) {
      if (isImageFile(f)) {
        if (f.size > MAX_EDIT_MB * 1024 * 1024) { alert(`图片超过${MAX_EDIT_MB}MB`); continue; }
        const reader = new FileReader();
        reader.onload = () => { editEditor.insertMediaNode('image', reader.result); };
        reader.readAsDataURL(f);
      } else if (isVideoFile(f)) {
        const v = resolveVideoDrop(f);
        if (!v) continue;
        editEditor.insertMediaNode('video', v);
      } else {
        const p = resolveAttachmentDrop(f);
        if (p) {
          if (editAttachments.length >= 10) { alert('最多添加10个附件'); continue; }
          editAttachments.push(p);
          drawEditAttachments();
        }
      }
    }
  });

  const cancelLabel = window.__IS_EDIT_WINDOW__ ? '关闭' : '取消';
  ui.detailActions.innerHTML = `
    <div class="detail-footer-left">
      <button id="editAddFile" class="icon-btn" type="button" title="添加附件" aria-label="添加附件"><svg class="att-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
    </div>
    <span class="detail-footer-spacer"></span>
    <div class="detail-footer-right">
      <button id="cancelEditBtn" type="button">${cancelLabel}</button>
      <span class="save-btn-wrap">
        <button id="saveBtn" class="primary" type="button">保存</button>
      </span>
    </div>`;
  document.getElementById('editAddFile').addEventListener('click', async () => {
    const paths = await API.pickAttachments();
    (paths || []).forEach((p) => {
      if (editAttachments.length >= 10) { alert('最多添加10个附件'); return; }
      editAttachments.push(p);
    });
    drawEditAttachments();
  });

  let saveHintTimer = 0;
  function setSaveBusy(busy) {
    const btn = document.getElementById('saveBtn');
    if (!btn) return;
    // 只改 disabled，不改 textContent（避免冲掉气泡或闪字）
    btn.disabled = !!busy;
    btn.classList.toggle('is-saving', !!busy);
  }
  /** 保存按钮上方：弹出 → 停留 → 缩回；ok=绿「已保存」，fail=红「保存失败」 */
  function flashSaveHint(ok = true) {
    const wrap = document.querySelector('#detailActions .save-btn-wrap');
    const btn = document.getElementById('saveBtn');
    if (!wrap || !btn) return;
    wrap.classList.add('is-hinting');
    let tip = wrap.querySelector('.save-ok-hint');
    if (!tip) {
      tip = document.createElement('span');
      tip.className = 'save-ok-hint';
      tip.setAttribute('aria-live', 'polite');
      wrap.appendChild(tip);
    }
    tip.classList.toggle('is-fail', !ok);
    tip.textContent = ok ? '已保存' : '保存失败';
    // 独立窗：内层 overflow 易裁切 absolute 气泡，改为 fixed 锚在按钮上方
    if (window.__IS_EDIT_WINDOW__) {
      const r = btn.getBoundingClientRect();
      tip.classList.add('is-fixed');
      tip.style.left = `${Math.round(r.left + r.width / 2)}px`;
      tip.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
    } else {
      tip.classList.remove('is-fixed');
      tip.style.left = '';
      tip.style.bottom = '';
    }
    tip.classList.remove('is-on', 'is-out');
    void tip.offsetWidth;
    tip.classList.add('is-on');
    if (saveHintTimer) clearTimeout(saveHintTimer);
    saveHintTimer = setTimeout(() => {
      tip.classList.remove('is-on');
      tip.classList.add('is-out');
      saveHintTimer = setTimeout(() => {
        tip.classList.remove('is-out', 'is-fail', 'is-fixed');
        tip.style.left = '';
        tip.style.bottom = '';
        wrap.classList.remove('is-hinting');
        saveHintTimer = 0;
      }, 280);
    }, 900);
  }
  function flashSaveOk() { flashSaveHint(true); }
  function flashSaveFail() { flashSaveHint(false); }

  async function saveCurrentEdit() {
    if (!editEditor || typeof editEditor.getPayload !== 'function') return false;
    setSaveBusy(true);
    try {
      const body = await editEditor.getPayload();
      const editAtts = editAttachments.map((a) => {
        const isRel = (editing.attachments || []).some((x) => (typeof x === 'string' ? x : x.rel) === a);
        return isRel ? a : { srcPath: a, name: a.split(/[\\/]/).pop() };
      });
      if (isTaskContentEmpty({ doc: body.doc, attachments: editAtts })) {
        alert('请至少输入文字、图片、视频或附件');
        return false;
      }
      const onProgress = (d) => updateUploadProgress('editProgress', d);
      const sub = API.onAttachmentProgress(onProgress);
      const newAtts = editAtts.filter((a) => typeof a !== 'string');
      if (newAtts.length) showUploadProgress('editProgress', newAtts.length);
      try {
        const res = await API.updateTask(editing.id, {
          doc: body.doc,
          pendingMedia: body.pendingMedia,
          attachments: editAtts,
        });
        if (!res.ok) {
          flashSaveFail();
          return false;
        }
        await API.setTaskTags(editing.id, editTagIds);
      } catch (err) {
        flashSaveFail();
        return false;
      } finally {
        hideUploadProgress('editProgress');
        if (typeof sub === 'function') sub();
      }
      // 勿 cleanupEditTagMenu：保存后不 remount，标签下拉仍须保持可用
      const updated = (typeof API.getTask === 'function'
        ? await API.getTask(editing.id)
        : (await API.getAllTasks()).find((x) => x.id === editing.id));
      if (updated) {
        const idx = tasks.findIndex((x) => x.id === editing.id);
        if (idx >= 0) tasks[idx] = updated;
        editing = updated;
      }
      // 保存后保持编辑态与滚动位置：只同步附件/标签基线，禁止 remount（否则会跳到顶部）
      if (window.__IS_EDIT_WINDOW__) {
        // 短时跳过 fan-out remount，避免冲掉保存气泡（updateTask/setTaskTags 会各推一次）
        window.__editWindowSkipRemountUntil = Date.now() + 2000;
        setEditWindowChromeTitle(editing && editing.text);
      }
      editAttachments.length = 0;
      for (const a of (editing && editing.attachments) || []) {
        editAttachments.push(typeof a === 'string' ? a : a.rel);
      }
      const nextTags = (editing && editing.tags) || [];
      editTagIds.length = 0;
      for (const tid of nextTags) editTagIds.push(tid);
      editBaseline.doc = JSON.stringify(editEditor.getDoc());
      editBaseline.tags = editTagIds.slice().sort().join('\0');
      editBaseline.atts = editAttachments.map(attSnapshotKey).join('\0');
      drawEditAttachments();
      try { syncEditTagOptions(); } catch (_) { /* ignore */ }
      if (!window.__IS_EDIT_WINDOW__ && typeof refresh === 'function') {
        await refresh();
      }
      flashSaveOk();
      return true;
    } catch (err) {
      flashSaveFail();
      return false;
    } finally {
      setSaveBusy(false);
    }
  }
  window.saveCurrentEdit = saveCurrentEdit;

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveBtn');
    if (btn && btn.disabled) return;
    await saveCurrentEdit();
  });
  document.getElementById('cancelEditBtn').addEventListener('click', async () => {
    if (window.__IS_EDIT_WINDOW__) {
      try { window.close(); } catch (_) { /* ignore */ }
      return;
    }
    await leaveEditToDetailView();
  });
}

async function deleteTask() {
  const ok = await showConfirm('确定将该任务移入回收站吗？可在设置中恢复。');
  if (!ok) return;
  const id = editing && editing.id;
  const res = await API.deleteTask(editing.id);
  if (res && res.ok === false) { alert(res.error || '删除失败'); return; }
  editing = null;
  hideDetailOverlay(() => {
    disposeEditEditor();
    if (typeof window.syncClipboardQuickTargetLabel === 'function') {
      window.syncClipboardQuickTargetLabel();
    }
  });
  if (id != null && ui && typeof ui.animateCardOut === 'function') {
    await ui.animateCardOut(id);
  }
  await refresh();
}

$('#detailOverlay').addEventListener('click', (e) => {
  if (e.target.id !== 'detailOverlay') return;
  // 编辑态：不可点遮罩关闭
  if (detailState && detailState.mode === 'edit') return;
  closeDetailModal();
});
$('#detailClose').addEventListener('click', () => {
  closeDetailModal();
});
const openEditWinBtnEl = document.getElementById('openEditWinBtn');
if (openEditWinBtnEl) {
  openEditWinBtnEl.addEventListener('click', (e) => {
    openIndependentEditFromDetail(e.currentTarget);
  });
}

/**
 * 其它窗口保存后：若详情浮层正打开同一任务，同步内容。
 * 就地编辑且未保存时不覆盖（与独立窗脏策略一致）。
 */
async function syncOpenDetailAfterTasksChanged() {
  if (window.__IS_EDIT_WINDOW__) return;
  if (!editing || editing.id == null) return;
  if (window.__deferChecklistRefresh) return;
  const overlay = document.getElementById('detailOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (isEditDirty()) return;
  // 就地编辑中（含刚保存、未 dirty）：勿 remount，否则编辑区滚动条回到顶部
  if (detailState && detailState.mode === 'edit') return;

  const id = editing.id;
  let fresh = null;
  if (typeof API.getTask === 'function') {
    try { fresh = await API.getTask(id); } catch (_) { fresh = null; }
  }
  if (!fresh && Array.isArray(tasks)) {
    fresh = tasks.find((t) => t && String(t.id) === String(id)) || null;
  }
  if (!fresh) {
    editing = null;
    hideDetailOverlay(() => {
      disposeEditEditor();
      window._editIsDirty = null;
      if (detailState) detailState.mode = 'view';
      syncDetailPopoutBtn();
    });
    return;
  }

  const idx = Array.isArray(tasks) ? tasks.findIndex((t) => t && String(t.id) === String(id)) : -1;
  if (idx >= 0) tasks[idx] = fresh;
  editing = fresh;
  updateOpenDetail();
}

if (typeof API.onTasksChanged === 'function' && !window.__IS_EDIT_WINDOW__) {
  API.onTasksChanged(() => {
    syncOpenDetailAfterTasksChanged().catch(() => { /* ignore */ });
  });
}

/** 详情只读态：勾选待办项 → 写回 doc 并自动保存（串行队列，不丢快速连点） */
let _checklistSaveChain = Promise.resolve();
function applyDetailTaskChecked(li, checked) {
  const on = !!checked;
  li.setAttribute('data-checked', on ? 'true' : 'false');
  li.classList.toggle('is-checked', on);
  const btn = li.querySelector('.task-check[role="checkbox"], button.task-check');
  if (btn) btn.setAttribute('aria-checked', on ? 'true' : 'false');
  const input = li.querySelector('input[type="checkbox"]');
  if (input) input.checked = on;
}

function onDetailChecklistToggle(li, checked) {
  if (window.__IS_EDIT_WINDOW__) return;
  if (!detailState || detailState.mode !== 'view') return;
  if (!editing || editing.id == null) return;
  const view = ui.detailBody && ui.detailBody.querySelector('.doc-view');
  if (!view || !li || !view.contains(li)) return;

  const prev = li.classList.contains('is-checked');
  applyDetailTaskChecked(li, checked);

  window.__deferChecklistRefresh = true;
  _checklistSaveChain = _checklistSaveChain.then(async () => {
    try {
      if (typeof htmlRootToDoc !== 'function') return;
      if (!editing || editing.id == null) return;
      const liveView = ui.detailBody && ui.detailBody.querySelector('.doc-view');
      if (!liveView) return;
      const doc = htmlRootToDoc(liveView);
      const res = await API.updateTask(editing.id, {
        doc,
        attachments: editing.attachments || [],
      });
      if (!res || !res.ok) {
        if (li.isConnected) applyDetailTaskChecked(li, prev);
        return;
      }
      const updated = res.task;
      if (updated) {
        editing = updated;
        const idx = Array.isArray(tasks) ? tasks.findIndex((t) => t && String(t.id) === String(updated.id)) : -1;
        if (idx >= 0) tasks[idx] = updated;
      }
      if (typeof refresh === 'function') await refresh({ reload: false });
    } catch (_) {
      if (li.isConnected) applyDetailTaskChecked(li, prev);
    } finally {
      window.setTimeout(() => { window.__deferChecklistRefresh = false; }, 400);
    }
  }).catch(() => { /* ignore */ });
}

function toggleDetailTaskCheckFromHit(hit) {
  if (!hit || !ui.detailBody.contains(hit)) return;
  if (hit.getAttribute && hit.getAttribute('aria-disabled') === 'true') return;
  const li = hit.closest('li.task-item, li[data-type="taskItem"]');
  if (!li) return;
  const next = !li.classList.contains('is-checked');
  onDetailChecklistToggle(li, next);
}

if (ui && ui.detailBody && !window.__IS_EDIT_WINDOW__) {
  ui.detailBody.addEventListener('click', (e) => {
    const hit = e.target && e.target.closest && e.target.closest(
      'button.task-check, .task-check[role="checkbox"], li.task-item input[type="checkbox"]'
    );
    if (!hit || !ui.detailBody.contains(hit)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleDetailTaskCheckFromHit(hit);
  });
  ui.detailBody.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const hit = e.target && e.target.closest && e.target.closest(
      'button.task-check, .task-check[role="checkbox"]'
    );
    if (!hit || !ui.detailBody.contains(hit)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleDetailTaskCheckFromHit(hit);
  });
}

let _editPasteAdd = null;
bindContentPaste({
  getZone: () => (detailState.mode === 'edit' ? document.getElementById('editDrop') : null),
  getTextarea: () => (detailState.mode === 'edit' && window.editEditor
    ? window.editEditor.surface
    : null),
  addImages: (items) => { if (_editPasteAdd) _editPasteAdd(items); },
  maxMb: 10,
});

