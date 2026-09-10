const THEME_PRESETS = {
  blue:   { label: '元素蓝', primary: '#409eff' },
  system: { label: '系统蓝', primary: '#007aff' },
  green:  { label: '翠绿',   primary: '#2f9e44' },
  orange: { label: '暖橙',   primary: '#ea580c' },
  violet: { label: '紫罗兰', primary: '#7c3aed' },
  slate:  { label: '石墨',   primary: '#475569' },
};

/** 旧版多预设迁移：仅用于启动读取 */
const LEGACY_THEME_PRIMARY = {
  blue: '#409eff', sky: '#0ea5e9', cyan: '#0891b2', teal: '#0d9488',
  green: '#2f9e44', lime: '#65a30d', amber: '#d97706', orange: '#ea580c',
  coral: '#f43f5e', rose: '#e64980', violet: '#7c3aed', indigo: '#4f46e5',
  slate: '#475569',
};

const SKIN_PREVIEW = {
  day: { '--sp1': '#f5f7fa', '--sp2': '#ffffff', '--sp3': '#409eff' },
  apple: { '--sp1': '#f2f2f7', '--sp2': '#ffffff', '--sp3': '#007aff' },
  mario: { '--sp1': '#5c94fc', '--sp2': '#e52521', '--sp3': '#fbd000' },
  night: { '--sp1': '#0f1419', '--sp2': '#151b28', '--sp3': '#66b1ff' },
  eyecare: { '--sp1': '#c7edcc', '--sp2': '#ddf3e0', '--sp3': '#3d8b4f' },
};

function currentSkinKey() {
  let key = localStorage.getItem('kanban-skin') || 'day';
  if (key === 'genshin') key = 'apple'; // 原神皮肤已替换为苹果
  return SKINS[key] ? key : 'day';
}

function currentSkin() {
  return getSkin(currentSkinKey());
}

function themeOptsForSkin(skin) {
  return {
    ...(skin.themeMix || {}),
    against: skin.contrastAgainst || '#ffffff',
  };
}

function findPresetKeyByPrimary(hex) {
  const h = parseHexColor(hex);
  if (!h) return null;
  return Object.keys(THEME_PRESETS).find((k) => THEME_PRESETS[k].primary.toLowerCase() === h) || null;
}

function applyThemeVars(theme) {
  const root = document.documentElement;
  root.style.setProperty('--primary', theme.primary);
  root.style.setProperty('--primary-hover', theme.hover);
  root.style.setProperty('--primary-active', theme.active);
  root.style.setProperty('--primary-soft', theme.soft);
  root.style.setProperty('--ring', theme.ring);
  root.style.setProperty('--rgb', theme.rgb);
}

function clearInlinePrimaryVars() {
  const root = document.documentElement;
  ['--primary', '--primary-hover', '--primary-active', '--primary-soft', '--ring', '--rgb'].forEach((k) => {
    root.style.removeProperty(k);
  });
}

function syncTitleBarOverlay(skin) {
  const tb = skin.titlebar || { color: '#ffffff', symbolColor: '#303133' };
  if (API.setTitleBarOverlay) API.setTitleBarOverlay(tb);
}

function applySkinVars(skin) {
  const root = document.documentElement;
  // 先清空上一套皮肤写入的全部变量，再应用新皮肤（避免阴影/圆角残留）
  SKIN_VAR_KEYS.forEach((k) => root.style.removeProperty(k));
  Object.entries(skin.vars || {}).forEach(([k, v]) => root.style.setProperty(k, v));
}

function applySkin(key, { persist = true } = {}) {
  const skinKey = SKINS[key] ? key : 'day';
  const skin = getSkin(skinKey);
  document.body.classList.remove('is-mario-skin');
  document.documentElement.setAttribute('data-skin', skinKey);
  applySkinVars(skin);
  if (persist) localStorage.setItem('kanban-skin', skinKey);
  syncTitleBarOverlay(skin);
  syncThemeColorSectionLock();
  applySavedOrFixedPrimary();
  document.querySelectorAll('.skin-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.key === skinKey);
  });
}

function syncThemeColorSectionLock() {
  const skin = currentSkin();
  const section = document.getElementById('themeColorSection');
  const custom = document.getElementById('themeCustomWrap');
  const canCustom = !!skin.customPrimary;
  if (section) {
    section.hidden = !canCustom;
    section.classList.remove('is-locked');
  }
  if (custom) custom.classList.remove('is-locked');
  if (canCustom) {
    const hint = document.getElementById('themeColorHint');
    if (hint) hint.textContent = '支持 #RGB / #RRGGBB；过浅或无效时预览为黑色且不会应用';
  }
}

function syncThemeControls(hex, { invalid = false } = {}) {
  const skin = currentSkin();
  const against = skin.contrastAgainst || '#ffffff';
  const picker = document.getElementById('themeColorPicker');
  const input = document.getElementById('themeColorInput');
  const preview = document.getElementById('themeColorPreview');
  const valid = parseHexColor(hex);
  const usable = !!(valid && isUsableThemeColor(valid, { against }));
  const show = previewColor(hex || '', { against });
  if (picker && valid) picker.value = valid;
  if (input && document.activeElement !== input) {
    input.value = valid || String(hex || '');
  }
  if (input) input.classList.toggle('is-invalid', !!invalid || !usable);
  if (preview) preview.style.background = show;
  const presetKey = findPresetKeyByPrimary(valid);
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const on = skin.customPrimary && !!presetKey && btn.dataset.key === presetKey && usable;
    btn.classList.toggle('active', on);
    const check = btn.querySelector('.theme-check');
    if (check) check.textContent = on ? '✓' : '';
  });
}

function commitThemeColor(hex, { persist = true } = {}) {
  const skin = currentSkin();
  if (!skin.customPrimary) return false;
  const theme = themeFromPrimary(hex, themeOptsForSkin(skin));
  if (!theme) return false;
  applyThemeVars(theme);
  if (persist) {
    const presetKey = findPresetKeyByPrimary(theme.primary);
    localStorage.setItem('kanban-theme', presetKey || 'custom');
    localStorage.setItem('kanban-theme-color', theme.primary);
  }
  syncThemeControls(theme.primary);
  return true;
}

function applyThemePreset(key) {
  if (!currentSkin().customPrimary) return;
  const preset = THEME_PRESETS[key] || THEME_PRESETS.blue;
  commitThemeColor(preset.primary, { persist: true });
}

function resolveSavedPrimaryHex() {
  const savedKey = localStorage.getItem('kanban-theme') || 'blue';
  const savedColor = localStorage.getItem('kanban-theme-color');
  let hex = parseHexColor(savedColor);
  if (!hex && savedKey === 'custom') hex = null;
  if (!hex && THEME_PRESETS[savedKey]) hex = THEME_PRESETS[savedKey].primary;
  if (!hex && LEGACY_THEME_PRIMARY[savedKey]) hex = LEGACY_THEME_PRIMARY[savedKey];
  if (!hex) hex = THEME_PRESETS.blue.primary;
  return hex;
}

