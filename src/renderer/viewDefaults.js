/** 列表启动默认偏好（本机 localStorage） */

const VIEW_DEFAULTS_KEY = 'kanban-view-defaults';

const VIEW_FACTORY_DEFAULTS = Object.freeze({
  filter: 'pending',
  sortKey: 'createdAt',
  range: 'all',
  pageSize: 50,
  filtersExpanded: false,
  createPanelMode: 'docked',
});

const VIEW_FILTER_OPTS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待执行' },
  { key: 'done', label: '已执行' },
];
const VIEW_SORT_OPTS = [
  { key: 'createdAt', label: '按创建时间' },
  { key: 'statusAt', label: '按状态处理' },
  { key: 'updatedAt', label: '按编辑更新' },
];
const VIEW_RANGE_OPTS = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'lastweek', label: '上周' },
  { key: 'month', label: '本月' },
  { key: 'lastmonth', label: '上月' },
];
const VIEW_PAGE_SIZE_OPTS = [50, 100, 200];

const VIEW_CREATE_PANEL_OPTS = [
  { key: 'docked', label: '固定在右侧' },
  { key: 'collapsed', label: '收起为加号' },
];

function normalizeCreatePanelMode(m) {
  return m === 'collapsed' ? 'collapsed' : 'docked';
}

function cloneViewDefaults(src) {
  return {
    filter: src.filter,
    sortKey: src.sortKey,
    range: src.range,
    pageSize: src.pageSize,
    filtersExpanded: !!src.filtersExpanded,
    createPanelMode: normalizeCreatePanelMode(src.createPanelMode),
  };
}

function normalizeViewDefaults(raw) {
  const base = cloneViewDefaults(VIEW_FACTORY_DEFAULTS);
  if (!raw || typeof raw !== 'object') return base;
  if (VIEW_FILTER_OPTS.some((o) => o.key === raw.filter)) base.filter = raw.filter;
  if (VIEW_SORT_OPTS.some((o) => o.key === raw.sortKey)) base.sortKey = raw.sortKey;
  if (VIEW_RANGE_OPTS.some((o) => o.key === raw.range)) base.range = raw.range;
  const ps = Number(raw.pageSize);
  if (VIEW_PAGE_SIZE_OPTS.includes(ps)) base.pageSize = ps;
  if (typeof raw.filtersExpanded === 'boolean') base.filtersExpanded = raw.filtersExpanded;
  if (raw.createPanelMode === 'collapsed' || raw.createPanelMode === 'docked') {
    base.createPanelMode = raw.createPanelMode;
  }
  return base;
}

function loadViewDefaults() {
  try {
    const raw = localStorage.getItem(VIEW_DEFAULTS_KEY);
    if (!raw) return cloneViewDefaults(VIEW_FACTORY_DEFAULTS);
    return normalizeViewDefaults(JSON.parse(raw));
  } catch (_) {
    return cloneViewDefaults(VIEW_FACTORY_DEFAULTS);
  }
}

function saveViewDefaults(prefs) {
  const next = normalizeViewDefaults(prefs);
  localStorage.setItem(VIEW_DEFAULTS_KEY, JSON.stringify(next));
  return next;
}

function resetViewDefaults() {
  localStorage.removeItem(VIEW_DEFAULTS_KEY);
  return cloneViewDefaults(VIEW_FACTORY_DEFAULTS);
}

/** 把偏好写入当前会话状态，并刷新顶栏 UI */
function applyViewDefaultsToSession(prefs, { refreshList = true, coldStart = false } = {}) {
  const p = normalizeViewDefaults(prefs);
  filter = p.filter;
  sortKey = p.sortKey;
  range = p.range;
  pageSize = p.pageSize;
  page = 1;
  searchQuery = '';
  if (typeof searchInput !== 'undefined' && searchInput) searchInput.value = '';

  if (typeof renderStatusSeg === 'function') renderStatusSeg();
  if (typeof renderRangeDropdown === 'function') renderRangeDropdown();
  if (typeof renderSortDropdown === 'function') renderSortDropdown();
  if (typeof setFiltersExpanded === 'function') setFiltersExpanded(p.filtersExpanded);
  if (typeof syncFilterBadge === 'function') syncFilterBadge();
  const pageSizeLabel = document.getElementById('pageSizeLabel');
  if (pageSizeLabel) pageSizeLabel.textContent = `${pageSize} 条/页`;

  if (typeof applyCreatePanelMode === 'function') {
    const prev = typeof getCreatePanelMode === 'function' ? getCreatePanelMode() : null;
    let reason = 'mode-change';
    if (coldStart) reason = 'cold';
    else if (prev === p.createPanelMode) reason = 'same-mode';
    applyCreatePanelMode(p.createPanelMode, { reason });
  }

  if (refreshList && typeof refresh === 'function') refresh();
  return p;
}

function applySavedViewDefaults(opts) {
  return applyViewDefaultsToSession(loadViewDefaults(), opts);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEW_DEFAULTS_KEY,
    VIEW_FACTORY_DEFAULTS,
    VIEW_FILTER_OPTS,
    VIEW_SORT_OPTS,
    VIEW_RANGE_OPTS,
    VIEW_PAGE_SIZE_OPTS,
    VIEW_CREATE_PANEL_OPTS,
    normalizeCreatePanelMode,
    cloneViewDefaults,
    normalizeViewDefaults,
    loadViewDefaults,
    saveViewDefaults,
    resetViewDefaults,
    applyViewDefaultsToSession,
    applySavedViewDefaults,
  };
}
