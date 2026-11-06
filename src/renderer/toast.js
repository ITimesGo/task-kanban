/** 顶部轻提示：同一时间只保留一条。成功约 1.6 秒，失败约 3 秒。鼠标悬停时暂停，移出后继续。 */
(function () {
  const OK_MS = 1600;
  const FAIL_MS = 3000;
  const LEAVE_FLOOR_MS = 400;
  let hideTimer = 0;
  let remainMs = 0;
  let startedAt = 0;
  let paused = false;
  let batch = [];
  let batchTimer = 0;

  function host() {
    return document.getElementById('appToast');
  }

  function dismiss() {
    hideTimer = 0;
    remainMs = 0;
    paused = false;
    const el = host();
    if (!el) return;
    el.classList.remove('is-on');
    window.setTimeout(() => {
      if (!el.classList.contains('is-on')) el.hidden = true;
    }, 180);
  }

  function arm(ms) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    remainMs = ms;
    startedAt = Date.now();
    paused = false;
    hideTimer = window.setTimeout(dismiss, ms);
  }

  function pauseHide() {
    const el = host();
    if (!el || !el.classList.contains('is-on') || !hideTimer) return;
    remainMs = Math.max(0, remainMs - (Date.now() - startedAt));
    clearTimeout(hideTimer);
    hideTimer = 0;
    paused = true;
  }

  function resumeHide() {
    const el = host();
    if (!paused || !el || !el.classList.contains('is-on')) return;
    arm(Math.max(remainMs, LEAVE_FLOOR_MS));
  }

  function bindHover() {
    const el = host();
    if (!el || el.dataset.hoverBound) return;
    el.dataset.hoverBound = '1';
    el.addEventListener('mouseenter', pauseHide);
    el.addEventListener('mouseleave', resumeHide);
  }

  function showToast(message, opts) {
    const el = host();
    const text = String(message || '').trim();
    if (!el || !text) return;
    const tone = opts && opts.tone === 'ok' ? 'ok' : (opts && opts.tone === 'info' ? 'info' : 'fail');
    const duration = opts && opts.duration > 0
      ? opts.duration
      : (tone === 'ok' || tone === 'info' ? OK_MS : FAIL_MS);
    bindHover();
    paused = false;
    el.replaceChildren();
    const label = document.createElement('span');
    label.className = 'app-toast-text';
    label.textContent = text;
    el.appendChild(label);
    const action = opts && opts.action;
    if (action && action.label && typeof action.onClick === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        paused = false;
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = 0;
        }
        remainMs = 0;
        el.classList.remove('is-on');
        el.hidden = true;
        try { action.onClick(); } catch (_) { /* ignore */ }
      });
      el.appendChild(btn);
    }
    el.classList.remove('is-ok', 'is-fail', 'is-info', 'is-on', 'has-action');
    el.classList.add(tone === 'ok' ? 'is-ok' : tone === 'info' ? 'is-info' : 'is-fail');
    if (action && action.label) el.classList.add('has-action');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'app-toast-close';
    closeBtn.title = '关闭';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.2 2.2l7.6 7.6M9.8 2.2L2.2 9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
    el.appendChild(closeBtn);
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-on');
    arm(duration);
  }

  /** 同一次拖放/粘贴里的多条限制，合并成一句再提示 */
  function noticeDrop(message) {
    const text = String(message || '').trim();
    if (!text) return;
    batch.push(text);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = window.setTimeout(() => {
      batchTimer = 0;
      const counts = new Map();
      for (const item of batch) counts.set(item, (counts.get(item) || 0) + 1);
      batch = [];
      const parts = [];
      counts.forEach((n, msg) => {
        parts.push(n > 1 ? `${n} 个${msg}` : msg);
      });
      showToast(parts.join('；'), { tone: 'fail' });
    }, 80);
  }

  function toastFail(message) {
    showToast(message, { tone: 'fail' });
  }

  window.showToast = showToast;
  window.toastFail = toastFail;
  window.noticeDrop = noticeDrop;
})();
