/** Windows 剪贴板文件列表（CF_HDROP） */

function createCFHDropBuffer(paths) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((p) => String(p || ''))
    .filter(Boolean);
  if (!list.length) throw new Error('empty paths');

  const DROPFILES_SIZE = 20;
  const header = Buffer.alloc(DROPFILES_SIZE);
  header.writeUInt32LE(DROPFILES_SIZE, 0); // pFiles
  header.writeInt32LE(0, 4); // pt.x
  header.writeInt32LE(0, 8); // pt.y
  header.writeUInt32LE(0, 12); // fNC
  header.writeUInt32LE(1, 16); // fWide = TRUE

  const fileList = list.join('\0') + '\0\0';
  const listBuf = Buffer.from(fileList, 'utf16le');
  return Buffer.concat([header, listBuf]);
}

/**
 * @param {string[]} paths absolute file paths
 * @param {{ clipboard?: { writeBuffer: Function } }} [deps]
 * @returns {{ ok: boolean, error?: string }}
 */
function writeFilesToClipboard(paths, deps = {}) {
  const clipboard = deps.clipboard || (() => {
    try { return require('electron').clipboard; } catch (_) { return null; }
  })();
  if (!clipboard || typeof clipboard.writeBuffer !== 'function') {
    return { ok: false, error: '复制失败' };
  }
  try {
    const abs = (Array.isArray(paths) ? paths : []).map((p) => String(p || '')).filter(Boolean);
    if (!abs.length) return { ok: false, error: '复制失败' };
    const buf = createCFHDropBuffer(abs);
    clipboard.writeBuffer('CF_HDROP', buf);
    const dropEffect = Buffer.alloc(4);
    dropEffect.writeUInt32LE(1, 0); // DROPEFFECT_COPY
    try { clipboard.writeBuffer('Preferred DropEffect', dropEffect); } catch (_) { /* optional */ }
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '复制失败' };
  }
}

module.exports = { createCFHDropBuffer, writeFilesToClipboard };
