let createEditor = null;
let createTagMenuBound = false;
/** @type {{ id: string, input: HTMLInputElement, orig: string } | null} */
let createTagRename = null;
/** @type {Promise<boolean> | null} */
let createTagRenameCommitPromise = null;

function createTagEls() {
  return {
    selected: document.getElementById('createTagSelected'),
    control: document.getElementById('createTagControl'),
    options: document.getElementById('createTagOptions'),
    search: document.getElementById('createTagSearch'),
    emptyPlaceholder: tagList.length ? '选择标签' : '尚无标签，输入名称后可创建',
  };
}

function commitCreateTagRename() {
  if (createTagRenameCommitPromise) return createTagRenameCommitPromise;
  if (!createTagRename) return Promise.resolve(true);
  const state = createTagRename;
  if (!state.input) {
    createTagRename = null;
    syncCreateTagFilterOptions();
    return Promise.resolve(true);
  }
  const next = String(state.input.value || '').trim();
  const p = (async () => {
    if (next === state.orig) {
      createTagRename = null;
      syncCreateTagFilterOptions();
      return true;
    }
    const res = await API.renameTag(state.id, next);
    if (!res.ok) {
      alert(res.error || '保存失败');
      if (createTagRename && createTagRename.input === state.input) {
        try { state.input.focus(); } catch (_) { /* ignore */ }
      }
      return false;
    }
    createTagRename = null;
    tagList = res.tags;
    afterTagMutation();
    return true;
  })();
  createTagRenameCommitPromise = p;
  p.finally(() => {
    if (createTagRenameCommitPromise === p) createTagRenameCommitPromise = null;
  });
  return p;
}

function cancelCreateTagRename() {
  if (!createTagRename) return;
  createTagRename = null;
  createTagRenameCommitPromise = null;
  syncCreateTagFilterOptions();
}

function startCreateTagRename(id, optEl) {
  if (!optEl || createTagRename) return;
  const t = tagList.find((x) => x.id === id);
  if (!t) return;
  // 先占位改名态并重绘，隐藏全部拖动手柄
  createTagRename = { id, input: null, orig: t.name };
  syncCreateTagFilterOptions();
  const box = document.getElementById('createTagOptions');
  const row = box && box.querySelector(`.ms-option-manage[data-id="${CSS.escape(id)}"]`);
  if (!row) {
    createTagRename = null;
    syncCreateTagFilterOptions();
    return;
  }
  const nameEl = row.querySelector('.ms-option-name');
  if (!nameEl) {
    createTagRename = null;
    syncCreateTagFilterOptions();
    return;
  }
  row.classList.add('is-renaming');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ms-rename-input';
  input.maxLength = 15;
  input.value = t.name;
  nameEl.replaceWith(input);
  createTagRename = { id, input, orig: t.name };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelCreateTagRename();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!createTagRename || createTagRename.input !== input) return;
      commitCreateTagRename();
    }, 0);
  });
  try { input.focus(); input.select(); } catch (_) { /* ignore */ }
}

async function createTagFromCreatePicker(name) {
  try {
    const res = await API.createTag(name);
    if (!res || !res.ok) {
      alert((res && res.error) || '新增失败');
      return;
    }
    const beforeIds = new Set(tagList.map((t) => t.id));
    tagList = res.tags;
    const created = tagList.find((t) => !beforeIds.has(t.id));
    const search = document.getElementById('createTagSearch');
    if (search) search.value = '';
    afterTagMutation(created ? { selectedId: created.id, selectCreate: true } : {});
  } catch (err) {
    alert('新增失败：' + (err && err.message ? err.message : err));
  }
}

async function deleteTagFromCreatePicker(id) {
  const res = await confirmDeleteTag(id);
  if (!res) return;
  tagList = res.tags;
  afterTagMutation({ deletedId: id });
}

async function reorderTagFromCreatePicker(fromId, toId) {
  if (createTagRename || createTagRenameCommitPromise) return;
  if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
  try {
    const res = await API.reorderTag(fromId, toId);
    if (!res || !res.ok) {
      alert((res && res.error) || '调整顺序失败');
      syncCreateTagFilterOptions();
      return;
    }
    tagList = res.tags;
    afterTagMutation();
  } catch (err) {
    alert('调整顺序失败：' + (err && err.message ? err.message : err));
    syncCreateTagFilterOptions();
  }
}

function closeCreateTagDropdown() {
  const dd = document.getElementById('createTagDropdown');
  const ctrl = document.getElementById('createTagControl');
  if (dd) dd.classList.add('hidden');
  if (ctrl) ctrl.classList.remove('open');
  createTagRename = null;
  createTagRenameCommitPromise = null;
}