function applySavedOrFixedPrimary() {
  const skin = currentSkin();
  if (!skin.customPrimary && skin.fixedPrimary) {
    clearInlinePrimaryVars();
    applySkinVars(skin);
    const theme = themeFromPrimary(skin.fixedPrimary, themeOptsForSkin(skin));
    if (theme) applyThemeVars(theme);
    syncThemeControls(skin.fixedPrimary);
    return;
  }
  const hex = resolveSavedPrimaryHex();
  if (!commitThemeColor(hex, { persist: true })) {
    commitThemeColor(THEME_PRESETS.blue.primary, { persist: true });
  }
}

function syncSkinScrollNav() {
  const box = document.getElementById('skinOptions');
  const wrap = document.getElementById('skinOptionsWrap');
  const prev = document.getElementById('skinScrollPrev');
  const next = document.getElementById('skinScrollNext');
  if (!box) return;
  // 面板 display:none 时尺寸为 0，勿据此隐藏按钮
  if (box.clientWidth < 8) return;
  const max = Math.max(0, box.scrollWidth - box.clientWidth);
  const canScroll = max > 4;
  const atStart = !canScroll || box.scrollLeft <= 2;
  const atEnd = !canScroll || box.scrollLeft >= max - 2;
  if (wrap) {
    wrap.classList.toggle('can-scroll', canScroll);
    wrap.classList.toggle('can-scroll-left', canScroll && !atStart);
    wrap.classList.toggle('can-scroll-right', canScroll && !atEnd);
  }
  // 有溢出时左右按钮始终保留；到头只变灰，不移除（避免点穿选中皮肤）
  // 不用 native disabled：部分环境下点击会穿透到下方卡片
  [prev, next].forEach((btn, i) => {
    if (!btn) return;
    const edge = i === 0 ? atStart : atEnd;
    btn.hidden = !canScroll;
    btn.classList.toggle('is-disabled', canScroll && edge);
    btn.setAttribute('aria-disabled', canScroll && edge ? 'true' : 'false');
  });
}

function scrollSkinOptions(dir) {
  const box = document.getElementById('skinOptions');
  if (!box) return;
  const card = box.querySelector('.skin-option');
  const step = card ? (card.offsetWidth + 8) * 2 : 208;
  const max = Math.max(0, box.scrollWidth - box.clientWidth);
  const target = Math.max(0, Math.min(max, box.scrollLeft + dir * step));
  if (typeof box.scrollTo === 'function') {
    box.scrollTo({ left: target, behavior: 'smooth' });
  } else {
    box.scrollLeft = target;
  }
}

function bindSkinScrollUI(box) {
  if (!box || box.dataset.scrollUiBound) return;
  box.dataset.scrollUiBound = '1';
  const wrap = document.getElementById('skinOptionsWrap');
  const prev = document.getElementById('skinScrollPrev');
  const next = document.getElementById('skinScrollNext');

  box.addEventListener('wheel', (e) => {
    if (box.scrollWidth <= box.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    box.scrollLeft += e.deltaY;
  }, { passive: false });
  box.addEventListener('scroll', syncSkinScrollNav, { passive: true });
  window.addEventListener('resize', syncSkinScrollNav);

  const onNav = (dir) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (btn.classList.contains('is-disabled') || btn.getAttribute('aria-disabled') === 'true') return;
    scrollSkinOptions(dir);
  };
  if (prev) prev.addEventListener('click', onNav(-1));
  if (next) next.addEventListener('click', onNav(1));
  syncSkinScrollNav();
}

