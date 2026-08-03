const fs = require('fs');

const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'bmp']);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function dataUrlForPath(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const ext = (absPath.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg');
  if (!ALLOWED.has(ext)) throw new Error('不支持的文件类型，仅支持 jpg/png/bmp');
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  const buf = fs.readFileSync(absPath);
  return `data:image/${ext === 'bmp' ? 'bmp' : ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
}

function dataUrlForClipboard(image) {
  // image: Electron NativeImage
  const png = image.toPNG();
  if (!png || !png.length) return null;
  if (png.length > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { dataUrlForPath, dataUrlForClipboard, ALLOWED, MAX_BYTES };
