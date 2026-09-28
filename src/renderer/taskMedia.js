/** 任务媒体混排：展示顺序、拖动重排、创建/更新入参规范化 */

const MAX_IMAGES = 10;
const MAX_VIDEOS = 3;
const THUMB_DND_TYPE = 'application/x-kanban-thumb';

function capMediaItems(items, { maxImages = MAX_IMAGES, maxVideos = MAX_VIDEOS } = {}) {
  const out = [];
  let ni = 0;
  let nv = 0;
  for (const m of items || []) {
    const video = m && m.kind === 'video';
    if (video) {
      if (nv >= maxVideos) continue;
      nv += 1;
    } else {
      if (ni >= maxImages) continue;
      ni += 1;
    }
    out.push(m);
  }
  return out;
}

function taskMediaItems(task) {
  // media 为混排真源；若为空却仍有 images/videos，视为不一致并回退（避免编辑保存清空图片）
  if (task && Array.isArray(task.media) && task.media.length) {
    return task.media.map((m) => ({
      kind: m && m.kind === 'video' ? 'video' : 'image',
      value: m && m.rel != null ? m.rel : (m && m.value),
    })).filter((m) => m.value != null && m.value !== '');
  }
  const imgs = ((task && task.images) || []).map((rel) => ({ kind: 'image', value: rel }));
  const vids = ((task && task.videos) || []).map((rel) => ({ kind: 'video', value: rel }));
  return imgs.concat(vids);
}

/** 任务是否含图片 / 视频 / 附件（供列表媒体筛选） */
function taskMediaFlags(task) {
  const flags = { image: false, video: false, attachment: false };
  if (!task) return flags;
  const atts = task.attachments;
  if (Array.isArray(atts) && atts.length) flags.attachment = true;
  for (const m of taskMediaItems(task)) {
    if (m && m.kind === 'video') flags.video = true;
    else if (m) flags.image = true;
  }
  if ((!flags.image || !flags.video) && typeof resolveTaskDoc === 'function' && typeof countMediaInDoc === 'function') {
    try {
      const c = countMediaInDoc(resolveTaskDoc(task));
      if (c.images) flags.image = true;
      if (c.videos) flags.video = true;
    } catch (_) { /* ignore */ }
  }
  return flags;
}

/** selected: 'image'|'video'|'attachment'[]；空数组=不限；OR 匹配 */
function taskMatchesMediaFilter(task, selected) {
  if (!selected || !selected.length) return true;
  const flags = taskMediaFlags(task);
  return selected.some((k) => !!flags[k]);
}

/** 把展示用 URL / 入参统一成可写盘的 value（rel | dataUrl | {srcPath}） */
function coerceMediaValue(value) {
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('taskimage://local/')) return s.slice('taskimage://local/'.length);
    return s;
  }
  return value;
}

function normalizeMediaPayload({ media, images, videos } = {}) {
  if (Array.isArray(media)) {
    return capMediaItems(media.map((m) => ({
      kind: m && m.kind === 'video' ? 'video' : 'image',
      value: coerceMediaValue(m && m.value != null ? m.value : (m && m.rel)),
    })));
  }
  const out = [];
  for (const v of images || []) out.push({ kind: 'image', value: coerceMediaValue(v) });
  for (const v of videos || []) out.push({ kind: 'video', value: coerceMediaValue(v) });
  return capMediaItems(out);
}

function moveMediaItem(arr, from, to) {
  if (!Array.isArray(arr)) return arr;
  const n = arr.length;
  const f = Number(from);
  const t = Number(to);
  if (!Number.isInteger(f) || !Number.isInteger(t) || f === t || f < 0 || t < 0 || f >= n || t >= n) {
    return arr.slice();
  }
  const next = arr.slice();
  const [item] = next.splice(f, 1);
  next.splice(t, 0, item);
  return next;
}

function splitMediaRels(items) {
  const images = [];
  const videos = [];
  const media = [];
  for (const m of items || []) {
    const kind = m && m.kind === 'video' ? 'video' : 'image';
    const rel = m && m.rel != null ? m.rel : (m && m.value);
    if (kind === 'video') videos.push(rel);
    else images.push(rel);
    media.push({ kind, rel });
  }
  return { images, videos, media };
}

function isThumbReorderEvent(e) {
  if (typeof window !== 'undefined' && window.__kanbanThumbDrag) return true;
  const types = Array.from((e && e.dataTransfer && e.dataTransfer.types) || []);
  return types.includes(THUMB_DND_TYPE);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    taskMediaItems,
    taskMediaFlags,
    taskMatchesMediaFilter,
    normalizeMediaPayload,
    moveMediaItem,
    capMediaItems,
    splitMediaRels,
    isThumbReorderEvent,
    coerceMediaValue,
    THUMB_DND_TYPE,
    MAX_IMAGES,
    MAX_VIDEOS,
  };
}
