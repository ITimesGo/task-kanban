const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const ocr = require('./ocr');

function indexPath() {
  return path.join(app.getPath('userData'), 'ocr-index.json');
}

function readIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_) {
    return {};
  }
}

function writeIndex(map) {
  const file = indexPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf8');
}

function normalizeRel(rel) {
  return String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
}

function imageRelFromTaskImage(img) {
  if (typeof img === 'string') return normalizeRel(img);
  if (img && typeof img === 'object') return normalizeRel(img.rel || '');
  return '';
}

/** 收集任务里全部图片 rel（去重） */
function collectImageRels(tasks) {
  const set = new Set();
  for (const t of tasks || []) {
    for (const img of (t && t.images) || []) {
      const rel = imageRelFromTaskImage(img);
      if (rel && (rel.startsWith('images/') || rel.includes('/'))) set.add(rel);
      else if (rel) set.add(rel);
    }
  }
  return [...set];
}

/** @returns {Record<string, string>} rel -> text */
function getAllTexts() {
  const map = readIndex();
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'string') out[k] = v;
    else if (v && typeof v.text === 'string') out[k] = v.text;
  }
  return out;
}

function setText(rel, text) {
  const key = normalizeRel(rel);
  if (!key) return { ok: false, error: '无效图片路径' };
  const map = readIndex();
  const t = String(text || '').trim();
  if (!t) {
    delete map[key];
  } else {
    map[key] = { text: t, updatedAt: Date.now() };
  }
  writeIndex(map);
  return { ok: true };
}

/** 写入索引（允许空串，表示已识别但无文字，避免后台反复重试） */
function upsertText(rel, text) {
  const key = normalizeRel(rel);
  if (!key) return { ok: false, error: '无效图片路径' };
  const map = readIndex();
  map[key] = { text: String(text || '').trim(), updatedAt: Date.now() };
  writeIndex(map);
  return { ok: true };
}

function hasEntry(rel) {
  const key = normalizeRel(rel);
  if (!key) return false;
  const map = readIndex();
  return Object.prototype.hasOwnProperty.call(map, key);
}

function remove(rel) {
  const key = normalizeRel(rel);
  const map = readIndex();
  if (key && map[key]) {
    delete map[key];
    writeIndex(map);
  }
  return { ok: true };
}

function clear() {
  writeIndex({});
  return { ok: true };
}

function stats(tasks, storageRoot) {
  const rels = collectImageRels(tasks);
  const map = readIndex();
  let indexed = 0;
  let missingFile = 0;
  let pending = 0;
  for (const rel of rels) {
    const abs = path.join(storageRoot, rel);
    if (!fs.existsSync(abs)) {
      missingFile += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(map, rel)) indexed += 1;
    else pending += 1;
  }
  return {
    total: rels.length,
    indexed,
    pending,
    missingFile,
  };
}

let building = false;
let buildCancel = false;
/** 新建/编辑后的后台索引队列（避免与批量 build 冲突时丢任务） */
let scheduleQueue = [];
let scheduleRunning = false;
const scheduleDoneCallbacks = new Set();

function isBuilding() {
  return building;
}