function renderSkinOptions() {
  const box = document.getElementById('skinOptions');
  if (!box) return;
  const active = currentSkinKey();
  const keys = (typeof SKIN_ORDER !== 'undefined' && SKIN_ORDER.length)
    ? SKIN_ORDER.filter((k) => SKINS[k])
    : Object.keys(SKINS);
  box.innerHTML = keys.map((key) => {
    const s = SKINS[key];
    const pv = SKIN_PREVIEW[key] || SKIN_PREVIEW.day;
    const style = Object.entries(pv).map(([k, v]) => `${k}:${v}`).join(';');
    const tip = `${s.label}：${s.desc}`;
    return `<button type="button" class="skin-option${active === key ? ' active' : ''}" data-key="${key}" style="${style}" title="${tip}">
      <span class="skin-preview" aria-hidden="true"></span>
      <span class="skin-name">${s.label}</span>
      <span class="skin-desc">${s.desc}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.skin-option').forEach((btn) => {
    btn.addEventListener('click', () => applySkin(btn.dataset.key));
  });
  bindSkinScrollUI(box);
  const on = box.querySelector('.skin-option.active');
  if (on && typeof on.scrollIntoView === 'function') {
    on.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
  }
  requestAnimationFrame(syncSkinScrollNav);
}

function renderThemeOptions() {
  const box = $('#themeOptions');
  if (!box) return;
  const current = resolveSavedPrimaryHex();
  const activeKey = findPresetKeyByPrimary(current);
  box.innerHTML = Object.entries(THEME_PRESETS).map(([key, t]) =>
    `<button type="button" class="theme-option${activeKey === key ? ' active' : ''}" data-key="${key}" title="${t.label}">
       <span class="swatch" style="background:${t.primary}"></span>
       <span class="theme-name">${t.label}</span>
       <span class="theme-check">${activeKey === key ? '✓' : ''}</span>
     </button>`
  ).join('');
  box.querySelectorAll('.theme-option').forEach((btn) => {
    btn.addEventListener('click', () => applyThemePreset(btn.dataset.key));
  });
  const skin = currentSkin();
  syncThemeControls(skin.customPrimary ? current : (skin.fixedPrimary || current));
  syncThemeColorSectionLock();
}

function updateThemePreviewFromInput() {
  const input = document.getElementById('themeColorInput');
  const hint = document.getElementById('themeColorHint');
  if (!input) return;
  if (!currentSkin().customPrimary) {
    syncThemeColorSectionLock();
    return;
  }
  const against = currentSkin().contrastAgainst || '#ffffff';
  const raw = input.value;
  const validStrict = parseHexColor(raw, { allowShort: false });
  const usable = !!(validStrict && isUsableThemeColor(validStrict, { allowShort: false, against }));
  const preview = document.getElementById('themeColorPreview');
  if (preview) preview.style.background = previewColor(raw, { against });
  input.classList.toggle('is-invalid', !usable);
  if (hint) {
    if (!raw.trim()) {
      hint.textContent = '支持 #RGB / #RRGGBB；过浅或无效时预览为黑色且不会应用';
    } else if (!validStrict) {
      hint.textContent = '色值格式不正确；预览为黑色，不会应用';
    } else if (!usable) {
      hint.textContent = '颜色对比不足，在当前皮肤背景上不够清晰；预览为黑色，请换一色';
    } else {
      hint.textContent = '支持 #RGB / #RRGGBB；过浅或无效时预览为黑色且不会应用';
    }
  }
  const picker = document.getElementById('themeColorPicker');
  if (picker && validStrict) picker.value = validStrict;
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const on = usable && findPresetKeyByPrimary(validStrict) === btn.dataset.key;
    btn.classList.toggle('active', on);
    const check = btn.querySelector('.theme-check');
    if (check) check.textContent = on ? '✓' : '';
  });
}

function bindThemeCustomControls() {
  const picker = document.getElementById('themeColorPicker');
  const input = document.getElementById('themeColorInput');
  if (!picker || !input || picker.dataset.bound) return;
  picker.dataset.bound = '1';

  picker.addEventListener('input', () => {
    if (!currentSkin().customPrimary) return;
    input.value = picker.value;
    updateThemePreviewFromInput();
    commitThemeColor(picker.value, { persist: true });
  });

  input.addEventListener('input', () => {
    if (!currentSkin().customPrimary) return;
    updateThemePreviewFromInput();
    const against = currentSkin().contrastAgainst || '#ffffff';
    const valid = parseHexColor(input.value, { allowShort: false });
    if (valid && isUsableThemeColor(valid, { allowShort: false, against })) {
      commitThemeColor(valid, { persist: true });
    }
  });

  const commitFromInput = () => {
    if (!currentSkin().customPrimary) return false;
    const valid = parseHexColor(input.value, { allowShort: true });
    if (valid && commitThemeColor(valid, { persist: true })) {
      input.value = parseHexColor(valid);
      updateThemePreviewFromInput();
      return true;
    }
    updateThemePreviewFromInput();
    return false;
  };

  input.addEventListener('change', () => { commitFromInput(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (commitFromInput()) input.blur();
  });
}

function initTheme() {
  applySkin(currentSkinKey(), { persist: true });
  bindThemeCustomControls();
}

function setActiveThemeOption() {
  const hex = resolveSavedPrimaryHex();
  syncThemeControls(hex);
}

async function loadStoragePath() {
  try {
    const p = await API.getStoragePath();
    $('#storagePathText').textContent = p || '';
    $('#storagePathText').title = p || '';
  } catch (_) { $('#storagePathText').textContent = '读取失败'; }
}

function switchSettingsPanel(panelId) {
  document.querySelectorAll('.settings-nav-item').forEach((it) =>
    it.classList.toggle('active', it.dataset.panel === panelId));
  document.querySelectorAll('.settings-panel').forEach((p) =>
    p.classList.toggle('hidden', p.id !== panelId));
  if (panelId === 'panel-trash') renderTrashList();
  if (panelId === 'panel-theme') {
    requestAnimationFrame(() => requestAnimationFrame(syncSkinScrollNav));
  }
  if (panelId === 'panel-plugins') renderPluginList();
  if (panelId === 'panel-about') fillAboutPanel();
  if (panelId === 'panel-export') {
    closeExportDropdowns();
    initExportPanelUI();
  } else {
    closeExportDropdowns();
  }
  if (panelId === 'panel-defaults') fillViewDefaultsForm();
  else closeAllViewDefaultsDropdowns();
}
document.querySelectorAll('.settings-nav-item').forEach((item) => {
  item.addEventListener('click', () => switchSettingsPanel(item.dataset.panel));
});

let pendingUpdateUrl = '';
const UPDATE_BADGE_KEY = 'kanban-update-available';

function setUpdateBadge(on, latest) {
  const dots = [
    document.getElementById('settingsUpdateDot'),
    document.getElementById('aboutUpdateDot'),
  ];
  dots.forEach((el) => {
    if (!el) return;
    el.classList.toggle('hidden', !on);
    el.hidden = !on;
  });
  const btn = document.getElementById('settingsBtn');
  if (btn) {
    btn.title = on
      ? `设置（有新版本${latest ? ` ${latest}` : ''}）`
      : '设置';
    btn.setAttribute('aria-label', btn.title);
  }
  try {
    if (on && latest) localStorage.setItem(UPDATE_BADGE_KEY, String(latest));
    else if (!on) localStorage.removeItem(UPDATE_BADGE_KEY);
  } catch (_) { /* ignore */ }
}

function restoreUpdateBadgeFromCache() {
  try {
    const v = localStorage.getItem(UPDATE_BADGE_KEY);
    if (v) setUpdateBadge(true, v);
  } catch (_) { /* ignore */ }
}

function applyUpdateCheckResult(res, { silent = false } = {}) {
  const hint = document.getElementById('aboutUpdateHint');
  const dlBtn = document.getElementById('downloadUpdateBtn');
  pendingUpdateUrl = '';
  if (dlBtn) {
    dlBtn.classList.add('hidden');
    dlBtn.hidden = true;
    dlBtn.disabled = false;
  }
  if (!res || !res.ok) {
    if (!silent && hint) hint.textContent = (res && res.error) || '检查失败';
    return false;
  }
  if (res.status === 'available') {
    const notes = res.notes ? `：${res.notes}` : '';
    if (hint) hint.textContent = `发现新版本 ${res.latest}（当前 ${res.current}）${notes}`;
    pendingUpdateUrl = res.url || '';
    if (dlBtn && pendingUpdateUrl) {
      dlBtn.classList.remove('hidden');
      dlBtn.hidden = false;
    }
    setUpdateBadge(true, res.latest);
    return true;
  }
  setUpdateBadge(false);
  if (!silent && hint) {
    hint.textContent = `已是最新版本（${res.current || res.latest || ''}）`;
  }
  return false;
}

/** 启动/后台静默检查；有新版则点亮小红点 */
async function silentCheckUpdate() {
  try {
    const res = await API.checkForUpdate();
    applyUpdateCheckResult(res, { silent: true });
  } catch (_) { /* ignore */ }
}
window.silentCheckUpdate = silentCheckUpdate;

async function fillAboutPanel() {
  const verEl = document.getElementById('aboutVersionText');
  const hint = document.getElementById('aboutUpdateHint');
  const dlBtn = document.getElementById('downloadUpdateBtn');
  pendingUpdateUrl = '';
  if (dlBtn) {
    dlBtn.classList.add('hidden');
    dlBtn.hidden = true;
    dlBtn.disabled = false;
  }
  try {
    const v = await API.getAppVersion();
    if (verEl) verEl.textContent = `版本 ${v || '—'}`;
  } catch (_) {
    if (verEl) verEl.textContent = '版本 —';
  }
  if (hint) hint.textContent = '正在检查更新…';
  try {
    const res = await API.checkForUpdate();
    applyUpdateCheckResult(res, { silent: false });
    if (res && res.ok && res.status === 'latest' && hint) {
      hint.textContent = `已是最新版本（${res.current || ''}）。也可稍后再点「检查更新」。`;
    } else if ((!res || !res.ok) && hint) {
      hint.textContent = ((res && res.error) || '自动检查失败') + '。可稍后点「检查更新」重试。';
    }
  } catch (err) {
    if (hint) hint.textContent = ((err && err.message) || '自动检查失败') + '。可稍后点「检查更新」重试。';
  }
}

document.getElementById('checkUpdateBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('checkUpdateBtn');
  const hint = document.getElementById('aboutUpdateHint');
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = '正在检查…';
  try {
    const res = await API.checkForUpdate();
    applyUpdateCheckResult(res, { silent: false });
  } catch (err) {
    if (hint) hint.textContent = (err && err.message) || '检查失败';
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('downloadUpdateBtn')?.addEventListener('click', async () => {
  if (!pendingUpdateUrl) return;
  const btn = document.getElementById('downloadUpdateBtn');
  const checkBtn = document.getElementById('checkUpdateBtn');
  const hint = document.getElementById('aboutUpdateHint');
  if (btn) btn.disabled = true;
  if (checkBtn) checkBtn.disabled = true;
  if (hint) hint.textContent = '正在下载…';
  const offProgress = API.onUpdateDownloadProgress?.((p) => {
    if (!hint || !p) return;
    if (p.percent != null) hint.textContent = `正在下载… ${p.percent}%`;
    else if (p.received) hint.textContent = `正在下载… ${(p.received / (1024 * 1024)).toFixed(1)} MB`;
  });
  try {
    const res = await API.downloadUpdate(pendingUpdateUrl);
    if (res && res.ok && res.applied) {
      if (hint) hint.textContent = '下载完成，正在退出并替换为新版本…';
      setUpdateBadge(false);
      return;
    }
    if (res && res.ok) {
      if (hint) hint.textContent = res.message || `已下载到：${res.path}`;
      setUpdateBadge(false);
      if (btn) btn.disabled = false;
      if (checkBtn) checkBtn.disabled = false;
    } else if (hint) {
      hint.textContent = (res && res.error) || '下载失败';
      if (btn) btn.disabled = false;
      if (checkBtn) checkBtn.disabled = false;
    }
  } catch (err) {
    if (hint) hint.textContent = (err && err.message) || '下载失败';
    if (btn) btn.disabled = false;
    if (checkBtn) checkBtn.disabled = false;
  } finally {
    try { offProgress && offProgress(); } catch (_) { /* ignore */ }
  }
});

restoreUpdateBadgeFromCache();

function pluginStatusLabel(p) {
  if (p.kind === 'download' && !p.installed) return '未安装';
  if (p.blockedReason && !p.enabled) return '不可用';
  return p.enabled ? '已开启' : '已关闭';
}

function pluginProgressMessage(p) {
  if (!p) return '';
  if (p.message) return p.message;
  if (p.phase === 'download') {
    if (p.status === 'need') return p.message || '准备下载…';
    if (p.status === 'start' || p.status === 'progress') return `正在下载 ${p.lang || ''}…`;
    if (p.status === 'inflate') return `正在解压 ${p.lang || ''}…`;
    if (p.status === 'done') return `${p.lang || ''} 就绪`;
  }
  if (p.phase === 'install') return p.status === 'done' ? '安装完成' : (p.message || '安装中…');
  if (p.phase === 'init') return p.message || '初始化…';
  return '';
}

function pluginProgressPercent(p) {
  if (!p) return null;
  if (typeof p.percent === 'number' && Number.isFinite(p.percent)) {
    return Math.max(0, Math.min(100, Math.round(p.percent)));
  }
  if (p.phase === 'install' && p.status === 'done') return 100;
  if (p.phase === 'download' && p.status === 'done') return 100;
  if (p.phase === 'download' && p.status === 'inflate') return 92;
  if (p.phase === 'install' && p.status === 'start') return 2;
  return null;
}

async function renderPluginList() {
  const box = document.getElementById('pluginList');
  if (!box) return;
  let list = [];
  let indexStats = null;
  try {
    list = await API.listPlugins();
  } catch (_) {
    box.innerHTML = '<p class="setting-hint">无法读取插件列表</p>';
    return;
  }
  try {
    const st = await API.ocrIndexStats();
    if (st && st.ok) indexStats = st;
  } catch (_) { /* ignore */ }

  const ocrPlugin = (list || []).find((x) => x.id === 'ocr');
  const ocrReady = !!(ocrPlugin && ocrPlugin.installed && ocrPlugin.enabled);

  box.innerHTML = (list || []).map((p) => {
    const status = pluginStatusLabel(p);
    let statusClass = (p.kind === 'download' && !p.installed) ? 'is-missing' : (p.enabled ? 'is-on' : 'is-off');
    if (p.blockedReason && !p.enabled) statusClass = 'is-blocked';
    let actions = '';
    if (p.kind === 'download' && !p.installed) {
      actions = `<button type="button" class="primary plugin-install" data-id="${p.id}">下载安装</button>`;
    } else if (p.kind === 'download') {
      actions = `
        <button type="button" class="plugin-toggle" data-id="${p.id}" data-enabled="${p.enabled ? '0' : '1'}">${p.enabled ? '关闭' : '开启'}</button>
        <button type="button" class="plugin-uninstall" data-id="${p.id}">卸载</button>`;
    } else if (p.id === 'ocr-search' && !ocrReady) {
      actions = `<button type="button" class="primary plugin-need-ocr">开启</button>`;
    } else {
      actions = `<button type="button" class="plugin-toggle${p.enabled ? '' : ' primary'}" data-id="${p.id}" data-enabled="${p.enabled ? '0' : '1'}">${p.enabled ? '关闭' : '开启'}</button>`;
      if (p.id === 'ocr-search' && p.enabled) {
        actions += `<button type="button" class="plugin-index-build" data-id="${p.id}">更新索引</button>`;
      }
    }
    let meta = p.sizeHint
      ? `下载大小：${ui.esc(p.sizeHint)}`
      : (p.kind === 'builtin' ? '内置插件，开启即可使用' : '');
    if (p.id === 'ocr-search') {
      if (p.blockedReason) {
        meta = ui.esc(p.blockedReason);
      } else if (indexStats) {
        meta = `索引：已收录 ${indexStats.indexed} / 共 ${indexStats.total} 张` +
          (indexStats.pending ? `（待处理 ${indexStats.pending}）` : '');
      }
    }
    return `<div class="plugin-card" data-id="${p.id}">
      <div class="plugin-card-main">
        <div class="plugin-card-title-row">
          <div class="plugin-card-heading">
            <div class="plugin-card-title">${ui.esc(p.name)}</div>
            <span class="plugin-status ${statusClass}">${status}</span>
          </div>
          <div class="plugin-card-actions">${actions}</div>
        </div>
        <p class="plugin-card-desc">${ui.esc(p.desc || '')}</p>
        <p class="plugin-card-meta${p.blockedReason ? ' is-warn' : ''}">${meta}</p>
        <div class="plugin-install-progress hidden" aria-live="polite">
          <div class="plugin-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="plugin-progress-fill" style="width:0%"></div>
          </div>
          <div class="plugin-progress-meta">
            <span class="plugin-progress-text">准备中…</span>
            <span class="plugin-progress-pct">0%</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('') || '<p class="setting-hint">暂无可用插件</p>';

  box.querySelectorAll('.plugin-install').forEach((btn) => {
    btn.addEventListener('click', () => installPluginFromUi(btn.dataset.id, btn.closest('.plugin-card')));
  });
  box.querySelectorAll('.plugin-need-ocr').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ocrCard = box.querySelector('.plugin-card[data-id="ocr"]');
      const installed = !!(ocrPlugin && ocrPlugin.installed);
      if (!installed) {
        alert('「图内文字搜索」依赖「图片文字识别」。请先下载安装并开启该插件。');
      } else {
        alert('「图内文字搜索」依赖「图片文字识别」。请先开启该插件。');
      }
      if (ocrCard) {
        ocrCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        ocrCard.classList.add('is-attention');
        setTimeout(() => ocrCard.classList.remove('is-attention'), 1600);
      }
    });
  });
  box.querySelectorAll('.plugin-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const enabled = btn.dataset.enabled === '1';
      btn.disabled = true;
      try {
        const res = await API.setPluginEnabled(id, enabled);
        if (!res || !res.ok) {
          if (res && res.needOcr) {
            alert((res.error || '请先安装并开启「图片文字识别」') + '。');
            const ocrCard = box.querySelector('.plugin-card[data-id="ocr"]');
            if (ocrCard) {
              ocrCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              ocrCard.classList.add('is-attention');
              setTimeout(() => ocrCard.classList.remove('is-attention'), 1600);
            }
          } else {
            alert((res && res.error) || '操作失败');
          }
        }
        if (id === 'ocr-search' && enabled && res && res.ok) {
          if (confirm('是否立即为全部任务图片建立文字索引？（可稍后在插件里点「更新索引」）')) {
            await renderPluginList();
            const card = document.querySelector('.plugin-card[data-id="ocr-search"]');
            if (card) await buildOcrIndexFromUi(card);
            return;
          }
        }
      } catch (err) {
        alert(err.message || String(err));
      }
      await renderPluginList();
      if (typeof window.refreshLightboxOcrEntry === 'function') window.refreshLightboxOcrEntry();
      if (typeof window.refreshClipboardQuick === 'function') window.refreshClipboardQuick();
      if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
    });
  });
  box.querySelectorAll('.plugin-uninstall').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('确定卸载该插件？将删除已下载的语言包并释放磁盘空间。')) return;
      btn.disabled = true;
      try {
        const res = await API.uninstallPlugin(id);
        if (!res || !res.ok) alert((res && res.error) || '卸载失败');
      } catch (err) {
        alert(err.message || String(err));
      }
      await renderPluginList();
      if (typeof window.refreshLightboxOcrEntry === 'function') window.refreshLightboxOcrEntry();
      if (typeof window.refreshClipboardQuick === 'function') window.refreshClipboardQuick();
      if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
    });
  });
  box.querySelectorAll('.plugin-index-build').forEach((btn) => {
    btn.addEventListener('click', () => buildOcrIndexFromUi(btn.closest('.plugin-card')));
  });
}

