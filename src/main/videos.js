const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['mp4', 'webm', 'mov']);
const MAX_BYTES = 200 * 1024 * 1024; // 200MB
const MAX_VIDEOS = 3;

function extOf(absPath) {
  return (path.extname(absPath) || '').slice(1).toLowerCase();
}

function assertVideoFile(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error('视频文件不存在');
  }
  const ext = extOf(absPath);
  if (!ALLOWED.has(ext)) throw new Error('不支持的视频类型，仅支持 mp4/webm/mov');
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error('无效的视频路径');
  if (stat.size > MAX_BYTES) throw new Error('视频超过 200MB 限制');
  return absPath;
}

module.exports = {
  assertVideoFile,
  extOf,
  ALLOWED,
  MAX_BYTES,
  MAX_VIDEOS,
};
