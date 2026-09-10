const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app } = require('electron');
const { createWorker, PSM } = require('tesseract.js');

/** 中文截图为主；混入 eng 易把灰字噪声识别成乱码英文 */
const LANGS = ['chi_sim'];
/** best 质量包：体积更大，中文印刷/截图更准；独立缓存目录 */
const LANG_BASE = 'https://tessdata.projectnaptha.com/4.0.0_best';
const TESSDATA_SUBDIR = 'tessdata-best';

let workerPromise = null;

function tessDir() {
  const dir = path.join(app.getPath('userData'), TESSDATA_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function langReady(dir, lang) {
  const p = path.join(dir, `${lang}.traineddata`);
  try {
    // best 包更大；过小视为损坏/旧残留
    return fs.existsSync(p) && fs.statSync(p).size > 8 * 1024 * 1024;
  } catch (_) {
    return false;
  }
}

async function downloadLang(dir, lang, onProgress) {
  const dest = path.join(dir, `${lang}.traineddata`);
  if (langReady(dir, lang)) return;
  try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (_) { /* ignore */ }
  const url = `${LANG_BASE}/${lang}.traineddata.gz`;
  onProgress?.({
    phase: 'download',
    lang,
    status: 'start',
    percent: 0,
    message: `正在下载 ${lang}（高精度）…`,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载语言包失败（${lang}）：HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastEmit = 0;
  const chunks = [];
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        chunks.push(Buffer.from(value));
        received += value.length;
        const now = Date.now();
        if (now - lastEmit >= 80 || (total && received >= total)) {
          lastEmit = now;
          const percent = total
            ? Math.min(95, Math.round((received / total) * 90))
            : Math.min(90, 10 + Math.round(received / (256 * 1024)));
          onProgress?.({
            phase: 'download',
            lang,
            status: 'progress',
            received,
            total,
            percent,
            message: total
              ? `正在下载 ${lang}… ${Math.min(100, Math.round((received / total) * 100))}%`
              : `正在下载 ${lang}… ${(received / (1024 * 1024)).toFixed(1)} MB`,
          });
        }
      }
    }
  } else {
    const ab = await res.arrayBuffer();
    chunks.push(Buffer.from(ab));
    received = ab.byteLength;
  }
  const buf = Buffer.concat(chunks);
  onProgress?.({
    phase: 'download',
    lang,
    status: 'inflate',
    percent: 92,
    message: `正在解压 ${lang}…`,
  });
  const unzipped = zlib.gunzipSync(buf);
  fs.writeFileSync(dest, unzipped);
  onProgress?.({
    phase: 'download',
    lang,
    status: 'done',
    bytes: unzipped.length,
    percent: 100,
    message: `${lang} 已就绪`,
  });
}

async function ensureLangs(onProgress) {
  const dir = tessDir();
  const missing = LANGS.filter((l) => !langReady(dir, l));
  if (missing.length) {
    onProgress?.({
      phase: 'download',
      status: 'need',
      missing,
      percent: 0,
      message: `需下载高精度中文语言包（约 40–70MB），之后可离线识别`,
    });
  }
  for (const lang of LANGS) {
    await downloadLang(dir, lang, onProgress);
  }
  return dir;
}

function resolveNodeModule(...parts) {
  const candidates = [
    path.join(app.getAppPath(), 'node_modules', ...parts),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', ...parts),
    path.join(__dirname, '../../node_modules', ...parts),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, '../../node_modules', ...parts);
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const dir = await ensureLangs(onProgress);
    onProgress?.({ phase: 'init', status: 'start', message: '正在初始化识别引擎…' });
    const worker = await createWorker(LANGS, 1, {
      langPath: dir,
      cachePath: dir,
      gzip: false,
      workerPath: resolveNodeModule('tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
      corePath: resolveNodeModule('tesseract.js-core'),
      logger: (m) => {
        if (m && m.status) onProgress?.({ phase: 'ocr', ...m });
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    onProgress?.({ phase: 'init', status: 'done' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/** 去掉明显乱码行、压缩空行 */
function cleanupOcrText(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    const t = line.replace(/[ \t\u00A0]+/g, ' ').trim();
    if (!t) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (t.length <= 2 && cjk === 0) continue;
    if (cjk === 0 && t.length < 12 && !/\d{3,}/.test(t)) continue;
    kept.push(t);
  }
  while (kept.length && kept[0] === '') kept.shift();
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function scoreOcrText(text) {
  const t = String(text || '');
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const junk = (t.match(/[^\u4e00-\u9fff0-9A-Za-z\s，。！？、：；“”‘’（）【】《》\.\,\!\?\:\;\-\_\/]/g) || []).length;
  return cjk * 3 + t.length - junk * 2;
}

function pickBetterText(a, b) {
  return scoreOcrText(a) >= scoreOcrText(b) ? a : b;
}

/**
 * @param {string} imageDataUrl PNG/JPEG data URL 或本地文件路径
 * @param {(p: object) => void} [onProgress]
 * @param {{ quick?: boolean }} [opts] quick=true 时只跑一种分页模式（批量建索引更快）
 */
async function recognize(imageDataUrl, onProgress, opts = {}) {
  try {
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return { ok: false, error: '无效图片' };
    }
    const worker = await getWorker(onProgress);
    const quick = !!opts.quick;
    onProgress?.({
      phase: 'ocr',
      status: 'recognizing',
      message: quick ? '正在识别文字…' : '正在识别文字（多模式）…',
    });

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const r1 = await worker.recognize(imageDataUrl);
    const t1 = cleanupOcrText(r1?.data?.text || '');
    if (quick) return { ok: true, text: t1 };

    onProgress?.({ phase: 'ocr', status: 'recognizing', message: '正在二次校对…' });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const r2 = await worker.recognize(imageDataUrl);
    const t2 = cleanupOcrText(r2?.data?.text || '');
    return { ok: true, text: pickBetterText(t1, t2) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function langStatus() {
  const dir = tessDir();
  return {
    dir,
    langs: LANGS.map((lang) => ({ lang, ready: langReady(dir, lang) })),
    ready: LANGS.every((l) => langReady(dir, l)),
  };
}

async function terminateWorker() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch (_) { /* ignore */ }
  workerPromise = null;
}

async function uninstall() {
  await terminateWorker();
  const dir = path.join(app.getPath('userData'), TESSDATA_SUBDIR);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    throw new Error(`删除语言包失败：${err.message || err}`);
  }
  for (const legacy of ['tessdata', 'tessdata-v4']) {
    try {
      const p = path.join(app.getPath('userData'), legacy);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

module.exports = {
  recognize,
  langStatus,
  ensureLangs,
  cleanupOcrText,
  uninstall,
  terminateWorker,
  scoreOcrText,
  pickBetterText,
};
