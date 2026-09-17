let createEditor = null;

function updateCreateBtnState() {
  const empty = createEditor
    ? createEditor.isEmpty(newAttachments)
    : !(newAttachments.length);
  $('#createBtn').disabled = empty;
}

function renderNewTagSelect() {
  const box = $('#createTags');
  const side = document.getElementById('createSide');
  if (!box) return;
  if (!tagList.length) {
    box.innerHTML = '<span class="hint">尚无标签，点击下方标签图标管理</span>';
    if (side) side.classList.toggle('is-expanded', false);
    return;
  }
  const LIMIT = 6;
  const ordered = tagList.slice().sort((a, b) => {
    const ao = newTags.includes(a.id) ? 0 : 1;
    const bo = newTags.includes(b.id) ? 0 : 1;
    return ao - bo;
  });
  const showExpand = ordered.length > LIMIT;
  let shown = ordered;
  if (showExpand && !newTagExpanded) shown = ordered.slice(0, LIMIT);
  box.innerHTML = shown.map((t) =>
    `<button type="button" class="tag-pick ${newTags.includes(t.id) ? 'on' : ''}" data-id="${t.id}">${ui.esc(t.name)}</button>`
  ).join('');
  if (showExpand) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tag-expand';
    more.textContent = newTagExpanded ? '收起' : `更多 (${ordered.length - LIMIT})`;
    box.appendChild(more);
  }
  if (side) side.classList.toggle('is-expanded', !!newTagExpanded);
  box.querySelectorAll('.tag-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const i = newTags.indexOf(id);
      if (i >= 0) newTags.splice(i, 1); else newTags.push(id);
      renderNewTagSelect();
    });
  });
  const expandBtn = box.querySelector('.tag-expand');
  if (expandBtn) expandBtn.addEventListener('click', () => {
    newTagExpanded = !newTagExpanded;
    renderNewTagSelect();
  });
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
  const chrome = document.querySelector('#createPanel > .create-chrome');
  const bar = host.querySelector('.rich-toolbar');
  if (chrome && bar) bar.appendChild(chrome);
})();

const addImageBtn = document.getElementById('addImageBtn');
if (addImageBtn) addImageBtn.addEventListener('click', window.onAddImage);
document.getElementById('createBtn').addEventListener('click', createTask);
updateCreateBtnState();

const createPanel = document.getElementById('createPanel');
const MAX_IMG_MB = 10;
createPanel.addEventListener('dragover', (e) => {
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
