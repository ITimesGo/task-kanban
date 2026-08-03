const crypto = require('crypto');

const MAX_IMAGES = 5;

function createTask({ text = '', images = [] } = {}) {
  if (!String(text || '').trim() && !images.length) {
    const err = new Error('请至少输入文字或添加图片');
    err.code = 'EMPTY_TASK';
    throw err;
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    text: String(text || ''),
    images: images.slice(0, MAX_IMAGES),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

function sortByCreatedAtDesc(tasks) {
  return [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function toggleStatus(tasks, id) {
  return tasks.map((t) =>
    t.id === id
      ? { ...t, status: t.status === 'done' ? 'pending' : 'done', updatedAt: new Date().toISOString() }
      : t
  );
}

function updateTask(tasks, id, { text, images }) {
  return tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          text: text !== undefined ? String(text) : t.text,
          images: images !== undefined ? images.slice(0, MAX_IMAGES) : t.images,
          updatedAt: new Date().toISOString(),
        }
      : t
  );
}

function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

module.exports = { createTask, sortByCreatedAtDesc, toggleStatus, updateTask, removeTask };
