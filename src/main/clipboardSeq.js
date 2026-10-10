/** Windows: GetClipboardSequenceNumber —— 剪贴板未变则不必 readImage */
let getSeqFn = null;
let loadTried = false;

function loadWinSeq() {
  if (loadTried) return getSeqFn;
  loadTried = true;
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    getSeqFn = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
  } catch (_) {
    getSeqFn = null;
  }
  return getSeqFn;
}

/** @returns {number|null} 当前剪贴板序号；不可用时返回 null */
function getClipboardSequenceNumber() {
  const fn = loadWinSeq();
  if (!fn) return null;
  try {
    return fn();
  } catch (_) {
    return null;
  }
}

module.exports = { getClipboardSequenceNumber };
