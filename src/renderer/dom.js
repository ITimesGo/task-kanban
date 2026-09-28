const $ = (sel) => document.querySelector(sel);

function showUploadProgress(id, total) {
  const box = document.getElementById(id);
  const fill = box.querySelector('.up-fill');
  const text = box.querySelector('.up-text');
  box.classList.remove('hidden');
  fill.style.width = '0%';
  text.textContent = `正在上传附件… ${total > 0 ? '0/' + total : ''}`;
}

function updateUploadProgress(id, { index, count, pct }) {
  const box = document.getElementById(id);
  if (!box || box.classList.contains('hidden')) return;
  const fill = box.querySelector('.up-fill');
  const text = box.querySelector('.up-text');
  fill.style.width = pct + '%';
  const cur = Math.min(index + 1, count);
  text.textContent = `正在上传附件… ${cur}/${count}（${pct}%）`;
}

function hideUploadProgress(id) {
  const box = document.getElementById(id);
  if (box) box.classList.add('hidden');
}

// 自定义确认框（替代原生 confirm，避免 Electron 原生对话框阻塞焦点）
let confirmResolve = null;
function showConfirm(text) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $('#confirmText').textContent = text;
    $('#confirmOverlay').classList.remove('hidden');
  });
}
function isConfirmOpen() {
  const el = document.getElementById('confirmOverlay');
  return !!(el && !el.classList.contains('hidden'));
}
$('#confirmOk').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#confirmOverlay').classList.add('hidden');
  if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
});
$('#confirmCancel').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#confirmOverlay').classList.add('hidden');
  if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
});
$('#confirmOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'confirmOverlay') {
    e.stopPropagation();
    $('#confirmOverlay').classList.add('hidden');
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  }
});
