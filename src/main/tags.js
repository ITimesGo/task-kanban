const crypto = require('crypto');

const MAX_NAME = 12;

// tags: [{ id, name }]，name 唯一（trim 后非空，限长）
function createTag(tags, name) {
  const n = String(name || '').trim();
  if (!n) { const e = new Error('标签名不能为空'); e.code = 'EMPTY_NAME'; throw e; }
  if (n.length > MAX_NAME) { const e = new Error(`标签名不能超过${MAX_NAME}个字符`); e.code = 'TOO_LONG'; throw e; }
  if (tags.some((t) => t.name === n)) { const e = new Error('标签已存在'); e.code = 'DUP_NAME'; throw e; }
  return [...tags, { id: crypto.randomUUID(), name: n }];
}

function renameTag(tags, id, name) {
  const n = String(name || '').trim();
  if (!n) { const e = new Error('标签名不能为空'); e.code = 'EMPTY_NAME'; throw e; }
  if (n.length > MAX_NAME) { const e = new Error(`标签名不能超过${MAX_NAME}个字符`); e.code = 'TOO_LONG'; throw e; }
  if (!tags.some((t) => t.id === id)) { const e = new Error('标签不存在'); e.code = 'NOT_FOUND'; throw e; }
  if (tags.some((t) => t.id !== id && t.name === n)) { const e = new Error('标签已存在'); e.code = 'DUP_NAME'; throw e; }
  return tags.map((t) => (t.id === id ? { ...t, name: n } : t));
}

function deleteTag(tags, id) {
  return tags.filter((t) => t.id !== id);
}

// 删除 tag 后，从任务的 tags 引用里移除对应 id
function stripDeletedFromTasks(tasks, deletedId) {
  return tasks.map((t) =>
    t.tags && t.tags.includes(deletedId)
      ? { ...t, tags: t.tags.filter((tid) => tid !== deletedId) }
      : t
  );
}

module.exports = { createTag, renameTag, deleteTag, stripDeletedFromTasks };
