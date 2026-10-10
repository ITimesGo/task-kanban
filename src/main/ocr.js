const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, nativeImage } = require('electron');
const { createWorker, PSM } = require('tesseract.js');

/** 中文为主，附带英文：截图里常见按钮/代码/URL；乱码短英文行仍由 cleanup 过滤 */
const LANGS = ['chi_sim', 'eng'];
/** best 质量包：体积更大，中文印刷/截图更准；独立缓存目录 */
const LANG_BASE = 'https://tessdata.projectnaptha.com/4.0.0_best';
const TESSDATA_SUBDIR = 'tessdata-best';

let workerPromise = null;

function tessDir() {
  const dir = path.join(app.getPath('userData'), TESSDATA_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function langMinBytes(lang) {
  return String(lang).startsWith('chi') ? 8 * 1024 * 1024 : 512 * 1024;
}

function langReady(dir, lang) {
  const p = path.join(dir, `${lang}.traineddata`);
  try {
    return fs.existsSync(p) && fs.statSync(p).size > langMinBytes(lang);
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
      message: `需下载高精度语言包（中文+英文，约 50–80MB），之后可离线识别`,
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
  const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
  const junk = (t.match(/[^\u4e00-\u9fff0-9A-Za-z\s，。！？、：；“”‘’（）【】《》\.\,\!\?\:\;\-\_\/\@\#]/g) || []).length;
  return cjk * 4 + alnum + t.length - junk * 3;
}

function pickBetterText(a, b) {
  return scoreOcrText(a) >= scoreOcrText(b) ? a : b;
}

/** Otsu 阈值（灰度直方图） */
function otsuThreshold(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * 主进程统一预处理：放大 → 灰度 → 分位拉伸 → Otsu/对比度
 * 返回 PNG data URL；失败则返回原始 input
 */
function preprocessForOcr(input) {
  try {
    if (!input || typeof input !== 'string') return input;
    let img = input.startsWith('data:')
      ? nativeImage.createFromDataURL(input)
      : nativeImage.createFromPath(input);
    if (!img || img.isEmpty()) return input;

    let { width, height } = img.getSize();
    if (!width || !height) return input;

    const minSide = Math.min(width, height);
    const scale = Math.min(3.5, Math.max(1, 2200 / minSide));
    if (scale > 1.05) {
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      img = img.resize({ width, height, quality: 'best' });
      ({ width, height } = img.getSize());
    }

    const bitmap = Buffer.from(img.toBitmap());
    const n = width * height;
    if (bitmap.length < n * 4) return input;

    const hist = new Uint32Array(256);
    const gray = new Uint8Array(n);
    let sum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      // Electron toBitmap: BGRA
      const g = Math.round(0.114 * bitmap[p] + 0.587 * bitmap[p + 1] + 0.299 * bitmap[p + 2]);
      gray[i] = g;
      hist[g] += 1;
      sum += g;
    }
    const mean = sum / n;

    const loCount = n * 0.02;
    const hiCount = n * 0.98;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= loCount) { lo = v; break; }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= hiCount) { hi = v; break; }
    }
    if (hi <= lo) { lo = 0; hi = 255; }
    const range = hi - lo || 1;

    const stretched = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) / range) * 255)));
      gray[i] = g;
      stretched[g] += 1;
    }

    const thr = otsuThreshold(stretched, n);
    const binary = mean > 155;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let g = gray[i];
      if (binary) g = g > thr ? 255 : 0;
      else g = Math.max(0, Math.min(255, Math.round((g - 128) * 1.45 + 128)));
      bitmap[p] = bitmap[p + 1] = bitmap[p + 2] = g;
      bitmap[p + 3] = 255;
    }

    const out = nativeImage.createFromBitmap(bitmap, { width, height });
    if (out.isEmpty()) return input;
    return out.toDataURL();
  } catch (_) {
    return input;
  }
}

function invertDataUrl(dataUrl) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return dataUrl;
    const { width, height } = img.getSize();
    const bitmap = Buffer.from(img.toBitmap());
    for (let p = 0; p < bitmap.length; p += 4) {
      bitmap[p] = 255 - bitmap[p];
      bitmap[p + 1] = 255 - bitmap[p + 1];
      bitmap[p + 2] = 255 - bitmap[p + 2];
    }
    const out = nativeImage.createFromBitmap(bitmap, { width, height });
    return out.isEmpty() ? dataUrl : out.toDataURL();
  } catch (_) {
    return dataUrl;
  }
}

async function recognizeOnce(worker, image, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const r = await worker.recognize(image);
  return cleanupOcrText(r?.data?.text || '');
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
      message: quick ? '正在预处理并识别…' : '正在预处理并多模式识别…',
    });

    const prepared = preprocessForOcr(imageDataUrl);
    const modes = quick
      ? [PSM.AUTO]
      : [PSM.AUTO, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT];

    let best = '';
    for (let i = 0; i < modes.length; i++) {
      if (!quick && i > 0) {
        onProgress?.({
          phase: 'ocr',
          status: 'recognizing',
          message: i === 1 ? '正在块级校对…' : '正在稀疏文本校对…',
        });
      }
      const text = await recognizeOnce(worker, prepared, modes[i]);
      best = pickBetterText(best, text);
    }

    if (!quick && scoreOcrText(best) < 40) {
      onProgress?.({ phase: 'ocr', status: 'recognizing', message: '尝试反色识别…' });
      const inv = invertDataUrl(prepared);
      if (inv && inv !== prepared) {
        const text = await recognizeOnce(worker, inv, PSM.AUTO);
        best = pickBetterText(best, text);
      }
    }

    return { ok: true, text: best };
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
  preprocessForOcr,
  otsuThreshold,
};
