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

// 自定义确认框（替代原生 confirm / MessageBox，样式与主界面一致）
let confirmResolve = null;
let confirmKeyHandler = null;
let confirmCancelValue = false;

function finishConfirm(result) {
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (confirmKeyHandler) {
    document.removeEventListener('keydown', confirmKeyHandler, true);
    confirmKeyHandler = null;
  }
  const r = confirmResolve;
  confirmResolve = null;
  if (r) r(result);
}

/**
 * @param {{ title?: string, message: string, buttons: Array<{ label: string, value: *, className?: string, primary?: boolean }> }} opts
 * @returns {Promise<*>}
 */
function showConfirmDialog(opts) {
  const title = (opts && opts.title) || '确认操作';
  const message = (opts && opts.message) || '';
  const buttons = (opts && opts.buttons) || [];
  const cancelBtn = buttons.find((b) => b.value === 'cancel' || b.value === false);
  const cancelValue = cancelBtn ? cancelBtn.value : false;
  return new Promise((resolve) => {
    if (confirmResolve) finishConfirm(confirmCancelValue);
    confirmResolve = resolve;
    confirmCancelValue = cancelValue;
    const titleEl = document.getElementById('confirmTitle');
    const textEl = document.getElementById('confirmText');
    const actions = document.getElementById('confirmActions');
    const overlay = document.getElementById('confirmOverlay');
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = message;
    if (actions) {
      actions.innerHTML = '';
      let focusEl = null;
      buttons.forEach((btn) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.classList.add('confirm-btn');
        el.textContent = btn.label;
        if (btn.className) {
          String(btn.className).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
        }
        if (btn.primary) el.classList.add('primary');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          finishConfirm(btn.value);
        });
        actions.appendChild(el);
        // 默认聚焦取消，避免回车误触「保存」
        if (btn.value === cancelValue) focusEl = el;
      });
      if (!focusEl && actions.firstElementChild) focusEl = actions.firstElementChild;
      if (focusEl) {
        requestAnimationFrame(() => { try { focusEl.focus(); } catch (_) { /* ignore */ } });
      }
    }
    if (overlay) overlay.classList.remove('hidden');
    confirmKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishConfirm(cancelValue);
      }
    };
    document.addEventListener('keydown', confirmKeyHandler, true);
  });
}

function showConfirm(text) {
  return showConfirmDialog({
    title: '确认操作',
    message: text,
    buttons: [
      { label: '取消', value: false },
      { label: '确认', value: true, className: 'danger' },
    ],
  });
}

/** 未保存离开：保存 / 不保存 / 取消（弹窗与独立窗共用） */
function showDirtyConfirm(opts) {
  const o = opts || {};
  return showConfirmDialog({
    title: o.title || '有未保存的修改',
    message: o.detail || o.message || '保存后继续，或不保存丢弃更改。',
    buttons: [
      { label: '取消', value: 'cancel' },
      { label: o.discardLabel || '不保存', value: 'discard' },
      { label: o.saveLabel || '保存', value: 'save', primary: true, className: 'primary' },
    ],
  });
}

function isConfirmOpen() {
  const el = document.getElementById('confirmOverlay');
  return !!(el && !el.classList.contains('hidden'));
}

const confirmOverlayEl = document.getElementById('confirmOverlay');
if (confirmOverlayEl) {
  confirmOverlayEl.addEventListener('click', (e) => {
    if (e.target.id === 'confirmOverlay') {
      e.stopPropagation();
      finishConfirm(confirmCancelValue);
    }
  });
}
