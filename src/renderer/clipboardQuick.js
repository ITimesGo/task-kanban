/** 剪贴板快贴：仅在应用运行期间出现「新复制」时提示，启动时已有内容不弹 */
(function () {
  const AUTO_HIDE_MS = 30000; // 不理睬则自动消失

  let enabled = false;
  let lastSig = '';
  /** 是否已完成启动基线：基线前绝不弹窗 */
  let primed = false;
  let pending = null;
  let timer = null;
  let busy = false;
  let rafId = null;
  let deadline = 0;
  let remainMs = 0;
  let paused = false; // 鼠标悬停
  let freezeHeld = false; // 已冻结截止时间（悬停或灯箱）

  const bar = () => document.getElementById('clipQuickBar');
  const textEl = () => document.getElementById('clipQuickText');
  const thumbEl = () => document.getElementById('clipQuickThumb');
  const progressEl = () => document.getElementById('clipQuickCountdown');
  const fillEl = () => document.getElementById('clipQuickProgressFill');

  function clearAutoHide() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    deadline = 0;
    remainMs = 0;
    paused = false;
    freezeHeld = false;
    const track = progressEl();
    const fill = fillEl();
    if (track) {
      track.hidden = true;
      track.classList.remove('is-paused', 'is-urgent');
      track.removeAttribute('title');
    }
    if (fill) fill.style.transform = 'scaleX(1)';
  }

  function isLightboxOpen() {
    const lightbox = document.getElementById('lightboxOverlay');
    return !!(lightbox && !lightbox.classList.contains('hidden'));
  }

  function tickProgress() {
    rafId = null;
    const track = progressEl();
    const fill = fillEl();
    if (!track || !fill || !pending) return;

    const shouldFreeze = paused || isLightboxOpen();
    if (shouldFreeze) {
      if (!freezeHeld) {
        remainMs = Math.max(0, deadline - Date.now());
        freezeHeld = true;
        track.classList.add('is-paused');
        track.title = paused ? '悬停中，倒计时已暂停' : '预览中，倒计时已暂停';
        const pct = remainMs / AUTO_HIDE_MS;
        fill.style.transform = `scaleX(${pct})`;
      }
      rafId = requestAnimationFrame(tickProgress);
      return;
    }

    if (freezeHeld) {
      freezeHeld = false;
      deadline = Date.now() + remainMs;
      track.classList.remove('is-paused');
    }

    const left = Math.max(0, deadline - Date.now());
    const pct = left / AUTO_HIDE_MS;
    fill.style.transform = `scaleX(${pct})`;
    track.classList.toggle('is-urgent', left <= 5000);
    track.title = `${Math.ceil(left / 1000)} 秒后自动关闭`;

    if (left <= 0) {
      hideBar();
      return;
    }
    rafId = requestAnimationFrame(tickProgress);
  }

  function scheduleAutoHide() {
    clearAutoHide();
    const track = progressEl();
    const fill = fillEl();
    if (!track || !fill) return;
    track.hidden = false;
    fill.style.transform = 'scaleX(1)';
    deadline = Date.now() + AUTO_HIDE_MS;
    remainMs = AUTO_HIDE_MS;
    track.title = '30 秒后自动关闭';
    rafId = requestAnimationFrame(tickProgress);
  }

  function isEditTarget() {
    const overlay = document.getElementById('detailOverlay');
    return typeof detailState !== 'undefined'
      && detailState.mode === 'edit'
      && overlay
      && !overlay.classList.contains('hidden')
      && typeof window.applyClipboardToEdit === 'function';
  }

  function syncTargetLabel() {
    const btn = document.getElementById('clipQuickApply');
    const t = textEl();
    const edit = isEditTarget();
    if (btn) btn.textContent = edit ? '填入编辑' : '填入新建';
    if (!t || !pending) return;
    if (pending.type === 'image') {
      t.textContent = edit
        ? '剪贴板有新图片，可一键填入当前编辑'
        : '剪贴板有新图片，可一键填入新建任务';
    }
  }

  window.syncClipboardQuickTargetLabel = syncTargetLabel;

  function hideBar() {
    clearAutoHide();
    const el = bar();
    if (el) el.classList.add('hidden');
    pending = null;
    if (thumbEl()) {
      thumbEl().hidden = true;
      thumbEl().removeAttribute('src');
    }
    syncTargetLabel();
  }

  function showBar(payload) {
    pending = payload;
    const el = bar();
    const t = textEl();
    const thumb = thumbEl();
    if (!el || !t) return;
    if (payload.type === 'image') {
      if (thumb && payload.dataUrl) {
        thumb.src = payload.dataUrl;
        thumb.hidden = false;
        thumb.title = '点击放大';
        thumb.setAttribute('role', 'button');
        thumb.tabIndex = 0;
      }
    } else {
      t.textContent = `剪贴板：${payload.preview || '新文字'}`;
      if (thumb) {
        thumb.hidden = true;
        thumb.removeAttribute('src');
      }
    }
    syncTargetLabel();
    el.classList.remove('hidden');
    scheduleAutoHide();
  }

  async function poll() {
    if (!enabled || busy) return;
    if (document.hidden) return;
    const settings = document.getElementById('settingsOverlay');
    const lightbox = document.getElementById('lightboxOverlay');
    if (settings && !settings.classList.contains('hidden')) return;
    if (lightbox && !lightbox.classList.contains('hidden')) return;

    busy = true;
    try {
      const res = await API.clipboardPeek({ withData: false });
      if (!res || !res.ok) return;

      if (!res.sig || res.type === 'empty') {
        if (!primed) primed = true;
        lastSig = '';
        return;
      }

      if (!primed) {
        lastSig = res.sig;
        primed = true;
        return;
      }

      if (res.sig === lastSig) return;
      lastSig = res.sig;
      const full = await API.clipboardPeek({ withData: true });
      if (!full || !full.ok || full.sig !== res.sig) return;
      showBar(full);
    } catch (_) {
      /* ignore */
    } finally {
      busy = false;
    }
  }

  async function refreshClipboardQuick() {
    let nextEnabled = false;
    try {
      const list = await API.listPlugins();
      const p = (list || []).find((x) => x.id === 'clipboard-quick');
      nextEnabled = !!(p && p.enabled);
    } catch (_) {
      nextEnabled = false;
    }

    if (!nextEnabled) {
      enabled = false;
      hideBar();
      lastSig = '';
      primed = false;
      if (timer) { clearInterval(timer); timer = null; }
      return;
    }

    const justEnabled = !enabled;
    enabled = true;
    if (!timer) timer = setInterval(poll, 1200);
    if (justEnabled || !primed) {
      lastSig = '';
      primed = false;
      poll();
    }
  }

  window.refreshClipboardQuick = refreshClipboardQuick;

  document.getElementById('clipQuickApply')?.addEventListener('click', () => {
    if (!pending) return;
    const ok = typeof window.applyClipboardQuick === 'function'
      ? window.applyClipboardQuick(pending)
      : false;
    if (ok) hideBar();
  });
  document.getElementById('clipQuickDismiss')?.addEventListener('click', hideBar);

  const thumbClick = (e) => {
    e.stopPropagation();
    if (!pending || pending.type !== 'image' || !pending.dataUrl) return;
    if (typeof window.showLightbox === 'function') {
      window.showLightbox(pending.dataUrl, { type: 'image' });
    }
  };
  const thumb = thumbEl();
  if (thumb) {
    thumb.addEventListener('click', thumbClick);
    thumb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        thumbClick(e);
      }
    });
  }

  const barEl = bar();
  if (barEl) {
    barEl.addEventListener('mouseenter', () => {
      if (!pending) return;
      paused = true;
    });
    barEl.addEventListener('mouseleave', () => {
      if (!pending) return;
      paused = false;
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && enabled) poll();
  });

  refreshClipboardQuick();
})();
