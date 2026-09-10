/** 列表启动默认偏好（本机 localStorage） */

const VIEW_DEFAULTS_KEY = 'kanban-view-defaults';

const VIEW_FACTORY_DEFAULTS = Object.freeze({
  filter: 'pending',
  sortKey: 'createdAt',
  range: 'all',
  pageSize: 50,
  filtersExpanded: false,
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

function cloneViewDefaults(src) {
  return {
    filter: src.filter,
    sortKey: src.sortKey,
    range: src.range,
    pageSize: src.pageSize,
    filtersExpanded: !!src.filtersExpanded,
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
function applyViewDefaultsToSession(prefs, { refreshList = true } = {}) {
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

  if (refreshList && typeof refresh === 'function') refresh();
  return p;
}

function applySavedViewDefaults(opts) {
  return applyViewDefaultsToSession(loadViewDefaults(), opts);
}
