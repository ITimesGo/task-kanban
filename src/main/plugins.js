const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, clipboard } = require('electron');
const ocr = require('./ocr');
const ocrIndex = require('./ocrIndex');

/** 插件目录：后续新插件在此追加即可 */
const PLUGIN_CATALOG = [
  {
    id: 'ocr',
    name: '图片文字识别',
    desc: '在图片预览中提取可复制文字。使用高精度中英模型，首次需下载语言包，之后可离线使用。安装开启后可使用「图内文字搜索」。',
    sizeHint: '约 40–70MB（高精度）',
    kind: 'download',
  },
  {
    id: 'clipboard-quick',
    name: '剪贴板快贴',
    desc: '检测到剪贴板新文字或图片时提示一键填入「新建任务」，省去切换窗口再粘贴。',
    sizeHint: '',
    kind: 'builtin',
  },
  {
    id: 'ocr-search',
    name: '图内文字搜索',
    desc: '顶部搜索可匹配任务图片中的文字。开启后，新建/编辑任务里的图片会自动识别入库；也可一键为历史图片补建索引。需先安装并开启「图片文字识别」。',
    sizeHint: '',
    kind: 'builtin',
    requires: 'ocr',
  },
];

const PREFS_FILE = () => path.join(app.getPath('userData'), 'plugins.json');

