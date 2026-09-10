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

function updateOpenDetail() {
  if (detailState.mode === 'edit') {
    renderEditDetail();
  } else {
    window.applyClipboardToEdit = null;
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
      <textarea id="editText" rows="6">${ui.esc(editing.text)}</textarea>
      <div id="editThumbs" class="thumbs"></div>
      <div id="editTags" class="tag-select"></div>
      <div id="editAttachments" class="attachments"></div>
      <button id="editAddFile" class="icon-btn" title="添加附件" aria-label="添加附件"><svg class="att-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
      <button id="editAdd" class="icon-btn" title="添加图片或视频" aria-label="添加图片或视频"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
      <div id="editProgress" class="upload-progress hidden">
        <div class="up-bar"><div class="up-fill" id="editProgressFill"></div></div>
        <span class="up-text" id="editProgressText"></span>
      </div>
      <p class="hint" style="margin-top:10px">支持拖入图片/视频或 Ctrl+V 粘贴；缩略图可拖动调整顺序（图片≤10MB×10；视频 mp4/webm/mov≤200MB×3）</p>
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
  const currentMedia = taskMediaItems(editing).map((m) => ({ kind: m.kind, value: m.value }));
  function editMediaCounts() {
    let images = 0;
    let videos = 0;
    for (const m of currentMedia) {
      if (m.kind === 'video') videos += 1;
      else images += 1;
    }
    return { images, videos };
  }
  function drawEditThumbs() {
    ui.renderNewThumbs({
      el: document.getElementById('editThumbs'),
      media: currentMedia,
      onRemove: (i) => { currentMedia.splice(i, 1); drawEditThumbs(); },
      onReorder: (from, to) => {
        const next = moveMediaItem(currentMedia, from, to);
        currentMedia.length = 0;
        currentMedia.push(...next);
        drawEditThumbs();
      },
      onPreview: window.showLightbox,
    });
  }
  drawEditThumbs();
  window.applyClipboardToEdit = (payload) => {
    if (!payload || !payload.type) return false;
    if (payload.type === 'text') {
      const ta = document.getElementById('editText');
      if (!ta) return false;
      const chunk = String(payload.text || '');
      if (!chunk) return false;
      if (ta.value && !/\n$/.test(ta.value)) ta.value += '\n';
      ta.value += chunk;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (payload.type === 'image' && payload.dataUrl) {
      if (editMediaCounts().images >= 10) { alert('最多添加10张图片'); return false; }
      currentMedia.push({ kind: 'image', value: payload.dataUrl });
      drawEditThumbs();
      return true;
    }
    return false;
  };
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
  function addImagesToEdit(dataUrls) {
    for (const d of dataUrls || []) {
      if (editMediaCounts().images >= 10) { alert('最多添加10张图片'); break; }
      currentMedia.push({ kind: 'image', value: d });
    }
    drawEditThumbs();
  }
  function addMediaToEdit(items) {
    for (const it of items || []) {
      if (!it) continue;
      if (it.kind === 'video') {
        if (editMediaCounts().videos >= 3) { alert('最多添加3个视频'); break; }
        currentMedia.push({ kind: 'video', value: { srcPath: it.srcPath } });
      } else if (it.dataUrl) {
        if (editMediaCounts().images >= 10) { alert('最多添加10张图片'); break; }
        currentMedia.push({ kind: 'image', value: it.dataUrl });
      }
    }
    drawEditThumbs();
  }
  _editPasteAdd = addImagesToEdit;
  document.getElementById('editAdd').addEventListener('click', async () => {
    addMediaToEdit(await API.pickMedia());
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
    if (isThumbReorderEvent(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      editDrop.classList.remove('drag-over');
      return;
    }
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
    if (isThumbReorderEvent(e)) return;
    const allFiles = [...(e.dataTransfer?.files || [])];
    if (!allFiles.length) return;
    for (const f of allFiles) {
      if (isImageFile(f)) {
        if (f.size > MAX_EDIT_MB * 1024 * 1024) { alert(`图片超过${MAX_EDIT_MB}MB`); continue; }
        const reader = new FileReader();
        reader.onload = () => {
          if (editMediaCounts().images >= 10) { alert('最多添加10张图片'); return; }
          currentMedia.push({ kind: 'image', value: reader.result });
          drawEditThumbs();
        };
        reader.readAsDataURL(f);
      } else if (isVideoFile(f)) {
        const v = resolveVideoDrop(f);
        if (!v) continue;
        if (editMediaCounts().videos >= 3) { alert('最多添加3个视频'); continue; }
        currentMedia.push({ kind: 'video', value: v });
        drawEditThumbs();
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
    const text = document.getElementById('editText').value;
    const editAtts = editAttachments.map((a) => {
      const isRel = (editing.attachments || []).some((x) => (typeof x === 'string' ? x : x.rel) === a);
      return isRel ? a : { srcPath: a, name: a.split(/[\\/]/).pop() };
    });
    const media = currentMedia.map((m) => ({
      kind: m.kind === 'video' ? 'video' : 'image',
      value: m.value,
    }));
    const onProgress = (d) => updateUploadProgress('editProgress', d);
    const sub = API.onAttachmentProgress(onProgress);
    const newAtts = editAtts.filter((a) => typeof a !== 'string');
    if (newAtts.length) showUploadProgress('editProgress', newAtts.length);
    try {
      const res = await API.updateTask(editing.id, { text, media, attachments: editAtts });
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
  window.applyClipboardToEdit = null;
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
  await refresh();
}

$('#detailOverlay').addEventListener('click', (e) => {
  if (e.target.id !== 'detailOverlay') return;
  $('#detailOverlay').classList.add('hidden');
  window.applyClipboardToEdit = null;
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
});
$('#detailClose').addEventListener('click', () => {
  $('#detailOverlay').classList.add('hidden');
  window.applyClipboardToEdit = null;
  if (typeof window.syncClipboardQuickTargetLabel === 'function') {
    window.syncClipboardQuickTargetLabel();
  }
});

let _editPasteAdd = null;
bindContentPaste({
  getZone: () => (detailState.mode === 'edit' ? document.getElementById('editDrop') : null),
  getTextarea: () => (detailState.mode === 'edit' ? document.getElementById('editText') : null),
  addImages: (items) => { if (_editPasteAdd) _editPasteAdd(items); },
  maxMb: 10,
});
