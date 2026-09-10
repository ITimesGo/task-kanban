/** 视频封面：截取首帧，避免黑块预览 */

const posterCache = new Map();

function captureVideoPoster(src, { timeoutMs = 5000 } = {}) {
  if (!src) return Promise.resolve('');
  if (posterCache.has(src)) return Promise.resolve(posterCache.get(src));

  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { video.pause(); } catch (_) { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch (_) { /* ignore */ }
      const out = url || '';
      if (out) posterCache.set(src, out);
      resolve(out);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // 勿设 crossOrigin：本地 taskimage/file/blob 会因此加载失败或 canvas 污染

    const tryCapture = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return false;
        const max = 320;
        const scale = Math.min(1, max / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, cw, ch);
        finish(canvas.toDataURL('image/jpeg', 0.72));
        return true;
      } catch (_) {
        return false;
      }
    };

    video.addEventListener('loadeddata', () => {
      const dur = video.duration;
      const t = Number.isFinite(dur) && dur > 0
        ? Math.min(0.25, Math.max(0.05, dur * 0.05))
        : 0.1;
      try {
        video.currentTime = t;
      } catch (_) {
        tryCapture() || finish('');
      }
    });
    video.addEventListener('seeked', () => {
      if (!tryCapture()) finish('');
    });
    video.addEventListener('error', () => finish(''));
    video.src = src;
  });
}

/** 列表/编辑缩略图：优先封面图，失败则跳到 0.1s 露出画面 */
async function bindVideoThumb(el, src, onPlay) {
  if (!el || !src) return;
  const wrap = el.closest('.thumb-wrap, .thumb-tile') || el.parentElement;
  const ensureBadge = () => {
    if (wrap && !wrap.querySelector('.thumb-play')) {
      wrap.insertAdjacentHTML(
        'beforeend',
        '<span class="thumb-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>'
      );
    }
  };
  const bindClick = (node) => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onPlay === 'function') onPlay();
    });
  };

  const poster = await captureVideoPoster(src);
  if (poster) {
    const img = document.createElement('img');
    img.className = el.className || 'thumb';
    img.src = poster;
    img.alt = '';
    img.title = '点击播放';
    bindClick(img);
    el.replaceWith(img);
  } else {
    try {
      el.preload = 'auto';
      el.muted = true;
      if (!el.src) el.src = src;
      const jump = () => {
        try { el.currentTime = Math.min(0.15, (el.duration || 1) * 0.05); } catch (_) { /* ignore */ }
      };
      if (el.readyState >= 2) jump();
      else el.addEventListener('loadeddata', jump, { once: true });
      bindClick(el);
    } catch (_) { /* ignore */ }
  }
  ensureBadge();
}
