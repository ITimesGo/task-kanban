/**
 * 切回前台时的合成层「轻载门」：
 * Windows + Electron 在窗口从后台恢复时，会重算所有 backdrop-filter，
 * 常驻毛玻璃（创建区/分页等）叠加卡片图解码，容易卡几百毫秒～数秒。
 * 策略：隐藏期间与恢复后首几帧关掉 blur，先让交互起来，再恢复观感。
 */
(function () {
  const ROOT = document.documentElement;
  const ATTR = 'data-resume';
  const IDLE = 'idle';
  const SETTLING = 'settling';

  let settleTimer = 0;
  let settleRaf = 0;

  function clearSettle() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = 0;
    }
    if (settleRaf) {
      cancelAnimationFrame(settleRaf);
      settleRaf = 0;
    }
  }

  function setMode(mode) {
    if (mode) ROOT.setAttribute(ATTR, mode);
    else ROOT.removeAttribute(ATTR);
  }

  function enterIdle() {
    clearSettle();
    setMode(IDLE);
  }

  /** 先 idle 一帧，再 settling，约 280ms 后恢复毛玻璃 */
  function beginSettle() {
    clearSettle();
    setMode(IDLE);
    settleRaf = requestAnimationFrame(() => {
      settleRaf = requestAnimationFrame(() => {
        settleRaf = 0;
        setMode(SETTLING);
        settleTimer = window.setTimeout(() => {
          settleTimer = 0;
          setMode('');
        }, 280);
      });
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) enterIdle();
    else beginSettle();
  });

  window.addEventListener('focus', () => {
    if (document.hidden) return;
    // 仅最小化恢复等未触发 visibilitychange 时补一次
    if (ROOT.getAttribute(ATTR) === IDLE) beginSettle();
  });

  // 启动：等首屏后再允许毛玻璃（避免冷启动也卡一下）
  setMode(IDLE);
  if (document.readyState === 'complete') {
    beginSettle();
  } else {
    window.addEventListener('load', beginSettle, { once: true });
  }
})();
