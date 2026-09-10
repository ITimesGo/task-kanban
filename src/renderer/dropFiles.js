/** 拖放文件：识别图片/视频，并解析为本地路径或 dataUrl */
const IMG_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/bmp']);
const IMG_EXT = /\.(jpe?g|png|bmp)$/i;
const VID_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const VID_EXT = /\.(mp4|webm|mov)$/i;
const MAX_IMG_BYTES = 10 * 1024 * 1024;
const MAX_VID_BYTES = 200 * 1024 * 1024;

function isImageFile(file) {
  if (!file) return false;
  const t = String(file.type || '').toLowerCase();
  if (IMG_MIME.has(t)) return true;
  return IMG_EXT.test(file.name || '');
}

function isVideoFile(file) {
  if (!file) return false;
  const t = String(file.type || '').toLowerCase();
  if (t.startsWith('video/')) return true;
  if (VID_MIME.has(t)) return true;
  return VID_EXT.test(file.name || '');
}

/** 尽量在渲染进程直接读 path（勿先经 contextBridge，否则 path 常被剥离） */
function localPathOf(file) {
  if (!file) return '';
  try {
    if (file.path) return String(file.path);
  } catch (_) { /* ignore */ }
  try {
    const p = API.pathForFile(file);
    return p ? String(p) : '';
  } catch (_) {
    return '';
  }
}

/** @returns {Promise<string|null>} 本地绝对路径或 data: URL */
function resolveImageDrop(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    if (file.size > MAX_IMG_BYTES) {
      alert('图片超过10MB');
      resolve(null);
      return;
    }
    const p = localPathOf(file);
    if (p) { resolve(p); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * @returns {{srcPath:string, previewUrl?:string}|null}
 * previewUrl 用 blob: 立即预览，不依赖 file:// CSP / 路径桥接
 */
function resolveVideoDrop(file) {
  if (!file) return null;
  if (file.size > MAX_VID_BYTES) {
    alert('视频超过200MB');
    return null;
  }
  const p = localPathOf(file);
  if (!p) {
    alert('无法读取该视频的本地路径，请改用「添加图片或视频」按钮选择文件');
    return null;
  }
  let previewUrl = '';
  try { previewUrl = URL.createObjectURL(file); } catch (_) { /* ignore */ }
  return previewUrl ? { srcPath: p, previewUrl } : { srcPath: p };
}

function resolveAttachmentDrop(file) {
  return localPathOf(file) || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isImageFile,
    isVideoFile,
    resolveImageDrop,
    resolveVideoDrop,
    resolveAttachmentDrop,
    MAX_IMG_BYTES,
    MAX_VID_BYTES,
  };
}
