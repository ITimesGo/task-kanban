const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'bmp']);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function extOf(absPath) {
  return (path.extname(absPath) || '').slice(1).toLowerCase().replace('jpeg', 'jpg');
}

function mimeOfExt(ext) {
  if (ext === 'jpg') return 'jpeg';
  return ext; // png / bmp
}

/** 校验本地图片路径（不读入内存为 base64），通过则返回绝对路径 */
function assertImageFile(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error('图片文件不存在');
  }
  const ext = extOf(absPath);
  if (!ALLOWED.has(ext)) throw new Error('不支持的文件类型，仅支持 jpg/png/bmp');
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error('无效的图片路径');
  if (stat.size > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  return absPath;
}

function dataUrlForPath(absPath) {
  assertImageFile(absPath);
  const ext = extOf(absPath);
  const buf = fs.readFileSync(absPath);
  return `data:image/${mimeOfExt(ext)};base64,${buf.toString('base64')}`;
}

function dataUrlForClipboard(image) {
  const png = image.toPNG();
  if (!png || !png.length) return null;
  if (png.length > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** 将剪贴板 NativeImage 写成 PNG 文件，返回目标路径（不经 base64 往返） */
function writeClipboardPng(image, destPath) {
  if (!image || image.isEmpty()) return null;
  const png = image.toPNG();
  if (!png || !png.length) return null;
  if (png.length > MAX_BYTES) throw new Error('图片超过 10MB 限制');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, png);
  return destPath;
}

module.exports = {
  assertImageFile,
  dataUrlForPath,
  dataUrlForClipboard,
  writeClipboardPng,
  extOf,
  ALLOWED,
  MAX_BYTES,
};