async function buildOcrIndexFromUi(card) {
  if (!card) return;
  const actions = card.querySelector('.plugin-card-actions');
  const btns = actions ? [...actions.querySelectorAll('button')] : [];
  btns.forEach((b) => { b.disabled = true; });
  setPluginInstallProgress(card, { percent: 1, text: '开始建立索引…' });
  const off = API.onOcrIndexProgress((p) => {
    if (!p) return;
    const pct = typeof p.percent === 'number' ? p.percent : null;
    setPluginInstallProgress(card, {
      percent: pct ?? undefined,
      text: p.message || '索引中…',
      indeterminate: pct == null,
    });
  });
  try {
    const res = await API.ocrIndexBuild({ force: false });
    if (!res || !res.ok) throw new Error((res && res.error) || '建立索引失败');
    setPluginInstallProgress(card, {
      percent: 100,
      text: res.message || (res.total === 0 ? '索引已是最新' : `完成：成功 ${res.okCount || 0}`),
    });
  } catch (err) {
    setPluginInstallProgress(card, { percent: 0, text: err.message || String(err) });
    alert(err.message || String(err));
  } finally {
    if (typeof off === 'function') off();
    await renderPluginList();
    if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
  }
}

function setPluginInstallProgress(card, { percent, text, indeterminate = false } = {}) {
  const wrap = card && card.querySelector('.plugin-install-progress');
  if (!wrap) return;
  wrap.classList.remove('hidden');
  const fill = wrap.querySelector('.plugin-progress-fill');
  const track = wrap.querySelector('.plugin-progress-track');
  const textEl = wrap.querySelector('.plugin-progress-text');
  const pctEl = wrap.querySelector('.plugin-progress-pct');
  const pct = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null;
  wrap.classList.toggle('is-indeterminate', !!indeterminate && pct == null);
  if (fill) {
    if (indeterminate && pct == null) fill.style.width = '35%';
    else fill.style.width = `${pct ?? 0}%`;
  }
  if (track && pct != null) track.setAttribute('aria-valuenow', String(pct));
  if (textEl && text) textEl.textContent = text;
  if (pctEl) pctEl.textContent = pct != null ? `${pct}%` : '';
}

