function moveToTrash(tasks, trashList, id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return { tasks, trash: trashList, moved: null };
  const moved = { ...t, trashedAt: new Date().toISOString() };
  return {
    tasks: tasks.filter((x) => x.id !== id),
    trash: [moved, ...trashList],
    moved,
  };
}

function restoreFromTrash(tasks, trashList, id) {
  const t = trashList.find((x) => x.id === id);
  if (!t) return { tasks, trash: trashList, restored: null };
  if (tasks.some((x) => x.id === id)) {
    const err = new Error('恢复失败：已存在同 id 任务（冲突）');
    err.code = 'ID_CONFLICT';
    throw err;
  }
  const { trashedAt, ...rest } = t;
  const restored = { ...rest };
  return {
    tasks: [...tasks, restored],
    trash: trashList.filter((x) => x.id !== id),
    restored,
  };
}

function purgeFromTrash(trashList, id) {
  const purged = trashList.find((x) => x.id === id) || null;
  return {
    trash: trashList.filter((x) => x.id !== id),
    purged,
  };
}

function emptyTrash(trashList) {
  return { trash: [], purged: [...trashList] };
}

module.exports = { moveToTrash, restoreFromTrash, purgeFromTrash, emptyTrash };
