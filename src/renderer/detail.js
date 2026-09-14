async function toggleStatus(t) {
  const updated = await API.toggleStatus(t.id);
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) tasks[idx] = updated;
  await refresh();
  if (editing && editing.id === t.id) { editing = updated; updateOpenDetail(); }
}

async function openDetail(t) {
  editing = t;
  detailState = { mode: 'view', dataUrl: [] };
  updateOpenDetail();
  $('#detailOverlay').classList.remove('hidden');
}

function disposeEditEditor() {
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
      <button id="delBtn" class="btn-link danger-link" type="button">移入回收站</button>
      <div class="detail-footer-right">
        <button id="editBtn" type="button">编辑</button>
        <button id="toggleBtn" class="primary" type="button">${done ? '取消完成' : '标记完成'}</button>
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
      <div id="editTags" class="tag-select"></div>
      <div id="editAttachments" class="attachments"></div>
      <button id="editAddFile" class="icon-btn" title="添加附件" aria-label="添加附件"><svg class="att-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
      <button id="editAdd" class="icon-btn" title="添加图片或视频" aria-label="添加图片或视频"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
      <div id="editProgress" class="upload-progress hidden">
        <div class="up-bar"><div class="up-fill" id="editProgressFill"></div></div>
        <span class="up-text" id="editProgressText"></span>
      </div>
      <p class="hint" style="margin-top:10px">支持拖入或 Ctrl+V 粘贴；工具栏可加粗/列表/插图</p>
    </div>`;

  const editTagIds = (editing.tags || []).slice();
  const drawEditTags = () => {
    const box = $('#editTags');
    box.innerHTML = tagList.length
      ? tagList.map((t) =>
          `<button type="button" class="tag-pick ${editTagIds.includes(t.id) ? 'on' : ''}" data-id="${t.id}">${ui.esc(t.name)}</button>`
        ).join('')
      : '<span class="hint">尚无标签</span>';
    box.querySelectorAll('.tag-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const i = editTagIds.indexOf(id);
        if (i >= 0) editTagIds.splice(i, 1); else editTagIds.push(id);
        drawEditTags();
      });
    });
  };
  drawEditTags();

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

  document.getElementById('editAdd').addEventListener('click', () => {
    if (typeof editEditor === 'object' && editEditor) {
      // onPickMedia already wired; trigger same
      editEditor.surface.focus();
      document.querySelector('#editEditor [data-cmd="image"]')?.click();
    }
  });

  const editAttachments = (editing.attachments || []).map((a) => typeof a === 'string' ? a : a.rel);
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
  document.getElementById('editAddFile').addEventListener('click', async () => {
    const paths = await API.pickAttachments();
    (paths || []).forEach((p) => {
      if (editAttachments.length >= 10) { alert('最多添加10个附件'); return; }
      editAttachments.push(p);
    });
    drawEditAttachments();
  });

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
    <span class="detail-footer-spacer"></span>
    <div class="detail-footer-right">
      <button id="cancelEditBtn" type="button">取消</button>
      <button id="saveBtn" class="primary" type="button">保存</button>
    </div>`;
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
    const updated = (await API.getAllTasks()).find((x) => x.id === editing.id);
    const idx = tasks.findIndex((x) => x.id === editing.id);
    if (idx >= 0) tasks[idx] = updated;
    editing = updated;
    detailState.mode = 'view';
    await refresh();
    updateOpenDetail();
  });
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    detailState.mode = 'view';
    updateOpenDetail();
  });
}

async function deleteTask() {
  const ok = await showConfirm('确定将该任务移入回收站吗？可在设置中恢复。');
  if (!ok) return;
  const res = await API.deleteTask(editing.id);
  if (res && res.ok === false) { alert(res.error || '删除失败'); return; }
  $('#detailOverlay').classList.add('hidden');
  editing = null;
  disposeEditEditor();
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
  await refresh();
}

$('#detailOverlay').addEventListener('click', (e) => {
  if (e.target.id !== 'detailOverlay') return;
  $('#detailOverlay').classList.add('hidden');
  disposeEditEditor();
  if (detailState) detailState.mode = 'view';
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
});
$('#detailClose').addEventListener('click', () => {
  $('#detailOverlay').classList.add('hidden');
  disposeEditEditor();
  if (detailState) detailState.mode = 'view';
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
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