function readPrefs() {
  try {
    const raw = fs.readFileSync(PREFS_FILE(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function writePrefs(prefs) {
  const file = PREFS_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2), 'utf8');
}

function prefFor(id) {
  const prefs = readPrefs();
  const saved = prefs[id];
  return saved && typeof saved === 'object' ? saved : {};
}

function ocrInstalled() {
  const st = ocr.langStatus && ocr.langStatus();
  if (!st) return false;
  // 中文包就绪即视为已安装；英文等高精度附加包可在识别时由 ensureLangs 补齐
  if ((st.langs || []).some((l) => l.lang === 'chi_sim' && l.ready)) return true;
  return !!st.ready;
}

function ocrReadyState() {
  const installed = ocrInstalled();
  const saved = prefFor('ocr');
  const enabled = installed && saved.enabled !== false;
  return { installed, enabled, ready: installed && enabled };
}

function listPlugins() {
  const ocrState = ocrReadyState();
  return PLUGIN_CATALOG.map((meta) => {
    const saved = prefFor(meta.id);
    if (meta.id === 'ocr') {
      return {
        ...meta,
        installed: ocrState.installed,
        enabled: ocrState.enabled,
        available: true,
      };
    }
    // 内置插件：始终可装，默认关闭
    let enabled = !!saved.enabled;
    let blockedReason = '';
    if (meta.requires === 'ocr' && !ocrState.ready) {
      // OCR 未就绪时搜索不可真正开启（偏好里若曾开启，对外视为关闭）
      enabled = false;
      blockedReason = ocrState.installed
        ? '需先开启「图片文字识别」'
        : '需先安装并开启「图片文字识别」';
    }
    return {
      ...meta,
      installed: true,
      enabled,
      available: true,
      blockedReason,
      dependencyReady: meta.requires === 'ocr' ? ocrState.ready : true,
    };
  });
}

function getPlugin(id) {
  return listPlugins().find((p) => p.id === id) || null;
}

function isEnabled(id) {
  const p = getPlugin(id);
  return !!(p && p.installed && p.enabled);
}

function setEnabled(id, enabled) {
  const meta = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!meta) return { ok: false, error: '未知插件' };
  if (id === 'ocr') {
    if (enabled && !ocrInstalled()) return { ok: false, error: '请先安装插件' };
  }
  if (id === 'ocr-search' && enabled) {
    const gate = assertOcrReady();
    if (!gate.ok) {
      return {
        ok: false,
        error: gate.error,
        code: gate.code || 'DEPENDENCY',
        needOcr: true,
      };
    }
  }
  const prefs = readPrefs();
  prefs[id] = { ...(prefs[id] || {}), enabled: !!enabled };
  // 关闭 / 卸载链路：关掉 OCR 时一并关闭依赖它的搜索
  if (id === 'ocr' && !enabled) {
    prefs['ocr-search'] = { ...(prefs['ocr-search'] || {}), enabled: false };
  }
  writePrefs(prefs);
  return { ok: true, plugin: getPlugin(id) };
}

async function install(id, onProgress) {
  const meta = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!meta) return { ok: false, error: '未知插件' };
  if (meta.kind === 'builtin') {
    return setEnabled(id, true);
  }
  if (id !== 'ocr') return { ok: false, error: '未知插件' };
  try {
    onProgress?.({ phase: 'install', status: 'start', percent: 1, message: '开始安装图片文字识别…' });
    await ocr.ensureLangs(onProgress);
    const prefs = readPrefs();
    prefs.ocr = { ...(prefs.ocr || {}), enabled: true };
    writePrefs(prefs);
    onProgress?.({ phase: 'install', status: 'done', percent: 100, message: '安装完成' });
    return { ok: true, plugin: getPlugin('ocr') };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function uninstall(id) {
  const meta = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!meta) return { ok: false, error: '未知插件' };
  if (meta.kind === 'builtin') {
    return setEnabled(id, false);
  }
  if (id !== 'ocr') return { ok: false, error: '未知插件' };
  try {
    await ocr.uninstall();
    const prefs = readPrefs();
    prefs.ocr = { ...(prefs.ocr || {}), enabled: false };
    prefs['ocr-search'] = { ...(prefs['ocr-search'] || {}), enabled: false };
    writePrefs(prefs);
    return { ok: true, plugin: getPlugin('ocr') };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function assertOcrReady() {
  const p = getPlugin('ocr');
  if (!p || !p.installed) {
    return { ok: false, error: '未安装「图片文字识别」插件', code: 'NOT_INSTALLED' };
  }
  if (!p.enabled) {
    return { ok: false, error: '「图片文字识别」插件未开启', code: 'DISABLED' };
  }
  return { ok: true };
}

const { getClipboardSequenceNumber } = require('./clipboardSeq');

function imageLooksPresent(formats) {
  return (formats || []).some((f) => /png|jpe?g|bmp|gif|webp|dib|bitmap|image/i.test(String(f)));
}

/** 小图样本签名，避免把整图压成 PNG */
function imageSig(img) {
  const size = img.getSize();
  const w = Math.max(0, size.width || 0);
  const h = Math.max(0, size.height || 0);
  let sample = img;
  const maxEdge = Math.max(w, h);
  if (maxEdge > 16) {
    const scale = 16 / maxEdge;
    sample = img.resize({
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      quality: 'good',
    });
  }
  const bitmap = sample.toBitmap();
  const hash = crypto.createHash('md5').update(bitmap).digest('hex').slice(0, 16);
  return `img:${hash}:${w}x${h}`;
}

/** 提示条用低清缩略图（约 48px JPEG），条上显示即可，勿塞原图 */
function imageThumbDataUrl(img, maxEdge = 48) {
  const size = img.getSize();
  const w = Math.max(0, size.width || 0);
  const h = Math.max(0, size.height || 0);
  let out = img;
  const edge = Math.max(w, h);
  if (edge > maxEdge) {
    const scale = maxEdge / edge;
    out = img.resize({
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      quality: 'better',
    });
  }
  try {
    const jpg = out.toJPEG(55);
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch (_) {
    const png = out.toPNG();
    return `data:image/png;base64,${png.toString('base64')}`;
  }
}

function imageFullDataUrl(img) {
  const png = img.toPNG();
  return `data:image/png;base64,${png.toString('base64')}`;
}

function textLooksPresent(formats) {
  return (formats || []).some((f) => /text|html|rtf|string/i.test(String(f)));
}

/** 探测时可内联带回的正文上限；更大则只带预览，填入时再 peek */
const PROBE_TEXT_INLINE_MAX = 100 * 1024;

/**
 * 轻量探测：序号 + formats；文字可 readText（通常很快），图片绝不 readImage。
 * 轮询 / 从后台恢复用；大图缩略图仍由 clipboardPeek 在悬停或填入时再读。
 */
function clipboardProbe(opts = {}) {
  const lastSeq = opts && opts.lastSeq != null ? Number(opts.lastSeq) : null;
  try {
    const seq = getClipboardSequenceNumber();
    if (seq != null && lastSeq != null && Number.isFinite(lastSeq) && seq === lastSeq) {
      return { ok: true, unchanged: true, seq };
    }
    const formats = clipboard.availableFormats() || [];
    const seqPart = seq != null ? String(seq) : formats.join('|');
    if (imageLooksPresent(formats)) {
      return {
        ok: true,
        type: 'image',
        sig: `img:seq:${seqPart}`,
        seq,
        light: true,
        needsContent: true,
      };
    }
    if (textLooksPresent(formats)) {
      // 有变化时才走到这里：读一次正文，提示条直接显示真实预览，避免占位文案闪一下再替换
      const raw = String(clipboard.readText() || '');
      const trimmed = raw.trim();
      if (!trimmed) {
        return { ok: true, type: 'empty', sig: '', seq };
      }
      const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
      const inline = raw.length <= PROBE_TEXT_INLINE_MAX;
      return {
        ok: true,
        type: 'text',
        sig: `txt:seq:${seqPart}`,
        preview,
        text: inline ? raw : '',
        needsContent: !inline,
        seq,
        light: !inline,
      };
    }
    return { ok: true, type: 'empty', sig: '', seq };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/** 防止并发 peek 叠加重读同一张大图 */
let peekBusy = false;

/**
 * 读取剪贴板内容（可能很重，会卡主进程）。
 * 仅允许用户主动操作（悬停预览 / 填入 / 放大）调用，切回前台禁止走这里。
 * opts.quality: 'thumb' | 'full'
 */
function clipboardPeek(opts = {}) {
  if (peekBusy) return { ok: false, error: '剪贴板正忙，请稍候' };
  const withData = !!(opts && opts.withData);
  const quality = opts && opts.quality === 'full' ? 'full' : 'thumb';
  peekBusy = true;
  try {
    const seq = getClipboardSequenceNumber();
    const formats = clipboard.availableFormats() || [];
    if (imageLooksPresent(formats)) {
      // readImage 对大图可阻塞数十秒；调用方必须已避开 resume 热路径
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) {
        const sig = imageSig(img);
        const out = { ok: true, type: 'image', sig, seq };
        if (withData) {
          out.dataUrl = quality === 'full' ? imageFullDataUrl(img) : imageThumbDataUrl(img);
          out.previewOnly = quality !== 'full';
        }
        return out;
      }
    }
    const text = String(clipboard.readText() || '');
    const trimmed = text.trim();
    if (trimmed) {
      const sig = 'txt:' + crypto.createHash('md5').update(trimmed).digest('hex').slice(0, 16);
      const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
      const out = { ok: true, type: 'text', sig, preview, seq };
      if (withData) out.text = text;
      return out;
    }
    return { ok: true, type: 'empty', sig: '', seq };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    peekBusy = false;
  }
}

module.exports = {
  PLUGIN_CATALOG,
  listPlugins,
  getPlugin,
  isEnabled,
  setEnabled,
  install,
  uninstall,
  assertOcrReady,
  clipboardProbe,
  clipboardPeek,
  ocrIndex,
};