function cancelBuild() {
  buildCancel = true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 批量识别未入库图片并写入索引（无需在预览里一张张点）
 * @param {{ storageRoot: string, tasks: any[], force?: boolean, onProgress?: Function }} opts
 */
async function buildIndex(opts) {
  if (building) return { ok: false, error: '正在建立索引，请稍候' };
  const storageRoot = opts && opts.storageRoot;
  const tasks = (opts && opts.tasks) || [];
  const force = !!(opts && opts.force);
  const onProgress = opts && opts.onProgress;
  if (!storageRoot) return { ok: false, error: '存储路径无效' };

  building = true;
  buildCancel = false;
  try {
    const rels = collectImageRels(tasks);
    const queue = rels.filter((rel) => {
      const abs = path.join(storageRoot, rel);
      if (!fs.existsSync(abs)) return false;
      if (force) return true;
      return !hasEntry(rel);
    });

    onProgress?.({
      phase: 'index',
      status: 'start',
      current: 0,
      total: queue.length,
      percent: 0,
      message: queue.length ? `准备识别 ${queue.length} 张图片…` : '没有需要索引的图片',
    });

    let done = 0;
    let okCount = 0;
    let failCount = 0;
    for (const rel of queue) {
      if (buildCancel) {
        onProgress?.({
          phase: 'index',
          status: 'cancelled',
          current: done,
          total: queue.length,
          percent: queue.length ? Math.round((done / queue.length) * 100) : 100,
          message: '已取消',
        });
        return { ok: true, cancelled: true, done, total: queue.length, okCount, failCount };
      }
      const abs = path.join(storageRoot, rel);
      onProgress?.({
        phase: 'index',
        status: 'progress',
        current: done,
        total: queue.length,
        rel,
        percent: queue.length ? Math.round((done / queue.length) * 100) : 100,
        message: `正在识别 ${done + 1}/${queue.length}`,
      });
      try {
        const res = await ocr.recognize(abs, null, { quick: true });
        if (res && res.ok) {
          upsertText(rel, res.text || '');
          okCount += 1;
        } else {
          failCount += 1;
        }
      } catch (_) {
        failCount += 1;
      }
      done += 1;
    }

    onProgress?.({
      phase: 'index',
      status: 'done',
      current: done,
      total: queue.length,
      percent: 100,
      message: queue.length
        ? `索引完成：成功 ${okCount}，失败 ${failCount}`
        : '索引已是最新',
    });
    return { ok: true, done, total: queue.length, okCount, failCount };
  } finally {
    building = false;
    buildCancel = false;
  }
}

async function drainScheduleQueue() {
  if (scheduleRunning) return;
  scheduleRunning = true;
  let changed = 0;
  try {
    const snapshot = [...scheduleQueue];
    scheduleQueue.length = 0;

    // 按任务归组：每张卡片各自进度
    /** @type {Map<string, { root: string, rels: string[] }>} */
    const byTask = new Map();
    for (const item of snapshot) {
      if (!item.rel || !item.root) continue;
      if (hasEntry(item.rel)) continue;
      const abs = path.join(item.root, item.rel);
      if (!fs.existsSync(abs)) continue;
      const tid = String(item.taskId || '');
      if (!byTask.has(tid)) byTask.set(tid, { root: item.root, rels: [] });
      const g = byTask.get(tid);
      if (!g.rels.includes(item.rel)) g.rels.push(item.rel);
    }

    for (const [taskId, group] of byTask) {
      const total = group.rels.length;
      if (!total) continue;
      emitScheduleProgress({
        phase: 'auto',
        status: 'start',
        taskId: taskId || null,
        current: 0,
        total,
        percent: 0,
        message: `识别图内文字 0/${total}`,
      });
    }

    for (const [taskId, group] of byTask) {
      const total = group.rels.length;
      if (!total) continue;

      let current = 0;
      for (const rel of group.rels) {
        while (building) await sleep(400);
        if (hasEntry(rel)) {
          current += 1;
        } else {
          const abs = path.join(group.root, rel);
          if (fs.existsSync(abs)) {
            try {
              const res = await ocr.recognize(abs, null, { quick: true });
              if (res && res.ok) {
                upsertText(rel, res.text || '');
                if (String(res.text || '').trim()) changed += 1;
              }
            } catch (_) { /* ignore */ }
          }
          current += 1;
        }
        emitScheduleProgress({
          phase: 'auto',
          status: 'progress',
          taskId: taskId || null,
          current,
          total,
          percent: Math.round((current / total) * 100),
          message: `识别图内文字 ${current}/${total}`,
        });
      }

      emitScheduleProgress({
        phase: 'auto',
        status: 'done',
        taskId: taskId || null,
        current: total,
        total,
        percent: 100,
        message: '图内文字识别完成',
        changed,
      });
    }
  } finally {
    scheduleRunning = false;
    if (scheduleQueue.length) {
      drainScheduleQueue();
      return;
    }
    const cbs = [...scheduleDoneCallbacks];
    scheduleDoneCallbacks.clear();
    for (const cb of cbs) {
      try { cb({ changed }); } catch (_) { /* ignore */ }
    }
  }
}

let scheduleProgressHandler = null;
function setScheduleProgressHandler(cb) {
  scheduleProgressHandler = typeof cb === 'function' ? cb : null;
}
function emitScheduleProgress(p) {
  try { scheduleProgressHandler?.(p); } catch (_) { /* ignore */ }
}

/** 后台补索引（不阻塞）；用于新建/更新任务后自动识别图内文字 */
function scheduleIndexRels(storageRoot, rels, opts = {}) {
  const list = [...new Set((rels || []).map(normalizeRel).filter(Boolean))];
  if (!list.length || !storageRoot) return;
  const taskId = opts.taskId != null ? String(opts.taskId) : '';
  for (const rel of list) scheduleQueue.push({ root: storageRoot, rel, taskId });
  if (typeof opts.onDone === 'function') scheduleDoneCallbacks.add(opts.onDone);
  setImmediate(() => { drainScheduleQueue(); });
}

module.exports = {
  getAllTexts,
  setText,
  upsertText,
  hasEntry,
  remove,
  clear,
  normalizeRel,
  collectImageRels,
  stats,
  buildIndex,
  cancelBuild,
  isBuilding,
  scheduleIndexRels,
  setScheduleProgressHandler,
};