async function installPluginFromUi(id, card) {
  if (!id || !card) return;
  const actions = card.querySelector('.plugin-card-actions');
  const btns = actions ? [...actions.querySelectorAll('button')] : [];
  btns.forEach((b) => { b.disabled = true; });
  setPluginInstallProgress(card, { percent: 1, text: '开始安装…' });
  const off = API.onPluginProgress((p) => {
    if (!p || p.id !== id) return;
    const msg = pluginProgressMessage(p);
    const percent = pluginProgressPercent(p);
    setPluginInstallProgress(card, {
      percent: percent ?? undefined,
      text: msg || '安装中…',
      indeterminate: percent == null,
    });
  });
  try {
    const res = await API.installPlugin(id);
    if (!res || !res.ok) throw new Error((res && res.error) || '安装失败');
    setPluginInstallProgress(card, { percent: 100, text: '安装完成' });
  } catch (err) {
    setPluginInstallProgress(card, { percent: 0, text: err.message || String(err) });
    alert(err.message || String(err));
  } finally {
    if (typeof off === 'function') off();
    await renderPluginList();
    if (typeof window.refreshLightboxOcrEntry === 'function') window.refreshLightboxOcrEntry();
    if (typeof window.refreshClipboardQuick === 'function') window.refreshClipboardQuick();
    if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
  }
}

function openSettings() {
  loadStoragePath();
  renderSkinOptions();
  renderThemeOptions();
  bindThemeCustomControls();
  renderTrashList();
  initExportPanelUI();
  renderPluginList();
  fillViewDefaultsForm();
  $('#settingsOverlay').classList.remove('hidden');
}

/** 打开设置并切到指定面板（供灯箱等入口调用） */
window.openSettingsTo = (panelId) => {
  openSettings();
  if (panelId) switchSettingsPanel(panelId);
};

function closeSettings() {
  closeExportDropdowns();
  closeAllViewDefaultsDropdowns();
  $('#settingsOverlay').classList.add('hidden');
}

let viewDefaultsDraft = null;