async function requestCloseCreateTagDropdown() {
  if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
  if (createTagRename) {
    const ok = await commitCreateTagRename();
    if (!ok) return;
  }
  closeCreateTagDropdown();
}

function openCreateTagDropdown() {
  const dd = document.getElementById('createTagDropdown');
  const ctrl = document.getElementById('createTagControl');
  if (dd) dd.classList.remove('hidden');
  if (ctrl) ctrl.classList.add('open');
  const search = document.getElementById('createTagSearch');
  if (search) {
    search.value = '';
    try { search.focus(); } catch (_) { /* ignore */ }
  }
  syncCreateTagFilterOptions();
}

function toggleCreateTagDropdown() {
  const dd = document.getElementById('createTagDropdown');
  if (!dd) return;
  if (dd.classList.contains('hidden')) openCreateTagDropdown();
  else requestCloseCreateTagDropdown();
}

function ensureCreateTagMenuBound() {
  if (createTagMenuBound) return;
  const ctrl = document.getElementById('createTagControl');
  if (!ctrl) return;
  createTagMenuBound = true;
  ctrl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCreateTagDropdown();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#createTagWrap')) return;
    // 确认框点确定/取消时 overlay 可能已 hidden，但仍应用点击目标判断，避免误关标签下拉
    if (e.target.closest('#confirmOverlay')) return;
    if (typeof isConfirmOpen === 'function' && isConfirmOpen()) return;
    requestCloseCreateTagDropdown();
  });
}

function syncCreateTagFilterOptions() {
  const els = createTagEls();
  const cbs = {
    onChange: (id, checked) => {
      const i = newTags.indexOf(id);
      if (checked && i < 0) newTags.push(id);
      if (!checked && i >= 0) newTags.splice(i, 1);
      renderNewTagSelect();
    },
    onRename: (id, optEl) => startCreateTagRename(id, optEl),
    onDelete: (id) => { deleteTagFromCreatePicker(id); },
    onCreate: (name) => { createTagFromCreatePicker(name); },
    onReorder: (fromId, toId) => { reorderTagFromCreatePicker(fromId, toId); },
    canReorder: () => !createTagRename && !createTagRenameCommitPromise
      && !(typeof isConfirmOpen === 'function' && isConfirmOpen()),
  };
  ui.renderManageableTagFilter(tagList, newTags, cbs, els);
}

function updateCreateBtnState() {
  const empty = createEditor
    ? createEditor.isEmpty(newAttachments)
    : !(newAttachments.length);
  $('#createBtn').disabled = empty;
}

function renderNewTagSelect() {
  ensureCreateTagMenuBound();
  const els = createTagEls();
  if (!els.control) return;
  const onRemove = (id) => {
    const i = newTags.indexOf(id);
    if (i >= 0) newTags.splice(i, 1);
    renderNewTagSelect();
  };
  ui.renderTagSelectedRemovable(newTags, onRemove, els);
  syncCreateTagFilterOptions();
}


function addImageToCreate(value) {
  if (!createEditor) return false;
  return createEditor.insertMediaNode('image', value);
}

function addVideoToCreate(value) {
  if (!createEditor) return false;
  return createEditor.insertMediaNode('video', value);
}

function renderNewAttachments() {
  const box = document.getElementById('newAttachments');
  if (!box) return;
  box.innerHTML = newAttachments.length ? newAttachments.map(function(a, i){
    return '<span class="att-item" title="' + ui.esc(a.name) + '"><span class="att-main">' + ui.esc(a.name) + '</span><button type="button" class="att-remove" data-i="'+i+'" aria-label="删除">' + ui.CLOSE_ICON + '</button></span>';
  }).join('') : '';
  box.querySelectorAll('.att-remove').forEach(function(btn){
    btn.addEventListener('click', function(){ newAttachments.splice(Number(btn.dataset.i),1); renderNewAttachments(); updateCreateBtnState(); });
  });
}

function addAttachmentsToCreate(paths) {
  (paths||[]).forEach(function(p2){
    if (newAttachments.length >= 10) { alert('最多添加10个附件'); return; }
    newAttachments.push({ path: p2, name: p2.split(/[\\/]/).pop() });
  });
  renderNewAttachments();
  updateCreateBtnState();
}

document.getElementById('addFileBtn').addEventListener('click', async function(){
  addAttachmentsToCreate(await API.pickAttachments());
});

window.onAddImage = async () => {
  const items = await API.pickMedia();
  for (const it of items || []) {
    if (!it) continue;
    if (it.kind === 'video') {
      if (!addVideoToCreate({ srcPath: it.srcPath })) break;
    } else if (it.dataUrl) {
      if (!addImageToCreate(it.dataUrl)) break;
    }
  }
  updateCreateBtnState();
};

