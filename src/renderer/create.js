function updateCreateBtnState() {
  const hasContent = $('#newText').value.trim() || newMedia.length > 0 || newAttachments.length > 0;
  $('#createBtn').disabled = !hasContent;
}

function renderNewTagSelect() {
  const box = $('#createTags');
  if (!tagList.length) {
    box.innerHTML = '<span class="hint">尚无标签，点击“管理标签”创建</span>';
    return;
  }
  const LIMIT = 10;
  const showExpand = tagList.length > LIMIT;
  let shown = tagList;
  if (showExpand && !newTagExpanded) shown = tagList.slice(0, LIMIT);
  box.innerHTML = shown.map((t) =>
    `<button type="button" class="tag-pick ${newTags.includes(t.id) ? 'on' : ''}" data-id="${t.id}">${ui.esc(t.name)}</button>`
  ).join('');
  if (showExpand) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tag-expand';
    more.textContent = newTagExpanded ? '收起' : `展开全部 (${tagList.length})`;
    box.appendChild(more);
  }
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

function renderThumbs() {
  ui.renderNewThumbs({
    media: newMedia,
    onRemove: (i) => { newMedia.splice(i, 1); renderThumbs(); },
    onReorder: (from, to) => {
      newMedia = moveMediaItem(newMedia, from, to);
      renderThumbs();
    },
    onPreview: window.showLightbox,
  });
  updateCreateBtnState();
}

function canAddImage() {
  return newMediaCounts().images < MAX_NEW_IMAGES;
}
function canAddVideo() {
  return newMediaCounts().videos < MAX_NEW_VIDEOS;
}

function addImageToCreate(value) {
  if (!canAddImage()) { alert('最多添加10张图片'); return false; }
  newMedia.push({ kind: 'image', value });
  return true;
}

function addVideoToCreate(value) {
  if (!canAddVideo()) { alert('最多添加3个视频'); return false; }
  newMedia.push({ kind: 'video', value });
  return true;
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
  renderThumbs();
};

async function createTask() {
  const atts = newAttachments.map(function(a){return {srcPath:a.path, name:a.name};});
  const onProgress = (d) => updateUploadProgress('createProgress', d);
  const sub = API.onAttachmentProgress(onProgress);
  if (atts.length) showUploadProgress('createProgress', atts.length);
  try {
    const media = [];
    for (const m of newMedia) {
      media.push({ kind: m.kind === 'video' ? 'video' : 'image', value: m.value });
    }
    const res = await API.createTask({
      text: $('#newText').value,
      media,
      attachments: atts,
      tags: newTags.slice(),
    });
    if (!res.ok) { alert(res.error || '创建失败'); return; }
    if (newTags.length) await API.setTaskTags(res.task.id, newTags);
    $('#newText').value = '';
    newMedia = [];
    newTags = [];
    newAttachments = [];
    renderThumbs();
    renderNewAttachments();
    renderNewTagSelect();
    updateCreateBtnState();
    await refresh();
  } finally {
    hideUploadProgress('createProgress');
  }
  if (typeof sub === 'function') sub();
}

document.getElementById('addImageBtn').addEventListener('click', window.onAddImage);
document.getElementById('createBtn').addEventListener('click', createTask);
$('#newText').addEventListener('input', updateCreateBtnState);
updateCreateBtnState();

const createPanel = document.getElementById('createPanel');
const MAX_IMG_MB = 10;
createPanel.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (isThumbReorderEvent(e)) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    createPanel.classList.remove('drag-over');
    return;
  }
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
  if (isThumbReorderEvent(e)) return;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  let added = 0;
  for (const f of files) {
    if (isImageFile(f)) {
      if (f.size > MAX_IMG_MB * 1024 * 1024) { alert(`图片超过${MAX_IMG_MB}MB`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        if (!addImageToCreate(reader.result)) return;
        renderThumbs();
      };
      reader.readAsDataURL(f);
      added += 1;
    } else if (isVideoFile(f)) {
      const v = resolveVideoDrop(f);
      if (!v) continue;
      if (!addVideoToCreate(v)) continue;
      added += 1;
      renderThumbs();
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

function addPastedImages(items) {
  for (const item of items) {
    if (!addImageToCreate(item)) break;
  }
  renderThumbs();
}

bindContentPaste({
  getZone: () => document.getElementById('createPanel'),
  getTextarea: () => document.getElementById('newText'),
  addImages: (items) => addPastedImages(items),
  onTextChange: updateCreateBtnState,
  maxMb: MAX_IMG_MB,
});

/** 剪贴板快贴插件：编辑中优先写入编辑区，否则写入新建区 */
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
    const ta = document.getElementById('newText');
    if (!ta) return false;
    const chunk = String(payload.text || '');
    if (!chunk) return false;
    if (ta.value && !/\n$/.test(ta.value)) ta.value += '\n';
    ta.value += chunk;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    updateCreateBtnState();
  } else if (payload.type === 'image' && payload.dataUrl) {
    if (!addImageToCreate(payload.dataUrl)) return false;
    renderThumbs();
  } else {
    return false;
  }
  const panel = document.getElementById('createPanel');
  if (panel && typeof panel.scrollIntoView === 'function') {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  return true;
};