const VIEW_DEFAULTS_FIELDS = [
  { key: 'filter', optsName: 'VIEW_FILTER_OPTS', wrap: 'defFilterWrap', select: 'defFilterSelect', selected: 'defFilterSelected', dropdown: 'defFilterDropdown' },
  { key: 'sortKey', optsName: 'VIEW_SORT_OPTS', wrap: 'defSortWrap', select: 'defSortSelect', selected: 'defSortSelected', dropdown: 'defSortDropdown' },
  { key: 'range', optsName: 'VIEW_RANGE_OPTS', wrap: 'defRangeWrap', select: 'defRangeSelect', selected: 'defRangeSelected', dropdown: 'defRangeDropdown' },
  { key: 'pageSize', optsName: 'VIEW_PAGE_SIZE_OPTS', wrap: 'defPageSizeWrap', select: 'defPageSizeSelect', selected: 'defPageSizeSelected', dropdown: 'defPageSizeDropdown', asPageSize: true },
];

function viewDefaultsOpts(field) {
  if (field.asPageSize) {
    return (VIEW_PAGE_SIZE_OPTS || []).map((n) => ({ key: String(n), label: `${n} 条/页` }));
  }
  if (field.optsName === 'VIEW_FILTER_OPTS') return VIEW_FILTER_OPTS || [];
  if (field.optsName === 'VIEW_SORT_OPTS') return VIEW_SORT_OPTS || [];
  if (field.optsName === 'VIEW_RANGE_OPTS') return VIEW_RANGE_OPTS || [];
  return [];
}

function closeAllViewDefaultsDropdowns() {
  VIEW_DEFAULTS_FIELDS.forEach((f) => {
    const dd = document.getElementById(f.dropdown);
    const sel = document.getElementById(f.select);
    if (dd) dd.classList.add('hidden');
    if (sel) sel.classList.remove('open');
  });
}

function setViewDefaultsHint(text) {
  const hint = document.getElementById('defSaveHint');
  if (hint) hint.textContent = text;
}

function renderViewDefaultsDropdown(field) {
  const dd = document.getElementById(field.dropdown);
  const label = document.getElementById(field.selected);
  if (!dd || !viewDefaultsDraft) return;
  const opts = viewDefaultsOpts(field);
  const curKey = field.asPageSize
    ? String(viewDefaultsDraft.pageSize)
    : String(viewDefaultsDraft[field.key]);
  const cur = opts.find((o) => String(o.key) === curKey) || opts[0];
  if (label && cur) label.textContent = cur.label;
  dd.innerHTML = opts.map((o) =>
    `<div class="range-option${String(o.key) === curKey ? ' active' : ''}" data-key="${ui.esc(String(o.key))}">${ui.esc(o.label)}</div>`
  ).join('');
  dd.querySelectorAll('.range-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (field.asPageSize) viewDefaultsDraft.pageSize = Number(opt.dataset.key);
      else viewDefaultsDraft[field.key] = opt.dataset.key;
      persistViewDefaultsFromForm();
      renderViewDefaultsDropdown(field);
      closeAllViewDefaultsDropdowns();
      setViewDefaultsHint('已保存。下次启动生效；也可点「立即应用」。');
    });
  });
}

function fillViewDefaultsForm() {
  if (typeof loadViewDefaults !== 'function') return;
  viewDefaultsDraft = loadViewDefaults();
  VIEW_DEFAULTS_FIELDS.forEach(renderViewDefaultsDropdown);
  const exp = document.getElementById('defFiltersExpanded');
  if (exp) exp.checked = !!viewDefaultsDraft.filtersExpanded;
  setViewDefaultsHint('更改会自动保存；「立即应用」同步到当前列表。');
}

function readViewDefaultsForm() {
  const draft = viewDefaultsDraft || (typeof loadViewDefaults === 'function' ? loadViewDefaults() : {});
  return {
    filter: draft.filter,
    sortKey: draft.sortKey,
    range: draft.range,
    pageSize: Number(draft.pageSize),
    filtersExpanded: !!document.getElementById('defFiltersExpanded')?.checked,
  };
}

function persistViewDefaultsFromForm() {
  if (typeof saveViewDefaults !== 'function') return null;
  const saved = saveViewDefaults(readViewDefaultsForm());
  viewDefaultsDraft = saved;
  return saved;
}

(function bindViewDefaultsPanel() {
  VIEW_DEFAULTS_FIELDS.forEach((field) => {
    const sel = document.getElementById(field.select);
    const dd = document.getElementById(field.dropdown);
    if (!sel || !dd) return;
    sel.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = !dd.classList.contains('hidden');
      closeAllViewDefaultsDropdowns();
      closeExportDropdowns();
      if (wasOpen) return;
      renderViewDefaultsDropdown(field);
      dd.classList.remove('hidden');
      sel.classList.add('open');
    });
    dd.addEventListener('click', (e) => e.stopPropagation());
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#panel-defaults')) return;
    if (!e.target.closest('.defaults-select-wrap')) closeAllViewDefaultsDropdowns();
  });
  const exp = document.getElementById('defFiltersExpanded');
  if (exp) {
    exp.addEventListener('change', () => {
      if (viewDefaultsDraft) viewDefaultsDraft.filtersExpanded = !!exp.checked;
      persistViewDefaultsFromForm();
      setViewDefaultsHint('已保存。下次启动生效；也可点「立即应用」。');
    });
  }
  const applyBtn = document.getElementById('defApplyBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      closeAllViewDefaultsDropdowns();
      const saved = persistViewDefaultsFromForm();
      if (typeof applyViewDefaultsToSession === 'function') {
        applyViewDefaultsToSession(saved || loadViewDefaults(), { refreshList: true });
      }
      setViewDefaultsHint('已保存并应用到当前列表。');
    });
  }
  const resetBtn = document.getElementById('defResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('将常用默认恢复为出厂设置？\n（待执行 / 按创建时间 / 全部时间 / 50条 / 筛选栏收起）')) return;
      closeAllViewDefaultsDropdowns();
      const factory = typeof resetViewDefaults === 'function' ? resetViewDefaults() : null;
      fillViewDefaultsForm();
      if (factory && typeof applyViewDefaultsToSession === 'function') {
        applyViewDefaultsToSession(factory, { refreshList: true });
      }
      setViewDefaultsHint('已恢复出厂默认，并应用到当前列表。');
    });
  }
})();

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsClose').addEventListener('click', closeSettings);
$('#settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') closeSettings(); });

document.getElementById('storageOpenBtn').addEventListener('click', async () => {
  const res = await API.openStoragePath();
  if (res && !res.ok) alert(res.error || '打开失败');
});

