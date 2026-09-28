async function settleStatusChange(id) {
  const key = String(id);
  const { list } = buildFilteredList();
  const stillVisible = list.some((x) => String(x.id) === key);
  if (!stillVisible && ui && typeof ui.animateCardOut === 'function') {
    await ui.animateCardOut(key);
  }
  await refresh();
}

async function toggleStatus(t, { skipUndo = false } = {}) {
  if (!t || t.id == null) return;
  const id = String(t.id);
  if (typeof clearSelection === 'function') clearSelection({ render: false });
  const updated = await API.toggleStatus(t.id);
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) tasks[idx] = updated;
  if (editing && editing.id === t.id) {
    editing = updated;
    updateOpenDetail();
  }

  if (skipUndo || !ui || typeof ui.beginCardStatusUndo !== 'function') {
    await settleStatusChange(id);
    return;
  }

  const card = document.querySelector(`#cards .card[data-task-id="${CSS.escape(id)}"]`);
  if (!card) {
    await settleStatusChange(id);
    return;
  }

  card.classList.toggle('done', updated.status === 'done');
  ui.beginCardStatusUndo(card, updated, {
    onUndo: async () => {
      await toggleStatus(updated, { skipUndo: true });
    },
    onCommit: async () => {
      await settleStatusChange(id);
    },
  });
}

async function openDetail(t) {
  editing = t;
  detailState = { mode: 'view', dataUrl: [] };
  updateOpenDetail();
  $('#detailOverlay').classList.remove('hidden');
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

/** 编辑态有未保存改动时确认；返回是否可以离开 */
async function confirmLeaveEditIfDirty() {
  if (!isEditDirty()) return true;
  return showConfirm('有未保存的修改，确定离开？未保存的内容将丢失。');
}

async function closeDetailModal() {
  if (!(await confirmLeaveEditIfDirty())) return;
  $('#detailOverlay').classList.add('hidden');
  disposeEditEditor();
  window._editIsDirty = null;
  if (detailState) detailState.mode = 'view';
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
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

function updateOpenDetail() {
  if (detailState.mode === 'edit') {
    disposeEditEditor();
    renderEditDetail();
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
    document.getElementById('editBtn').addEventListener('click', () => {
      detailState.mode = 'edit';
      detailState.dataUrl = [];
      updateOpenDetail();
    });
    document.getElementById('delBtn').addEventListener('click', deleteTask);
  }
}

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
      editEditor.surface.focus();
      try { document.execCommand('insertText', false, chunk); }
      catch (_) { editEditor.surface.appendChild(document.createTextNode(chunk)); }
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

  ui.detailActions.innerHTML = `
    <div class="detail-footer-left">
      <button id="editAddFile" class="icon-btn" type="button" title="添加附件" aria-label="添加附件"><svg class="att-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
    </div>
    <span class="detail-footer-spacer"></span>
    <div class="detail-footer-right">
      <button id="cancelEditBtn" type="button">取消</button>
      <button id="saveBtn" class="primary" type="button">保存</button>
    </div>`;
  document.getElementById('editAddFile').addEventListener('click', async () => {
    const paths = await API.pickAttachments();
    (paths || []).forEach((p) => {
      if (editAttachments.length >= 10) { alert('最多添加10个附件'); return; }
      editAttachments.push(p);
    });
    drawEditAttachments();
  });
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const body = await editEditor.getPayload();
    const editAtts = editAttachments.map((a) => {
      const isRel = (editing.attachments || []).some((x) => (typeof x === 'string' ? x : x.rel) === a);
      return isRel ? a : { srcPath: a, name: a.split(/[\\/]/).pop() };
    });
    if (isTaskContentEmpty({ doc: body.doc, attachments: editAtts })) {
      alert('请至少输入文字、图片、视频或附件');
      return;
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
      if (!res.ok) { alert(res.error || '保存失败'); return; }
      await API.setTaskTags(editing.id, editTagIds);
    } finally {
      hideUploadProgress('editProgress');
    }
    if (typeof sub === 'function') sub();
    cleanupEditTagMenu();
    window._editIsDirty = null;
    const updated = (await API.getAllTasks()).find((x) => x.id === editing.id);
    const idx = tasks.findIndex((x) => x.id === editing.id);
    if (idx >= 0) tasks[idx] = updated;
    editing = updated;
    detailState.mode = 'view';
    await refresh();
    updateOpenDetail();
  });
  document.getElementById('cancelEditBtn').addEventListener('click', async () => {
    if (!(await confirmLeaveEditIfDirty())) return;
    cleanupEditTagMenu();
    window._editIsDirty = null;
    detailState.mode = 'view';
    updateOpenDetail();
  });
}

async function deleteTask() {
  const ok = await showConfirm('确定将该任务移入回收站吗？可在设置中恢复。');
  if (!ok) return;
  const id = editing && editing.id;
  const res = await API.deleteTask(editing.id);
  if (res && res.ok === false) { alert(res.error || '删除失败'); return; }
  $('#detailOverlay').classList.add('hidden');
  editing = null;
  disposeEditEditor();
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
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

let _editPasteAdd = null;
bindContentPaste({
  getZone: () => (detailState.mode === 'edit' ? document.getElementById('editDrop') : null),
  getTextarea: () => (detailState.mode === 'edit' && window.editEditor
    ? window.editEditor.surface
    : null),
  addImages: (items) => { if (_editPasteAdd) _editPasteAdd(items); },
  maxMb: 10,
});
