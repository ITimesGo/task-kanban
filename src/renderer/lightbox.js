// 图片灯箱：滚轮缩放 + 拖拽移动；离线 OCR 提取文字
let lb = {
  zoom: 1,
  tx: 0, ty: 0,
  dragging: false, startX: 0, startY: 0, moved: false,
  ocrBusy: false,
};

function applyLightbox() {
  const img = $('#lightboxImg');
  const nw = img.naturalWidth || 0;
  if (nw) img.style.width = `${Math.round(nw * lb.zoom)}px`;
  img.style.transform = `translate(${lb.tx}px, ${lb.ty}px)`;
}

function resetLightbox() {
  lb.zoom = 1; lb.tx = 0; lb.ty = 0; lb.moved = false;
  $('#lightboxImg').style.width = '';
  $('#lightboxImg').style.transform = '';
}

function fitLightbox() {
  const img = $('#lightboxImg');
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return;
  const zoom = Math.min(1, (window.innerWidth * 0.9) / nw, (window.innerHeight * 0.85) / nh);
  lb.zoom = Math.max(0.05, zoom);
  lb.tx = 0; lb.ty = 0;
  applyLightbox();
}

function resetOcrPanel() {
  const panel = $('#lightboxOcrPanel');
  const text = $('#lightboxOcrText');
  const status = $('#lightboxOcrStatus');
  const copyBtn = $('#lightboxOcrCopy');
  if (panel) panel.classList.add('hidden');
  if (text) text.value = '';
  if (status) status.textContent = '';
  if (copyBtn) copyBtn.disabled = true;
  lb.ocrBusy = false;
  const btn = $('#lightboxOcrBtn');
  if (btn) { btn.disabled = false; btn.textContent = '提取文字'; }
}

function setOcrStatus(msg) {
  const status = $('#lightboxOcrStatus');
  if (status) status.textContent = msg || '';
}

function showOcrPanel() {
  const panel = $('#lightboxOcrPanel');
  if (panel) panel.classList.remove('hidden');
}

async function imageToDataUrl(img) {
  if (!img || !img.src) throw new Error('没有可识别的图片');
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('图片尚未加载完成');

  // 更积极放大 + 直方图拉伸 + 浅色截图二值化，提升灰字/聊天记录识别
  const minSide = Math.min(w, h);
  const scale = Math.min(3, Math.max(1.5, 2000 / minSide));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, dw, dh);

  try {
    const id = ctx.getImageData(0, 0, dw, dh);
    const d = id.data;
    const n = d.length / 4;
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g] += 1;
      sum += g;
    }
    const mean = sum / n;
    // 2%–98% 分位拉伸，压掉灰雾
    const loCount = n * 0.02;
    const hiCount = n * 0.98;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= loCount) { lo = v; break; }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= hiCount) { hi = v; break; }
    }
    if (hi <= lo) { lo = 0; hi = 255; }
    const range = hi - lo || 1;
    for (let i = 0; i < d.length; i += 4) {
      let g = d[i];
      g = Math.max(0, Math.min(255, Math.round(((g - lo) / range) * 255)));
      // 浅色界面（聊天截图）再二值化，灰字更利落
      if (mean > 170) g = g > 150 ? 255 : 0;
      else g = Math.max(0, Math.min(255, Math.round((g - 128) * 1.35 + 128)));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(id, 0, 0);
  } catch (_) {
    // getImageData 失败时仍用放大原图
  }
  return canvas.toDataURL('image/png');
}

function progressMessage(p) {
  if (!p) return '';
  if (p.message) return p.message;
  if (p.phase === 'download') {
    if (p.status === 'need') return p.message || '正在准备语言包…';
    if (p.status === 'start') return `正在下载高质量语言包 ${p.lang || ''}…（仅首次）`;
    if (p.status === 'inflate') return `正在解压 ${p.lang || ''}…`;
    if (p.status === 'done') return `语言包 ${p.lang || ''} 已就绪`;
  }
  if (p.phase === 'init') return p.status === 'done' ? '引擎就绪' : '正在初始化识别引擎…';
  if (p.phase === 'ocr') {
    if (typeof p.progress === 'number') return `识别中 ${Math.round(p.progress * 100)}%`;
    return p.status === 'recognizing' ? '正在识别文字…' : (p.status || '识别中…');
  }
  return '';
}

async function getOcrPluginState() {
  try {
    const list = await API.listPlugins();
    return (list || []).find((p) => p.id === 'ocr') || null;
  } catch (_) {
    return null;
  }
}

async function refreshLightboxOcrEntry() {
  const btn = $('#lightboxOcrBtn');
  if (!btn) return;
  if (lb.mediaType === 'video') {
    btn.hidden = true;
    btn.dataset.ocrMode = 'off';
    return;
  }
  const p = await getOcrPluginState();
  const ready = !!(p && p.installed && p.enabled);
  if (!ready) {
    btn.hidden = true;
    btn.dataset.ocrMode = 'off';
    return;
  }
  btn.hidden = false;
  btn.textContent = '提取文字';
  btn.title = '离线识别图片中的文字';
  btn.dataset.ocrMode = 'run';
}
window.refreshLightboxOcrEntry = refreshLightboxOcrEntry;