document.getElementById('storageChangeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('storageChangeBtn');
  btn.disabled = true;
  try {
    const res = await API.changeStoragePath();
    if (!res || !res.ok) { if (res && res.error !== '已取消') alert(res.error || '更换失败'); return; }
    if (res.changed) {
      const hint = res.added ? `，已迁移 ${res.added} 个数据文件` : '';
      alert(`已切换存储路径${hint}，界面数据已刷新。`);
    }
  } finally {
    btn.disabled = false;
  }
});
document.getElementById('storageResetBtn').addEventListener('click', async () => {
  const res = await API.resetStoragePath();
  if (res && res.changed) alert('已恢复默认存储路径，界面数据已刷新。');
  loadStoragePath();
});
document.getElementById('cleanupBtn').addEventListener('click', async () => {
  const btn = document.getElementById('cleanupBtn');
  const ok = await showConfirm('将删除未被任何任务或回收站引用的图片和附件文件，确定继续吗？');
  if (!ok) return;
  btn.disabled = true;
  try {
    const res = await API.cleanupStorage();
    if (res && res.deleted > 0) alert(`已清理 ${res.deleted} 个孤立文件。`);
    else alert('没有需要清理的文件。');
  } finally {
    btn.disabled = false;
  }
});

let trashSelected = new Set();

function syncTrashToolbar(total) {
  const toolbar = document.getElementById('trashToolbar');
  const all = document.getElementById('trashSelectAll');
  const countEl = document.getElementById('trashSelectedCount');
  const restoreBtn = document.getElementById('trashBatchRestore');
  const purgeBtn = document.getElementById('trashBatchPurge');
  if (!toolbar) return;
  const n = trashSelected.size;
  const show = total > 0;
  toolbar.hidden = !show;
  toolbar.classList.toggle('hidden', !show);
  if (countEl) countEl.textContent = `已选 ${n} 项`;
  if (restoreBtn) restoreBtn.disabled = n === 0;
  if (purgeBtn) purgeBtn.disabled = n === 0;
  if (all) {
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
}

function getTrashSelectedIds() {
  return [...trashSelected];
}

async function renderTrashList() {
  const box = $('#trashList');
  if (!box) return;
  const list = await API.listTrash();
  const ids = new Set(list.map((t) => t.id));
  trashSelected = new Set([...trashSelected].filter((id) => ids.has(id)));
  if (!list.length) {
    box.innerHTML = '<p class="hint">回收站为空</p>';
    syncTrashToolbar(0);
    return;
  }
  box.innerHTML = list.map((t) => {
    const title = (t.text || '').trim() || '（无文字）';
    const preview = title.length > 40 ? title.slice(0, 40) + '…' : title;
    const when = t.trashedAt
      ? new Date(t.trashedAt).toLocaleString('zh-CN', { hour12: false })
      : '';
    const checked = trashSelected.has(t.id) ? ' checked' : '';
    return `<div class="trash-row${checked ? ' is-selected' : ''}" data-id="${ui.esc(t.id)}">
      <label class="trash-check" title="选择">
        <input type="checkbox" class="trash-item-check" data-id="${ui.esc(t.id)}"${checked}>
      </label>
      <div class="trash-main">
        <div class="trash-title">${ui.esc(preview)}</div>
        <div class="trash-time">${ui.esc(when)}</div>
      </div>
      <div class="trash-actions">
        <button type="button" class="trash-restore" data-id="${ui.esc(t.id)}">恢复</button>
        <button type="button" class="trash-purge danger" data-id="${ui.esc(t.id)}">彻底删除</button>
      </div>
    </div>`;
  }).join('');
  syncTrashToolbar(list.length);

  box.querySelectorAll('.trash-item-check').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const id = input.dataset.id;
      if (input.checked) trashSelected.add(id);
      else trashSelected.delete(id);
      const row = input.closest('.trash-row');
      if (row) row.classList.toggle('is-selected', input.checked);
      syncTrashToolbar(list.length);
    });
  });
  box.querySelectorAll('.trash-restore').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await API.restoreTrash(btn.dataset.id);
      if (!res.ok) { alert(res.error || '恢复失败'); return; }
      trashSelected.delete(btn.dataset.id);
      await renderTrashList();
      await refresh();
    });
  });
  box.querySelectorAll('.trash-purge').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('彻底删除后无法恢复，确定继续吗？');
      if (!ok) return;
      await API.purgeTrash(btn.dataset.id);
      trashSelected.delete(btn.dataset.id);
      await renderTrashList();
    });
  });
}

document.getElementById('trashSelectAll')?.addEventListener('change', async (e) => {
  const box = $('#trashList');
  const checked = !!e.target.checked;
  if (!box) return;
  const inputs = [...box.querySelectorAll('.trash-item-check')];
  trashSelected = checked
    ? new Set(inputs.map((el) => el.dataset.id).filter(Boolean))
    : new Set();
  inputs.forEach((el) => {
    el.checked = checked;
    const row = el.closest('.trash-row');
    if (row) row.classList.toggle('is-selected', checked);
  });
  syncTrashToolbar(inputs.length);
});

document.getElementById('trashBatchRestore')?.addEventListener('click', async () => {
  const ids = getTrashSelectedIds();
  if (!ids.length) return;
  let okCount = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const res = await API.restoreTrash(id);
      if (res && res.ok) {
        okCount += 1;
        trashSelected.delete(id);
      } else fail += 1;
    } catch (_) { fail += 1; }
  }
  await renderTrashList();
  await refresh();
  if (fail) alert(`已恢复 ${okCount} 条，失败 ${fail} 条`);
});

document.getElementById('trashBatchPurge')?.addEventListener('click', async () => {
  const ids = getTrashSelectedIds();
  if (!ids.length) return;
  const ok = await showConfirm(`彻底删除所选 ${ids.length} 条后无法恢复，确定继续吗？`);
  if (!ok) return;
  for (const id of ids) {
    try {
      await API.purgeTrash(id);
      trashSelected.delete(id);
    } catch (_) { /* ignore */ }
  }
  await renderTrashList();
});

document.getElementById('trashEmptyBtn').addEventListener('click', async () => {
  const ok = await showConfirm('确定清空回收站？其中任务将被彻底删除且无法恢复。');
  if (!ok) return;
  const res = await API.emptyTrash();
  trashSelected.clear();
  alert(res && res.count ? `已清空 ${res.count} 条` : '回收站已为空');
  await renderTrashList();
});

