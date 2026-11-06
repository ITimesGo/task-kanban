/** Windows: 序号和格式是否存在都不必解码图片。CF_BITMAP / CF_DIB / CF_DIBV5 */
const CF_BITMAP = 2;
const CF_DIB = 8;
const CF_DIBV5 = 17;

let getSeqFn = null;
let hasFormatFn = null;
let loadTried = false;

function loadWinClipboard() {
  if (loadTried) return;
  loadTried = true;
  if (process.platform !== 'win32') return;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    getSeqFn = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
    hasFormatFn = user32.func('int __stdcall IsClipboardFormatAvailable(uint32)');
  } catch (_) {
    getSeqFn = null;
    hasFormatFn = null;
  }
}

/** @returns {number|null} 当前剪贴板序号；不可用时返回 null */
function getClipboardSequenceNumber() {
  loadWinClipboard();
  if (!getSeqFn) return null;
  try {
    return getSeqFn();
  } catch (_) {
    return null;
  }
}

/** 剪贴板里有位图，但不把像素读进进程 */
function clipboardHasBitmap() {
  loadWinClipboard();
  if (!hasFormatFn) return false;
  try {
    return !!(hasFormatFn(CF_DIB) || hasFormatFn(CF_DIBV5) || hasFormatFn(CF_BITMAP));
  } catch (_) {
    return false;
  }
}

module.exports = { getClipboardSequenceNumber, clipboardHasBitmap };