async function runLightboxOcr() {
  if (lb.ocrBusy) return;
  const btn = $('#lightboxOcrBtn');
  if (btn?.hidden || btn?.dataset.ocrMode !== 'run') return;

  const img = $('#lightboxImg');
  const textEl = $('#lightboxOcrText');
  const copyBtn = $('#lightboxOcrCopy');
  lb.ocrBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = '识别中…'; }
  showOcrPanel();
  if (textEl) textEl.value = '';
  if (copyBtn) copyBtn.disabled = true;
  setOcrStatus('准备识别…');

  const offProgress = API.onOcrProgress((p) => {
    const msg = progressMessage(p);
    if (msg) setOcrStatus(msg);
  });

  try {
    const dataUrl = await imageToDataUrl(img);
    const res = await API.ocrRecognize(dataUrl);
    if (!res || !res.ok) {
      if (res && (res.code === 'NOT_INSTALLED' || res.code === 'DISABLED')) {
        setOcrStatus(res.error || '插件不可用');
        await refreshLightboxOcrEntry();
        return;
      }
      throw new Error((res && res.error) || '识别失败');
    }
    if (textEl) textEl.value = res.text || '';
    if (copyBtn) copyBtn.disabled = !(res.text && res.text.trim());
    setOcrStatus(res.text && res.text.trim() ? '识别完成，可选择或复制文字' : '未识别到文字');
    const rel = relFromImageSrc(lb.currentSrc || img.src);
    if (rel && res.text && res.text.trim()) {
      try {
        await API.ocrIndexSet(rel, res.text);
        if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
      } catch (_) { /* ignore */ }
    }
  } catch (err) {
    setOcrStatus(err.message || String(err));
  } finally {
    if (typeof offProgress === 'function') offProgress();
    lb.ocrBusy = false;
    await refreshLightboxOcrEntry();
    if (btn) btn.disabled = false;
  }
}

function relFromImageSrc(src) {
  if (!src || typeof src !== 'string') return '';
  if (src.startsWith('taskimage://')) {
    try {
      const u = new URL(src);
      return decodeURIComponent(u.pathname || '').replace(/^\/+/, '');
    } catch (_) {
      return '';
    }
  }
  return '';
}

window.showLightbox = (src, opts = {}) => {
  const type = opts && opts.type === 'video' ? 'video' : 'image';
  const img = $('#lightboxImg');
  const video = $('#lightboxVideo');
  resetLightbox();
  resetOcrPanel();
  lb.currentSrc = src || '';
  lb.mediaType = type;
  if (type === 'video') {
    if (img) {
      img.classList.add('hidden');
      img.removeAttribute('src');
    }
    if (video) {
      video.classList.remove('hidden');
      video.src = src || '';
      try { video.currentTime = 0; } catch (_) { /* ignore */ }
      video.play?.().catch(() => {});
    }
    const ocrBtn = $('#lightboxOcrBtn');
    if (ocrBtn) ocrBtn.hidden = true;
  } else {
    if (video) {
      try { video.pause(); } catch (_) { /* ignore */ }
      video.removeAttribute('src');
      video.classList.add('hidden');
      video.load?.();
    }
    if (img) {
      img.classList.remove('hidden');
      img.src = src;
      img.onload = () => { fitLightbox(); };
    }
    refreshLightboxOcrEntry();
  }
  $('#lightboxOverlay').classList.remove('hidden');
};

function closeLightbox() {
  $('#lightboxOverlay').classList.add('hidden');
  const video = $('#lightboxVideo');
  if (video) {
    try { video.pause(); } catch (_) { /* ignore */ }
    video.removeAttribute('src');
    video.load?.();
  }
  resetOcrPanel();
}

$('#lightboxOverlay').addEventListener('wheel', (e) => {
  if (lb.mediaType === 'video') return;
  if (e.target.closest('.lightbox-ocr-panel') || e.target.closest('.lightbox-toolbar')) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  lb.zoom = Math.min(10, Math.max(0.05, lb.zoom * factor));
  applyLightbox();
}, { passive: false });

$('#lightboxOverlay').addEventListener('mousedown', (e) => {
  if (lb.mediaType === 'video') return;
  if (e.button !== 0) return;
  if (e.target.closest('.lightbox-toolbar') || e.target.closest('.lightbox-ocr-panel')) return;
  lb.dragging = true;
  lb.moved = false;
  lb.startX = e.clientX - lb.tx;
  lb.startY = e.clientY - lb.ty;
  $('#lightboxOverlay').style.cursor = 'grabbing';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!lb.dragging) return;
  const nx = e.clientX - lb.startX;
  const ny = e.clientY - lb.startY;
  if (Math.abs(nx - lb.tx) > 2 || Math.abs(ny - lb.ty) > 2) lb.moved = true;
  lb.tx = nx; lb.ty = ny;
  applyLightbox();
});
window.addEventListener('mouseup', () => {
  if (!lb.dragging) return;
  lb.dragging = false;
  $('#lightboxOverlay').style.cursor = '';
});

$('#lightboxOverlay').addEventListener('click', (e) => {
  if (lb.moved) return;
  if (e.target.closest('.lightbox-toolbar') || e.target.closest('.lightbox-ocr-panel')) return;
  if (e.target.id === 'lightboxImg' || e.target.id === 'lightboxVideo') return; // 点媒体不关
  closeLightbox();
});

document.getElementById('lightboxCloseBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeLightbox();
});
document.getElementById('lightboxOcrBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  runLightboxOcr();
});
document.getElementById('lightboxOcrHide')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('#lightboxOcrPanel')?.classList.add('hidden');
});
document.getElementById('lightboxOcrCopy')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  const text = $('#lightboxOcrText')?.value || '';
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    setOcrStatus('已复制到剪贴板');
  } catch (_) {
    $('#lightboxOcrText')?.select();
    setOcrStatus('请手动复制（Ctrl+C）');
  }
});
