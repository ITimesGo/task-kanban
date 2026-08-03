// 薄封装，renderer 不直接依赖 window.taskAPI 细节
window.API = {};
for (const k of ['getAllTasks','createTask','toggleStatus','updateTask','deleteTask','pickImages','pasteImage','readImage','imageUrl']) {
  window.API[k] = (...a) => window.taskAPI[k](...a);
}
