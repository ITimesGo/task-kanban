const path = require('path');
const fs = require('fs');

const pendingSrcAllow = new Set();

function getNativeImage() {
  return require('electron').nativeImage;
}

function allowPendingSrcPath(absPath) {
  try {
    const abs = path.resolve(String(absPath || ''));
    if (!abs || !path.isAbsolute(abs)) return false;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
    pendingSrcAllow.add(abs);
    // also allow normalized variants
    pendingSrcAllow.add(path.normalize(abs));
    return true;
  } catch (_) {
    return false;
  }
}

function isAllowedSrcPath(absPath) {
  try {
    const abs = path.resolve(String(absPath || ''));
    return pendingSrcAllow.has(abs) || pendingSrcAllow.has(path.normalize(abs));
  } catch (_) {
    return false;
  }
}

/** @returns {string|null} absolute path under appData, or null */
function sanitizeRel(rel, appData) {
  const clean = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.includes('..') || path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
    return null;
  }
  const abs = path.resolve(path.join(appData, clean));
  const root = path.resolve(appData);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

function defaultSaveName(payload) {
  const kind = payload && payload.kind === 'video' ? 'video' : 'image';
  if (payload && payload.rel) return path.basename(String(payload.rel));
  if (payload && payload.srcPath) return path.basename(String(payload.srcPath));
  if (payload && payload.dataUrl && typeof payload.dataUrl === 'string') {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+)/.exec(payload.dataUrl);
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime.includes('jpeg') || mime.includes('jpg')) return 'image.jpg';
      if (mime.includes('gif')) return 'image.gif';
      if (mime.includes('webp')) return 'image.webp';
      if (mime.includes('bmp')) return 'image.bmp';
    }
    return 'image.png';
  }
  return kind === 'video' ? 'video.mp4' : 'image.png';
}

/**
 * Resolve trusted absolute path or image bits from payload.
 * @returns {{ ok:true, absPath?:string, dataUrl?:string, kind:string } | { ok:false, error:string }}
 */
function resolvePayload(payload, appData) {
  const kind = payload && payload.kind === 'video' ? 'video' : 'image';
  if (payload && payload.dataUrl) {
    if (kind === 'video') return { ok: false, error: '无法处理该媒体' };
    const dataUrl = String(payload.dataUrl);
    if (!dataUrl.startsWith('data:image/')) return { ok: false, error: '无法处理该媒体' };
    return { ok: true, kind, dataUrl };
  }
  if (payload && payload.rel) {
    const abs = sanitizeRel(payload.rel, appData);
    if (!abs) return { ok: false, error: '无法打开文件' };
    return { ok: true, kind, absPath: abs, rel: String(payload.rel) };
  }
  if (payload && payload.srcPath) {
    const abs = path.resolve(String(payload.srcPath));
    if (!isAllowedSrcPath(abs)) return { ok: false, error: '无法打开文件' };
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, error: '无法打开文件' };
    return { ok: true, kind, absPath: abs };
  }
  return { ok: false, error: '无法处理该媒体' };
}

function copyMedia(payload, deps = {}) {
  const appData = deps.appData;
  const clipboard = deps.clipboard || require('electron').clipboard;
  const writeFiles = deps.writeFilesToClipboard
    || require('./clipboardFiles').writeFilesToClipboard;
  const resolved = resolvePayload(payload, appData);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  try {
    if (resolved.kind === 'image') {
      let img;
      if (resolved.dataUrl) {
        img = getNativeImage().createFromDataURL(resolved.dataUrl);
      } else {
        img = getNativeImage().createFromPath(resolved.absPath);
      }
      if (!img || img.isEmpty()) return { ok: false, error: '复制失败' };
      clipboard.writeImage(img);
      return { ok: true };
    }
    // video: file list
    if (!resolved.absPath) return { ok: false, error: '无本地文件' };
    return writeFiles([resolved.absPath], { clipboard });
  } catch (_) {
    return { ok: false, error: '复制失败' };
  }
}

async function saveMediaAs(payload, deps = {}) {
  const appData = deps.appData;
  const dialog = deps.dialog || require('electron').dialog;
  const win = deps.win || null;
  const resolved = resolvePayload(payload, appData);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const kind = resolved.kind;
  const defaultPath = defaultSaveName(payload);
  const filters = kind === 'video'
    ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }]
    : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }];

  const res = await dialog.showSaveDialog(win || undefined, {
    defaultPath,
    filters,
  });
  if (res.canceled || !res.filePath) return { ok: false, cancelled: true };

  try {
    if (resolved.dataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(resolved.dataUrl);
      if (!m) return { ok: false, error: '保存失败' };
      const buf = Buffer.from(m[2], 'base64');
      fs.writeFileSync(res.filePath, buf);
      return { ok: true };
    }
    fs.copyFileSync(resolved.absPath, res.filePath);
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '保存失败' };
  }
}

async function openMedia(payload, deps = {}) {
  const appData = deps.appData;
  const shell = deps.shell || require('electron').shell;
  const resolved = resolvePayload(payload, appData);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!resolved.absPath) return { ok: false, error: '无本地文件' };
  try {
    const err = await shell.openPath(resolved.absPath);
    if (err) return { ok: false, error: '无法打开文件' };
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '无法打开文件' };
  }
}

function showMediaInFolder(payload, deps = {}) {
  const appData = deps.appData;
  const shell = deps.shell || require('electron').shell;
  const resolved = resolvePayload(payload, appData);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!resolved.absPath) return { ok: false, error: '无本地文件' };
  try {
    shell.showItemInFolder(resolved.absPath);
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '无法打开文件' };
  }
}

module.exports = {
  allowPendingSrcPath,
  isAllowedSrcPath,
  sanitizeRel,
  defaultSaveName,
  resolvePayload,
  copyMedia,
  saveMediaAs,
  openMedia,
  showMediaInFolder,
};
