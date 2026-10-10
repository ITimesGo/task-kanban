// 应用入口：模块串联与启动
initTheme();
initAlwaysOnTop();
if (typeof applySavedViewDefaults === 'function') {
  applySavedViewDefaults({ refreshList: false, coldStart: true });
}
loadTags();
refresh();
if (typeof window.silentCheckUpdate === 'function') {
  // 再晚一点，避免和首屏/剪贴板抢主进程与网络
  setTimeout(() => { window.silentCheckUpdate(); }, 5000);
}
