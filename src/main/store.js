const crypto = require('crypto');

const MAX_IMAGES = 10;
const MAX_VIDEOS = 3;
const MAX_ATTACHMENTS = 10;

function createTask({ text = '', images = [], videos = [], attachments = [], media } = {}) {
  const hasMedia = images.length || videos.length || (Array.isArray(media) && media.length);
  if (!String(text || '').trim() && !hasMedia && !attachments.length) {
    const err = new Error('请至少输入文字、图片、视频或附件');
    err.code = 'EMPTY_TASK';
    throw err;
  }
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    text: String(text || ''),
    images: images.slice(0, MAX_IMAGES),
    videos: videos.slice(0, MAX_VIDEOS),
    attachments: attachments.slice(0, MAX_ATTACHMENTS),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    statusAt: null, // 状态处理时间：首次切换完成/取消时才写入
  };
  if (Array.isArray(media)) task.media = media;
  return task;
}

function timeValue(task, field) {
  const v = task && task[field];
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** 按指定时间字段倒序（新→旧）；缺省字段沉底 */
function sortByTimeDesc(tasks, field = 'createdAt') {
  return [...tasks].sort((a, b) => timeValue(b, field) - timeValue(a, field));
}

function sortByCreatedAtDesc(tasks) {
  return sortByTimeDesc(tasks, 'createdAt');
}

function toggleStatus(tasks, id) {
  const now = new Date().toISOString();
  return tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          status: t.status === 'done' ? 'pending' : 'done',
          statusAt: now, // 只更新状态处理时间，不影响编辑更新时间
        }
      : t
  );
}

function updateTask(tasks, id, { text, images, videos, attachments, media }) {
  const now = new Date().toISOString();
  return tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          text: text !== undefined ? String(text) : t.text,
          images: images !== undefined ? images.slice(0, MAX_IMAGES) : t.images,
          videos: videos !== undefined ? videos.slice(0, MAX_VIDEOS) : (t.videos || []),
          attachments: attachments !== undefined ? attachments.slice(0, MAX_ATTACHMENTS) : t.attachments,
          media: media !== undefined ? media : t.media,
          updatedAt: now, // 只更新编辑时间，不影响状态处理时间
        }
      : t
  );
}

function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

module.exports = {
  createTask,
  sortByCreatedAtDesc,
  sortByTimeDesc,
  timeValue,
  toggleStatus,
  updateTask,
  removeTask,
  MAX_IMAGES,
  MAX_VIDEOS,
  MAX_ATTACHMENTS,
};
