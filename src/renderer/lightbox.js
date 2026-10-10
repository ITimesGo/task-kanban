// 图片灯箱：滚轮缩放 + 拖拽移动；右键菜单离线 OCR 提取文字
let lb = {
  zoom: 1,
  tx: 0, ty: 0,
  dragging: false, startX: 0, startY: 0, moved: false,
  ocrBusy: false,
  ocrAvailable: false,
  mediaType: 'image',
  currentSrc: '',
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

  // 回退路径：无本地 rel 时，放大后送主进程（主进程仍会再预处理）
  const minSide = Math.min(w, h);
  const scale = Math.min(3, Math.max(1, 1800 / minSide));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, dw, dh);
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
  if (lb.mediaType === 'video') {
    lb.ocrAvailable = false;
    return;
  }
  const p = await getOcrPluginState();
  lb.ocrAvailable = !!(p && p.installed && p.enabled);
}
window.refreshLightboxOcrEntry = refreshLightboxOcrEntry;

async function runLightboxOcr() {
  if (lb.mediaType === 'video' || !lb.ocrAvailable) return;
  // 识别进行中：只重新展开面板看进度，不重复发起识别
  if (lb.ocrBusy) {
    showOcrPanel();
    return;
  }
  // 已有结果且面板已收起：先展开查看，避免误触发重跑
  const panel = $('#lightboxOcrPanel');
  const textEl = $('#lightboxOcrText');
  const panelHidden = !panel || panel.classList.contains('hidden');
  if (panelHidden && textEl && textEl.value.trim()) {
    showOcrPanel();
    return;
  }

  const img = $('#lightboxImg');
  const copyBtn = $('#lightboxOcrCopy');
  lb.ocrBusy = true;
  showOcrPanel();
  if (textEl) textEl.value = '';
  if (copyBtn) copyBtn.disabled = true;
  setOcrStatus('准备识别…');

  const offProgress = API.onOcrProgress((p) => {
    const msg = progressMessage(p);
    if (msg) setOcrStatus(msg);
  });

  try {
    const rel = relFromImageSrc(lb.currentSrc || (img && img.src) || '');
    // 优先传本地相对路径，由主进程读原图并预处理（避免 canvas 二次压缩丢细节）
    const res = rel
      ? await API.ocrRecognize({ rel })
      : await API.ocrRecognize(await imageToDataUrl(img));
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
    // 收起过面板时，完成后自动再展开，避免只能看到「识别中」却打不开
    showOcrPanel();
    if (rel && res.text && res.text.trim()) {
      try {
        await API.ocrIndexSet(rel, res.text);
        if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
      } catch (_) { /* ignore */ }
    }
  } catch (err) {
    setOcrStatus(err.message || String(err));
    showOcrPanel();
  } finally {
    if (typeof offProgress === 'function') offProgress();
    lb.ocrBusy = false;
    await refreshLightboxOcrEntry();
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

function resolveLightboxLocal() {
  const img = $('#lightboxImg');
  const src = lb.currentSrc || (img && img.src) || '';
  const kind = lb.mediaType === 'video' ? 'video' : 'image';
  const rel = relFromImageSrc(src);
  if (rel) return { kind, rel };
  if (src.startsWith('data:')) return { kind, dataUrl: src };
  if (src) return { kind, srcPath: src };
  return { kind };
}

function srcFromMediaLocal(local) {
  if (!local) return '';
  if (local.dataUrl) return local.dataUrl;
  if (local.rel && typeof API !== 'undefined') {
    if (typeof API.imageUrl === 'function') return API.imageUrl(local.rel);
    if (typeof API.mediaFileUrl === 'function') return API.mediaFileUrl(local.rel) || '';
  }
  if (local.srcPath) {
    if (typeof API !== 'undefined' && typeof API.localFileUrl === 'function') {
      try { return API.localFileUrl(local.srcPath); } catch (_) { /* fall through */ }
    }
    return local.srcPath;
  }
  return '';
}

function waitLightboxImageReady() {
  const img = $('#lightboxImg');
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 8000);
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });
}

/** 任意图片来源：打开预览（必要时）并跑 OCR */
async function runMediaOcr(local) {
  if (!local || local.kind === 'video') return;
  // 识别中：若灯箱已打开则交给 runLightboxOcr 展开面板；否则仍要先打开对应图片
  const src = srcFromMediaLocal(local);
  if (!src) {
    alert('无法识别该图片');
    return;
  }
  const overlay = $('#lightboxOverlay');
  const open = overlay && !overlay.classList.contains('hidden');
  const same = open && lb.mediaType === 'image' && lb.currentSrc === src;
  if (!same) {
    window.showLightbox(src, { type: 'image' });
    await waitLightboxImageReady();
  }
  await refreshLightboxOcrEntry();
  if (!lb.ocrAvailable) {
    alert('请先在设置中安装并开启「文字识别」插件');
    return;
  }
  await runLightboxOcr();
}
window.runMediaOcr = runMediaOcr;

async function openLightboxContextMenu(e) {
  if (typeof openMediaContextMenu !== 'function') return;
  e.preventDefault();
  e.stopPropagation();
  openMediaContextMenu({
    clientX: e.clientX,
    clientY: e.clientY,
    canDelete: false,
    resolveLocal: resolveLightboxLocal,
  });
}

window.showLightbox = (src, opts = {}) => {
  const type = opts && opts.type === 'video' ? 'video' : 'image';
  const img = $('#lightboxImg');
  const video = $('#lightboxVideo');
  resetLightbox();
  resetOcrPanel();
  lb.currentSrc = src || '';
  lb.mediaType = type;
  lb.ocrAvailable = false;
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
  if (typeof closeMediaContextMenu === 'function') closeMediaContextMenu();
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
  if (e.target.closest('.media-ctx-menu')) return;
  closeLightbox();
});

$('#lightboxOverlay').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.lightbox-ocr-panel') || e.target.closest('.lightbox-toolbar')) return;
  if (e.target.closest('.media-ctx-menu')) return;
  openLightboxContextMenu(e);
});

document.getElementById('lightboxCloseBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeLightbox();
});
document.getElementById('lightboxOcrHide')?.addEventListener('click', (e) => {
  e.stopPropagation();
  // 仅收起面板；后台识别继续。再次右键「识别中…（点击查看）」可重新打开。
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
