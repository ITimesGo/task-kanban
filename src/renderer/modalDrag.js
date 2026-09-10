/** 弹窗：标题栏拖动 + 右下角缩放（带最小/最大范围），关闭后复位 */
(function () {
  const INTERACTIVE = 'button, a, input, textarea, select, label, [contenteditable="true"]';

  /** @type {Record<string, { minW: number, minH: number, maxWRatio: number, maxHRatio: number }>} */
  const SIZE_LIMITS = {
    settingsModal: { minW: 520, minH: 380, maxWRatio: 0.96, maxHRatio: 0.96 },
    detailModal: { minW: 420, minH: 320, maxWRatio: 0.96, maxHRatio: 0.96 },
    tagModal: { minW: 360, minH: 280, maxWRatio: 0.92, maxHRatio: 0.92 },
    default: { minW: 360, minH: 260, maxWRatio: 0.95, maxHRatio: 0.95 },
  };

  function clamp(n, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, n));
  }

  function limitsFor(modal) {
    return SIZE_LIMITS[modal.id] || SIZE_LIMITS.default;
  }

  function resetModalChrome(modal) {
    if (!modal) return;
    modal.style.position = '';
    modal.style.left = '';
    modal.style.top = '';
    modal.style.right = '';
    modal.style.bottom = '';
    modal.style.margin = '';
    modal.style.width = '';
    modal.style.height = '';
    modal.style.maxWidth = '';
    modal.style.maxHeight = '';
    modal.classList.remove('is-dragging', 'is-resizing', 'is-dragged');
  }

  function pinToAbsolute(modal, overlay) {
    if (modal.classList.contains('is-dragged')) return;
    const overlayRect = overlay.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    modal.style.position = 'absolute';
    modal.style.margin = '0';
    modal.style.left = `${modalRect.left - overlayRect.left + overlay.scrollLeft}px`;
    modal.style.top = `${modalRect.top - overlayRect.top + overlay.scrollTop}px`;
    modal.style.width = `${modalRect.width}px`;
    modal.style.height = `${modalRect.height}px`;
    modal.style.maxWidth = 'none';
    modal.style.maxHeight = 'none';
    modal.classList.add('is-dragged');
  }

  /** 窗口/遮罩变小时，把已拖动的弹窗拉回可视区并压缩尺寸 */
  function fitModalInOverlay(modal) {
    const overlay = modal && modal.closest('.overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (!modal.classList.contains('is-dragged')) return;

    const availW = overlay.clientWidth;
    const availH = overlay.clientHeight;
    if (availW < 8 || availH < 8) return;

    const lim = limitsFor(modal);
    const maxW = Math.min(Math.floor(availW * lim.maxWRatio), availW);
    const maxH = Math.min(Math.floor(availH * lim.maxHRatio), availH);
    const minW = Math.min(lim.minW, maxW);
    const minH = Math.min(lim.minH, maxH);

    let left = parseFloat(modal.style.left);
    let top = parseFloat(modal.style.top);
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(top)) top = 0;

    let w = modal.offsetWidth;
    let h = modal.offsetHeight;
    w = clamp(w, minW, maxW);
    h = clamp(h, minH, maxH);
    w = Math.min(w, availW);
    h = Math.min(h, availH);

    left = clamp(left, 0, Math.max(0, availW - w));
    top = clamp(top, 0, Math.max(0, availH - h));

    modal.style.width = `${Math.round(w)}px`;
    modal.style.height = `${Math.round(h)}px`;
    modal.style.left = `${Math.round(left)}px`;
    modal.style.top = `${Math.round(top)}px`;
  }

  function fitAllVisibleModals() {
    document.querySelectorAll('.overlay:not(.hidden) > .modal.is-dragged').forEach(fitModalInOverlay);
  }

  function enableModalDrag(modal) {
    if (!modal || modal.dataset.dragBound === '1') return;
    const overlay = modal.closest('.overlay');
    if (!overlay) return;
    const handle = modal.querySelector('.modal-header')
      || modal.querySelector('.confirm-title')
      || modal.querySelector('h2');
    if (!handle) return;

    modal.dataset.dragBound = '1';
    handle.classList.add('modal-drag-handle');

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(INTERACTIVE)) return;
      if (e.target.closest('.modal-resize')) return;
      pinToAbsolute(modal, overlay);
      dragging = true;
      modal.classList.add('is-dragging');
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseFloat(modal.style.left) || 0;
      origTop = parseFloat(modal.style.top) || 0;
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, overlay.clientWidth - modal.offsetWidth);
      const maxTop = Math.max(0, overlay.clientHeight - modal.offsetHeight);
      modal.style.left = `${clamp(origLeft + (e.clientX - startX), 0, maxLeft)}px`;
      modal.style.top = `${clamp(origTop + (e.clientY - startY), 0, maxTop)}px`;
    };

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      modal.classList.remove('is-dragging');
      if (e && e.pointerId != null) {
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', endDrag);

    const mo = new MutationObserver(() => {
      if (overlay.classList.contains('hidden')) resetModalChrome(modal);
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  function enableModalResize(modal) {
    if (!modal || modal.dataset.resizeBound === '1') return;
    if (modal.classList.contains('confirm-modal')) return;
    const overlay = modal.closest('.overlay');
    if (!overlay) return;

    modal.dataset.resizeBound = '1';
    modal.classList.add('is-resizable');

    let grip = modal.querySelector('.modal-resize');
    if (!grip) {
      grip = document.createElement('div');
      grip.className = 'modal-resize';
      grip.title = '拖动调整大小';
      grip.setAttribute('aria-hidden', 'true');
      modal.appendChild(grip);
    }

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let origW = 0;
    let origH = 0;
    let origLeft = 0;
    let origTop = 0;

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      pinToAbsolute(modal, overlay);
      resizing = true;
      modal.classList.add('is-resizing');
      startX = e.clientX;
      startY = e.clientY;
      origW = modal.offsetWidth;
      origH = modal.offsetHeight;
      origLeft = parseFloat(modal.style.left) || 0;
      origTop = parseFloat(modal.style.top) || 0;
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMove = (e) => {
      if (!resizing) return;
      const lim = limitsFor(modal);
      const maxW = Math.min(
        Math.floor(overlay.clientWidth * lim.maxWRatio),
        Math.max(lim.minW, overlay.clientWidth - origLeft)
      );
      const maxH = Math.min(
        Math.floor(overlay.clientHeight * lim.maxHRatio),
        Math.max(lim.minH, overlay.clientHeight - origTop)
      );
      const nextW = clamp(origW + (e.clientX - startX), lim.minW, maxW);
      const nextH = clamp(origH + (e.clientY - startY), lim.minH, maxH);
      modal.style.width = `${nextW}px`;
      modal.style.height = `${nextH}px`;
    };

    const endResize = (e) => {
      if (!resizing) return;
      resizing = false;
      modal.classList.remove('is-resizing');
      if (e && e.pointerId != null) {
        try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
    };

    grip.addEventListener('pointerdown', onPointerDown);
    grip.addEventListener('pointermove', onPointerMove);
    grip.addEventListener('pointerup', endResize);
    grip.addEventListener('pointercancel', endResize);
    grip.addEventListener('lostpointercapture', endResize);
  }

  function initModalChrome() {
    document.querySelectorAll('.overlay > .modal').forEach((modal) => {
      enableModalDrag(modal);
      enableModalResize(modal);
    });

    let resizeRaf = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(fitAllVisibleModals);
    };
    window.addEventListener('resize', scheduleFit);

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(scheduleFit);
      document.querySelectorAll('.overlay').forEach((el) => ro.observe(el));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalChrome);
  } else {
    initModalChrome();
  }

  window.enableModalDrag = enableModalDrag;
  window.enableModalResize = enableModalResize;
  window.resetModalPosition = resetModalChrome;
  window.resetModalChrome = resetModalChrome;
  window.fitModalInOverlay = fitModalInOverlay;
})();
