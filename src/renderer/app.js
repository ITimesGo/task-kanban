let tasks = [];
let filter = 'all';
let newImages = []; // dataUrl[] 待建任务的新图，最多5
let editing = null; // 正在编辑的任务对象

const $ = (sel) => document.querySelector(sel);

async function refresh() {
  tasks = await API.getAllTasks();
  const list = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  ui.renderCards(list, {
    onQuickToggle: toggleStatus,
    onOpen: openDetail,
  });
}

async function toggleStatus(t) {
  const updated = await API.toggleStatus(t.id);
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) tasks[idx] = updated;
  await refresh();
  if (editing && editing.id === t.id) { editing = updated; updateOpenDetail(); }
}

// ---- 创建面板 ----
function renderThumbs() {
  ui.renderNewThumbs({
    images: newImages,
    onRemove: (i) => { newImages.splice(i, 1); renderThumbs(); },
    onPreview: window.showLightbox,
  });
}

window.onAddImage = async () => {
  const dataUrls = await API.pickImages();
  for (const d of dataUrls) {
    if (newImages.length >= 5) { alert('最多添加5张图片'); break; }
    newImages.push(d);
  }
  renderThumbs();
};

async function createTask() {
  const text = $('#newText').value;
  if (!text.trim() && !newImages.length) { alert('请至少输入文字或添加图片'); return; }
  const res = await API.createTask({ text, images: newImages });
  if (!res.ok) { alert(res.error || '创建失败'); return; }
  $('#newText').value = '';
  newImages = [];
  renderThumbs();
  await refresh();
}

// ---- 详情 ----
let detailState = { mode: 'view', dataUrl: [] };

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
    ui.renderDetail(editing);
    const done = editing.status === 'done';
    ui.detailActions.innerHTML = `
      <button id="toggleBtn">${done ? '取消完成' : '标记完成'}</button>
      <button id="editBtn">编辑</button>
      <button id="delBtn" class="danger">删除</button>`;
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
  ui.detailBody.innerHTML = `
    <h2>编辑任务</h2>
    <textarea id="editText" rows="6">${ui.esc(editing.text)}</textarea>
    <div id="editThumbs" class="thumbs"></div>
    <button id="editAdd">添加图片</button>`;
  const current = editing.images.slice(); // rel 路径 或 新增 dataUrl（新建独立副本，避免污染原任务）
  function drawEditThumbs() {
    const box = document.getElementById('editThumbs');
    box.innerHTML = '';
    current.forEach((item, i) => {
      const tile = document.createElement('div'); tile.className = 'thumb-tile';
      const img = document.createElement('img');
      // 新增图为 data: 前缀的 dataUrl，已存在为相对路径；按内容区分
      img.src = (typeof item === 'string' && item.startsWith('data:')) ? item : API.imageUrl(item);
      const btn = document.createElement('button'); btn.className = 'remove'; btn.textContent = '×';
      btn.addEventListener('click', () => { current.splice(i, 1); drawEditThumbs(); });
      tile.append(img, btn); box.appendChild(tile);
    });
  }
  drawEditThumbs();
  document.getElementById('editAdd').addEventListener('click', async () => {
    const dataUrls = await API.pickImages();
    for (const d of dataUrls) {
      if (current.length >= 5) { alert('最多添加5张图片'); break; }
      current.push(d);
    }
    drawEditThumbs();
  });
  ui.detailActions.innerHTML = `
    <button id="saveBtn" class="primary">保存</button>
    <button id="cancelEditBtn">取消</button>`;
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const text = document.getElementById('editText').value;
    const res = await API.updateTask(editing.id, { text, images: current });
    if (!res.ok) { alert(res.error || '保存失败'); return; }
    const updated = res.task;
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
  if (!confirm('确定删除该任务及其图片吗？')) return;
  await API.deleteTask(editing.id);
  $('#detailOverlay').classList.add('hidden');
  editing = null;
  await refresh();
}

// ---- lightbox ----
window.showLightbox = (src) => {
  $('#lightboxImg').src = src;
  $('#lightboxOverlay').classList.remove('hidden');
};
$('#lightboxOverlay').addEventListener('click', () => $('#lightboxOverlay').classList.add('hidden'));
$('#detailOverlay').addEventListener('click', (e) => { if (e.target.id === 'detailOverlay') $('#detailOverlay').classList.add('hidden'); });

// ---- 筛选 ----
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    refresh();
  });
});

// ---- 事件 ----
document.getElementById('addImageBtn').addEventListener('click', window.onAddImage);
document.getElementById('createBtn').addEventListener('click', createTask);

// Ctrl+V 粘贴到创建面板
document.addEventListener('paste', async (e) => {
  const target = e.target;
  const inCreate = target.id === 'newText' || target.closest('#createPanel');
  if (!inCreate) return;
  const img = await API.pasteImage();
  if (!img) return; // 非图片
  if (newImages.length >= 5) { alert('最多添加5张图片'); return; }
  newImages.push(img);
  renderThumbs();
});

refresh();
