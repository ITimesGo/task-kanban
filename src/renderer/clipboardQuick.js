/** 剪贴板快贴：仅在应用运行期间出现「新复制」时提示，启动时已有内容不弹 */
(function () {
  const AUTO_HIDE_MS = 5000; // 不理睬则自动消失
  const URGENT_MS = 2000; // 剩余不足此时长标红提示

  let enabled = false;
  let lastSig = '';
  let lastSeq = null;
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
  /** 取消过期的缩略图拉取（提示条已换/关掉） */
  let thumbToken = 0;

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
    track.classList.toggle('is-urgent', left <= URGENT_MS);
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
    track.title = '5 秒后自动关闭';
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
    thumbToken += 1;
    clearAutoHide();
    const el = bar();
    if (el) el.classList.add('hidden');
    pending = null;
    if (thumbEl()) {
      const th = thumbEl();
      th.hidden = true;
      th.removeAttribute('src');
      th.classList.remove('is-loading');
    }
    syncTargetLabel();
  }

  function paintThumb(dataUrl, { loading = false } = {}) {
    const thumb = thumbEl();
    if (!thumb) return;
    thumb.hidden = false;
    thumb.title = '点击放大看原图';
    thumb.setAttribute('role', 'button');
    thumb.tabIndex = 0;
    thumb.classList.toggle('is-loading', !!loading);
    if (dataUrl) {
      thumb.src = dataUrl;
      thumb.classList.remove('is-loading');
    } else {
      thumb.removeAttribute('src');
    }
  }

  /** 条先出来，空闲后再拉低清缩略图；点放大/填入再拉原图 */
  function scheduleThumbForPending(sig) {
    const token = ++thumbToken;
    const run = async () => {
      if (token !== thumbToken) return;
      if (!pending || pending.type !== 'image' || pending.sig !== sig) return;
      if (typeof API.clipboardPeek !== 'function') return;
      try {
        const thumb = await API.clipboardPeek({ withData: true, quality: 'thumb' });
        if (token !== thumbToken) return;
        if (!pending || pending.type !== 'image' || pending.sig !== sig) return;
        if (!thumb || !thumb.ok || thumb.type !== 'image' || !thumb.dataUrl) return;
        pending = {
          ...pending,
          dataUrl: thumb.dataUrl,
          previewOnly: true,
          sig: thumb.sig || sig,
        };
        paintThumb(thumb.dataUrl);
      } catch (_) { /* ignore */ }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => { run(); }, { timeout: 500 });
    } else {
      setTimeout(run, 48);
    }
  }

  function showBar(payload) {
    pending = payload;
    const el = bar();
    const t = textEl();
    const thumb = thumbEl();
    if (!el || !t) return;
    if (payload.type === 'image') {
      if (payload.dataUrl) {
        paintThumb(payload.dataUrl);
      } else if (thumb) {
        // 占位先出，避免「没图」；缩略图异步补上
        paintThumb('', { loading: true });
        scheduleThumbForPending(payload.sig);
      }
    } else {
      t.textContent = `剪贴板：${payload.preview || '新文字'}`;
      if (thumb) {
        thumb.hidden = true;
        thumb.removeAttribute('src');
        thumb.classList.remove('is-loading');
      }
    }
    syncTargetLabel();
    el.classList.remove('hidden');
    scheduleAutoHide();
  }

  /**
   * @param {{ resume?: boolean }} [opts]
   * resume=true：从后台切回；仍用轻量 probe（不 readImage），但剪贴板有变化时要弹条
   */
  async function poll(opts = {}) {
    const resume = !!(opts && opts.resume);
    if (!enabled || busy) return;
    if (document.hidden) return;
    if (!resume && typeof document.hasFocus === 'function' && !document.hasFocus()) return;
    const settings = document.getElementById('settingsOverlay');
    const lightbox = document.getElementById('lightboxOverlay');
    if (settings && !settings.classList.contains('hidden')) return;
    if (lightbox && !lightbox.classList.contains('hidden')) return;

    busy = true;
    try {
      // 轻量探测：图片路径不 readImage，避免切回前台被大图卡死
      const probe = typeof API.clipboardProbe === 'function'
        ? API.clipboardProbe
        : API.clipboardPeek;
      const res = await probe({
        lastSeq: lastSeq != null ? lastSeq : undefined,
      });
      if (!res || !res.ok) return;
      if (res.seq != null) lastSeq = res.seq;
      if (res.unchanged) {
        if (!primed) primed = true;
        return;
      }

      if (!res.sig || res.type === 'empty') {
        lastSig = '';
        primed = true;
        return;
      }

      // 仅启动第一次：记下当前剪贴板作基线，不弹（避免一打开就提示旧内容）
      if (!primed) {
        lastSig = res.sig;
        primed = true;
        return;
      }

      if (res.sig === lastSig) return;
      lastSig = res.sig;

      if (res.type === 'image') {
        // 先弹条（不卡主线程）；缩略图空闲补画；点放大/填入再读原图
        showBar({
          type: 'image',
          sig: res.sig,
          light: true,
          previewOnly: true,
        });
        return;
      }
      if (res.type === 'text') {
        showBar({
          type: 'text',
          sig: res.sig,
          preview: res.preview,
          text: res.text,
        });
      }
    } catch (_) {
      /* ignore */
    } finally {
      busy = false;
    }
  }

  /** 填入/放大：始终要原图（缩略图 previewOnly=true 不能直接用） */
  async function resolvePayloadForApply(payload) {
    if (!payload) return payload;
    if (payload.type === 'text') return payload;
    if (payload.type !== 'image') return payload;
    if (payload.previewOnly === false && payload.dataUrl) return payload;
    try {
      const full = await API.clipboardPeek({ withData: true, quality: 'full' });
      if (full && full.ok && full.type === 'image' && full.dataUrl) {
        return {
          ...payload,
          dataUrl: full.dataUrl,
          previewOnly: false,
          sig: full.sig || payload.sig,
        };
      }
    } catch (_) { /* ignore */ }
    return payload;
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
      lastSeq = null;
      primed = false;
      if (timer) { clearInterval(timer); timer = null; }
      return;
    }

    const justEnabled = !enabled;
    enabled = true;
    if (!timer) timer = setInterval(poll, 2500);
    if (justEnabled || !primed) {
      lastSig = '';
      lastSeq = null;
      primed = false;
      setTimeout(() => { if (enabled) poll(); }, justEnabled ? 2800 : 0);
    }
  }

  window.refreshClipboardQuick = refreshClipboardQuick;

  document.getElementById('clipQuickApply')?.addEventListener('click', async () => {
    if (!pending) return;
    const btn = document.getElementById('clipQuickApply');
    if (btn) btn.disabled = true;
    try {
      const payload = await resolvePayloadForApply(pending);
      const ok = typeof window.applyClipboardQuick === 'function'
        ? window.applyClipboardQuick(payload)
        : false;
      if (ok) hideBar();
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.getElementById('clipQuickDismiss')?.addEventListener('click', hideBar);

  const thumbClick = async (e) => {
    e.stopPropagation();
    if (!pending || pending.type !== 'image') return;
    const payload = await resolvePayloadForApply(pending);
    if (!payload || !payload.dataUrl) return;
    if (typeof window.showLightbox === 'function') {
      window.showLightbox(payload.dataUrl, { type: 'image' });
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
    if (document.hidden) return;
    if (!enabled) return;
    // 切回前台立刻轻量探测：有新内容则弹条（仍不 readImage）
    setTimeout(() => { if (enabled) poll({ resume: true }); }, 0);
  });

  window.addEventListener('focus', () => {
    if (!enabled || document.hidden) return;
    setTimeout(() => { if (enabled) poll({ resume: true }); }, 0);
  });

  // 延迟启动，让首屏先可交互
  setTimeout(() => { refreshClipboardQuick(); }, 3200);
})();
