// 应用入口：模块串联与启动
initTheme();
initAlwaysOnTop();
if (typeof applySavedViewDefaults === 'function') {
  applySavedViewDefaults({ refreshList: false });
}
loadTags();
refresh();
