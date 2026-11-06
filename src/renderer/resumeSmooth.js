/**
 * 切回前台不再改 document 属性。
 * 以前每次 visibilitychange 都给 html 打 data-resume，再用 * 选择器关掉全部 backdrop-filter，
 * 等于整页样式重算两次，窗口一恢复就卡住。常驻界面已改为实色，这里不再碰 DOM。
 */
(function () {
  const root = document.documentElement;
  if (root.hasAttribute('data-resume')) root.removeAttribute('data-resume');
})();
