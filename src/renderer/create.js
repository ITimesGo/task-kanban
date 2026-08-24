function updateCreateBtnState() {
  const hasContent = $('#newText').value.trim() || newImages.length > 0;
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
    images: newImages,
    onRemove: (i) => { newImages.splice(i, 1); renderThumbs(); },
    onPreview: window.showLightbox,
  });
  updateCreateBtnState();
}

function renderNewAttachments() {
  const box = document.getElementById('newAttachments');
  if (!box) return;
  box.innerHTML = newAttachments.length ? newAttachments.map(function(a, i){
    return '<span class="att-item" title="' + ui.esc(a.name) + '"><span class="att-main">' + ui.esc(a.name) + '</span><button class="att-remove" data-i="'+i+'">×</button></span>';
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
  const dataUrls = await API.pickImages();
  for (const d of dataUrls || []) {
    if (newImages.length >= 10) { alert('最多添加10张图片'); break; }
    newImages.push(d);
  }
  renderThumbs();
};

async function createTask() {
  const atts = newAttachments.map(function(a){return {srcPath:a.path, name:a.name};});
  const onProgress = (d) => updateUploadProgress('createProgress', d);
  const sub = API.onAttachmentProgress(onProgress);
  if (atts.length) showUploadProgress('createProgress', atts.length);
  try {
    // 图片：dataUrl 或后续扩展的 {srcPath}；附件仍走路径拷贝
    const imgs = newImages.map((p) => (
      p && typeof p === 'object' && p.srcPath ? p
        : (String(p).startsWith('data:') ? p : { srcPath: p })
    ));
    const res = await API.createTask({
      text: $('#newText').value, images: imgs, attachments: atts, tags: newTags.slice(),
    });
    if (!res.ok) { alert(res.error || '创建失败'); return; }
    if (newTags.length) await API.setTaskTags(res.task.id, newTags);
    $('#newText').value = '';
    newImages = [];
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
  createPanel.classList.add('drag-over');
});
createPanel.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && createPanel.contains(e.relatedTarget)) return;
  createPanel.classList.remove('drag-over');
});
createPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  createPanel.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  for (const f of files) {
    if (isImageFile(f)) {
      if (f.size > MAX_IMG_MB * 1024 * 1024) { alert(`图片超过${MAX_IMG_MB}MB`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        if (newImages.length >= 10) { alert('最多添加10张图片'); return; }
        newImages.push(reader.result);
        renderThumbs();
      };
      reader.readAsDataURL(f);
    } else {
      const p = resolveAttachmentDrop(f);
      if (p) addAttachmentsToCreate([p]);
    }
  }
});

document.addEventListener('paste', async (e) => {
  const target = e.target;
  const inCreate = target.id === 'newText' || target.closest('#createPanel');
  if (!inCreate) return;
  const img = await API.pasteImage();
  if (!img) return;
  if (newImages.length >= 10) { alert('最多添加10张图片'); return; }
  newImages.push(img);
  renderThumbs();
});