document.getElementById('backupExportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('backupExportBtn');
  btn.disabled = true;
  try {
    const res = await API.exportBackup();
    if (!res || !res.ok) {
      if (res && res.error !== '已取消') alert(res.error || '导出失败');
      return;
    }
    alert('备份已导出：\n' + res.path);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('backupImportBtn').addEventListener('click', async () => {
  const ok = await showConfirm('导入将合并备份数据（相同 id 跳过）。确定继续吗？');
  if (!ok) return;
  const btn = document.getElementById('backupImportBtn');
  btn.disabled = true;
  try {
    const res = await API.importBackup();
    if (!res || !res.ok) {
      if (res && res.error !== '已取消') alert(res.error || '导入失败');
      return;
    }
    alert(`导入完成：任务 +${res.tasksAdded || 0}，标签 +${res.tagsAdded || 0}，文件 +${res.filesCopied || 0}`);
    await loadTags();
    await refresh();
    await renderTrashList();
  } finally {
    btn.disabled = false;
  }
});

let exportTagIds = [];
let exportStatus = 'all';
let exportSortKey = 'createdAt';

const EXPORT_STATUS_OPTS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待执行' },
  { key: 'done', label: '已执行' },
];
const EXPORT_SORT_OPTS = [
  { key: 'createdAt', label: '创建时间' },
  { key: 'statusAt', label: '状态处理时间' },
  { key: 'updatedAt', label: '编辑更新时间' },
];

const exportTagEls = {
  selected: null,
  control: null,
  options: null,
  search: null,
};

function getExportTagEls() {
  if (!exportTagEls.selected) {
    exportTagEls.selected = document.getElementById('exportTagSelected');
    exportTagEls.control = document.getElementById('exportTagControl');
    exportTagEls.options = document.getElementById('exportTagOptions');
    exportTagEls.search = document.getElementById('exportTagSearch');
  }
  return exportTagEls;
}

function closeExportTagDropdown() {
  const dd = document.getElementById('exportTagDropdown');
  const control = document.getElementById('exportTagControl');
  if (dd) dd.classList.add('hidden');
  if (control) control.classList.remove('open');
}

function closeExportStatusDropdown() {
  const dd = document.getElementById('exportStatusDropdown');
  const sel = document.getElementById('exportStatusSelect');
  if (dd) dd.classList.add('hidden');
  if (sel) sel.classList.remove('open');
}

function closeExportSortDropdown() {
  const dd = document.getElementById('exportSortDropdown');
  const sel = document.getElementById('exportSortSelect');
  if (dd) dd.classList.add('hidden');
  if (sel) sel.classList.remove('open');
}

function closeExportDropdowns() {
  closeExportTagDropdown();
  closeExportStatusDropdown();
  closeExportSortDropdown();
}

function toggleExportTagDropdown() {
  const dd = document.getElementById('exportTagDropdown');
  const control = document.getElementById('exportTagControl');
  if (!dd || !control) return;
  const isOpen = !dd.classList.contains('hidden');
  closeExportStatusDropdown();
  closeExportSortDropdown();
  dd.classList.toggle('hidden', isOpen);
  control.classList.toggle('open', !isOpen);
}

function renderExportStatusDropdown() {
  const box = document.getElementById('exportStatusDropdown');
  const label = document.getElementById('exportStatusSelected');
  if (!box || !label) return;
  const cur = EXPORT_STATUS_OPTS.find((o) => o.key === exportStatus) || EXPORT_STATUS_OPTS[0];
  label.textContent = cur.label;
  box.innerHTML = EXPORT_STATUS_OPTS.map((o) =>
    `<div class="range-option${o.key === exportStatus ? ' active' : ''}" data-key="${o.key}">${o.label}</div>`
  ).join('');
  box.querySelectorAll('.range-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      exportStatus = opt.dataset.key;
      renderExportStatusDropdown();
      closeExportStatusDropdown();
    });
  });
}

function renderExportSortDropdown() {
  const box = document.getElementById('exportSortDropdown');
  const label = document.getElementById('exportSortSelected');
  if (!box || !label) return;
  const cur = EXPORT_SORT_OPTS.find((o) => o.key === exportSortKey) || EXPORT_SORT_OPTS[0];
  label.textContent = cur.label;
  box.innerHTML = EXPORT_SORT_OPTS.map((o) =>
    `<div class="range-option${o.key === exportSortKey ? ' active' : ''}" data-key="${o.key}">${o.label}</div>`
  ).join('');
  box.querySelectorAll('.range-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      exportSortKey = opt.dataset.key;
      renderExportSortDropdown();
      closeExportSortDropdown();
    });
  });
}

async function renderExportTagList() {
  const tags = typeof tagList !== 'undefined' && tagList.length
    ? tagList
    : await API.getAllTags();
  const els = getExportTagEls();
  ui.renderTagFilter(tags, exportTagIds, (id, checked) => {
    if (checked) {
      if (!exportTagIds.includes(id)) exportTagIds.push(id);
    } else {
      exportTagIds = exportTagIds.filter((x) => x !== id);
    }
    ui.renderTagSelected(exportTagIds, els);
  }, els);
  ui.renderTagSelected(exportTagIds, els);
}

function initExportPanelUI() {
  renderExportStatusDropdown();
  renderExportSortDropdown();
  renderExportTagList();
}

function collectExportOptions() {
  const formatEl = document.querySelector('input[name="exportFormat"]:checked');
  return {
    tagIds: exportTagIds.slice(),
    status: exportStatus || 'all',
    sortKey: exportSortKey || 'createdAt',
    format: (formatEl && formatEl.value) || 'pdf',
    includeImages: document.getElementById('exportIncludeImages').checked,
  };
}

document.getElementById('exportTagControl').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleExportTagDropdown();
});
document.getElementById('exportTagClear').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!exportTagIds.length) return;
  exportTagIds = [];
  ui.renderTagSelected(exportTagIds, getExportTagEls());
  renderExportTagList();
});
document.getElementById('exportTagDropdown').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('exportStatusSelect').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('exportStatusDropdown');
  const sel = document.getElementById('exportStatusSelect');
  const isOpen = !dd.classList.contains('hidden');
  closeExportTagDropdown();
  closeExportSortDropdown();
  renderExportStatusDropdown();
  dd.classList.toggle('hidden', isOpen);
  sel.classList.toggle('open', !isOpen);
});
document.getElementById('exportStatusDropdown').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('exportSortSelect').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('exportSortDropdown');
  const sel = document.getElementById('exportSortSelect');
  const isOpen = !dd.classList.contains('hidden');
  closeExportTagDropdown();
  closeExportStatusDropdown();
  renderExportSortDropdown();
  dd.classList.toggle('hidden', isOpen);
  sel.classList.toggle('open', !isOpen);
});
document.getElementById('exportSortDropdown').addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', (e) => {
  if (!e.target.closest('#exportTagWrap')) closeExportTagDropdown();
  if (!e.target.closest('#exportStatusWrap')) closeExportStatusDropdown();
  if (!e.target.closest('#exportSortWrap')) closeExportSortDropdown();
});

document.getElementById('exportTasksBtn').addEventListener('click', async () => {
  const btn = document.getElementById('exportTasksBtn');
  btn.disabled = true;
  btn.textContent = '导出中…';
  try {
    const res = await API.exportTasks(collectExportOptions());
    if (!res || !res.ok) {
      if (res && res.error !== '已取消') alert(res.error || '导出失败');
      return;
    }
    alert(`已导出 ${res.count || 0} 条任务：\n${res.path}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出';
  }
});

API.onStorageChanged(() => { loadTags(); refresh(); renderTrashList(); });

function initAlwaysOnTop() {
  const pinBtn = document.getElementById('pinBtn');
  let pinned = localStorage.getItem('kanban-alwaysOnTop') === '1';
  const apply = () => {
    pinBtn.classList.toggle('active', pinned);
    pinBtn.title = pinned ? '取消窗口置顶' : '窗口置顶';
    API.setAlwaysOnTop(pinned);
  };
  pinBtn.addEventListener('click', () => {
    pinned = !pinned;
    localStorage.setItem('kanban-alwaysOnTop', pinned ? '1' : '0');
    apply();
  });
  apply();
}