async function createTask() {
  const atts = newAttachments.map(function(a){return {srcPath:a.path, name:a.name};});
  const onProgress = (d) => updateUploadProgress('createProgress', d);
  const sub = API.onAttachmentProgress(onProgress);
  if (atts.length) showUploadProgress('createProgress', atts.length);
  try {
    const body = await createEditor.getPayload();
    if (isTaskContentEmpty({ doc: body.doc, attachments: atts })) {
      alert('请至少输入文字、图片、视频或附件');
      return;
    }
    const res = await API.createTask({
      doc: body.doc,
      pendingMedia: body.pendingMedia,
      attachments: atts,
      tags: newTags.slice(),
    });
    if (!res.ok) { alert(res.error || '创建失败'); return; }
    if (newTags.length) await API.setTaskTags(res.task.id, newTags);
    createEditor.clear();
    newMedia = [];
    newTags = [];
    newAttachments = [];
    renderNewAttachments();
    renderNewTagSelect();
    updateCreateBtnState();
    await refresh();
  } finally {
    hideUploadProgress('createProgress');
  }
  if (typeof sub === 'function') sub();
}

(function initCreateEditor() {
  const host = document.getElementById('createEditor');
  if (!host || typeof createRichEditor !== 'function') return;
  createEditor = createRichEditor(host, {
    placeholder: '输入任务描述，可插入图片…',
    onChange: updateCreateBtnState,
    onPickMedia: () => window.onAddImage(),
  });
  window.createEditor = createEditor;
  // 固定/收起是面板布局控件，放在编辑框上方（不进工具栏、不进编辑框）
  const panel = document.getElementById('createPanel');
  const chrome = document.querySelector('.create-chrome');
  if (panel && host && chrome && chrome.parentElement !== panel) {
    panel.insertBefore(chrome, host);
  }
})();

const addImageBtn = document.getElementById('addImageBtn');
if (addImageBtn) addImageBtn.addEventListener('click', window.onAddImage);
document.getElementById('createBtn').addEventListener('click', createTask);
updateCreateBtnState();

const createPanel = document.getElementById('createPanel');
const MAX_IMG_MB = 10;
createPanel.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('application/x-kanban-tag')) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  createPanel.classList.add('drag-over');
});
createPanel.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && createPanel.contains(e.relatedTarget)) return;
  createPanel.classList.remove('drag-over');
});
createPanel.addEventListener('drop', (e) => {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('application/x-kanban-tag')) {
    createPanel.classList.remove('drag-over');
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  createPanel.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  let added = 0;
  for (const f of files) {
    if (isImageFile(f)) {
      if (f.size > MAX_IMG_MB * 1024 * 1024) { alert(`图片超过${MAX_IMG_MB}MB`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        if (!addImageToCreate(reader.result)) return;
        updateCreateBtnState();
      };
      reader.readAsDataURL(f);
      added += 1;
    } else if (isVideoFile(f)) {
      const v = resolveVideoDrop(f);
      if (!v) continue;
      if (!addVideoToCreate(v)) continue;
      added += 1;
      updateCreateBtnState();
    } else {
      const p = resolveAttachmentDrop(f);
      if (p) {
        addAttachmentsToCreate([p]);
        added += 1;
      }
    }
  }
  if (!added && files.length) {
    alert('未能添加文件。视频请使用 mp4/webm/mov，或点「添加图片或视频」选择。');
  }
});

bindContentPaste({
  getZone: () => document.getElementById('createPanel'),
  getTextarea: () => (createEditor && createEditor.surface) || null,
  addImages: (items) => {
    for (const item of items) {
      if (!addImageToCreate(item)) break;
    }
    updateCreateBtnState();
  },
  onTextChange: updateCreateBtnState,
  maxMb: MAX_IMG_MB,
});

window.applyClipboardQuick = (payload) => {
  if (!payload || !payload.type) return false;
  const overlay = document.getElementById('detailOverlay');
  const editOpen = detailState.mode === 'edit'
    && overlay
    && !overlay.classList.contains('hidden')
    && typeof window.applyClipboardToEdit === 'function';
  if (editOpen) {
    return window.applyClipboardToEdit(payload);
  }
  if (payload.type === 'text') {
    if (!createEditor || !createEditor.surface) return false;
    const chunk = String(payload.text || '');
    if (!chunk) return false;
    createEditor.surface.focus();
    try { document.execCommand('insertText', false, chunk); }
    catch (_) {
      createEditor.surface.appendChild(document.createTextNode(chunk));
    }
    updateCreateBtnState();
  } else if (payload.type === 'image' && payload.dataUrl) {
    if (!addImageToCreate(payload.dataUrl)) return false;
    updateCreateBtnState();
  } else {
    return false;
  }
  const panel = document.getElementById('createPanel');
  if (panel && typeof panel.scrollIntoView === 'function') {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  return true;
};
