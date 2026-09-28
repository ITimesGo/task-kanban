const crypto = require('crypto');

const MAX_NAME = 15;

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

// tags: [{ id, name }]，name 唯一（trim 后非空，限长；大小写不敏感）
function createTag(tags, name) {
  const n = String(name || '').trim();
  if (!n) { const e = new Error('标签名不能为空'); e.code = 'EMPTY_NAME'; throw e; }
  if (n.length > MAX_NAME) { const e = new Error(`标签名不能超过${MAX_NAME}个字符`); e.code = 'TOO_LONG'; throw e; }
  const key = nameKey(n);
  if (tags.some((t) => nameKey(t.name) === key)) { const e = new Error('标签已存在'); e.code = 'DUP_NAME'; throw e; }
  return [...tags, { id: crypto.randomUUID(), name: n }];
}

function renameTag(tags, id, name) {
  const n = String(name || '').trim();
  if (!n) { const e = new Error('标签名不能为空'); e.code = 'EMPTY_NAME'; throw e; }
  if (n.length > MAX_NAME) { const e = new Error(`标签名不能超过${MAX_NAME}个字符`); e.code = 'TOO_LONG'; throw e; }
  if (!tags.some((t) => t.id === id)) { const e = new Error('标签不存在'); e.code = 'NOT_FOUND'; throw e; }
  const key = nameKey(n);
  if (tags.some((t) => t.id !== id && nameKey(t.name) === key)) {
    const e = new Error('标签已存在');
    e.code = 'DUP_NAME';
    throw e;
  }
  return tags.map((t) => (t.id === id ? { ...t, name: n } : t));
}

function deleteTag(tags, id) {
  return tags.filter((t) => t.id !== id);
}

/** 统计任务中引用该标签的数量（不含回收站） */
function countTagUsage(tasks, id) {
  if (id == null || id === '') return 0;
  const sid = String(id);
  return (Array.isArray(tasks) ? tasks : []).reduce(
    (n, t) => n + ((t.tags || []).map(String).includes(sid) ? 1 : 0),
    0
  );
}

/** 调整全局标签顺序：用移除前的 toIdx（对齐 moveMediaItem） */
function reorderTags(tags, fromId, toId) {
  const list = Array.isArray(tags) ? tags.slice() : [];
  if (fromId === toId) return list;
  const fromIdx = list.findIndex((t) => t.id === fromId);
  const toIdx = list.findIndex((t) => t.id === toId);
  if (fromIdx < 0 || toIdx < 0) {
    const e = new Error('标签不存在');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, item);
  return list;
}

// 删除 tag 后，从任务的 tags 引用里移除对应 id
function stripDeletedFromTasks(tasks, deletedId) {
  return tasks.map((t) =>
    t.tags && t.tags.includes(deletedId)
      ? { ...t, tags: t.tags.filter((tid) => tid !== deletedId) }
      : t
  );
}

module.exports = { createTag, renameTag, deleteTag, countTagUsage, reorderTags, stripDeletedFromTasks, MAX_NAME };
