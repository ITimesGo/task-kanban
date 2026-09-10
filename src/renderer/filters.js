const RANGES = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'lastweek', label: '上周' },
  { key: 'month', label: '本月' },
  { key: 'lastmonth', label: '上月' },
];

const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待执行' },
  { key: 'done', label: '已执行' },
];

const SORTS = [
  { key: 'createdAt', label: '按创建时间', short: '创建' },
  { key: 'statusAt', label: '按状态处理', short: '状态' },
  { key: 'updatedAt', label: '按编辑更新', short: '编辑' },
];

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const PAGER_COUNT = 3;

function rangeBounds() {
  const now = new Date();
  const startOfDay = () => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; };
  const startOfWeek = () => { const d = startOfDay(); const day = d.getDay() || 7; d.setDate(d.getDate() - (day - 1)); return d; };
  const startOfMonth = () => { const d = startOfDay(); d.setDate(1); return d; };
  const nextMonth = () => new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonth = () => new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

  switch (range) {
    case 'today':      return { start: startOfDay(), end: addDays(startOfDay(), 1) };
    case 'week':       { const s = startOfWeek(); return { start: s, end: addDays(s, 7) }; }
    case 'lastweek':   { const s = startOfWeek(); return { start: addDays(s, -7), end: s }; }
    case 'month':      return { start: startOfMonth(), end: nextMonth() };
    case 'lastmonth':  return { start: prevMonth(), end: startOfMonth() };
    default:           return { start: null, end: null };
  }
}

function taskTimeMs(t, field) {
  const v = t && t[field];
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

function inRange(t) {
  const { start, end } = rangeBounds();
  if (!start && !end) return true;
  // 时间范围跟当前排序字段一致；缺 statusAt 的任务不进入有范围的筛选
  const ms = taskTimeMs(t, sortKey);
  if (!ms) return false;
  if (start && ms < start.getTime()) return false;
  if (end && ms >= end.getTime()) return false;
  return true;
}

function sortList(list) {
  return [...list].sort((a, b) => taskTimeMs(b, sortKey) - taskTimeMs(a, sortKey));
}

async function refresh() {
  tasks = await API.getAllTasks();
  let list = tasks.filter(inRange);
  if (filter !== 'all') list = list.filter((t) => t.status === filter);
  if (tagFilter.length) list = list.filter((t) => tagFilter.some((id) => (t.tags || []).includes(id)));
  let matchById = null;
  if (searchQuery.trim()) {
    const opts = (typeof ocrSearchTexts !== 'undefined' && ocrSearchTexts)
      ? { ocrTexts: ocrSearchTexts }
      : undefined;
    const matched = [];
    matchById = {};
    for (const t of list) {
      const info = typeof taskMatchInfo === 'function'
        ? taskMatchInfo(t, searchQuery, opts)
        : null;
      if (!info) continue;
      matched.push(t);
      if (t && t.id != null) matchById[t.id] = info;
    }
    list = matched;
  }
  list = sortList(list);
  const total = list.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  if (page > maxPage) page = maxPage;
  const start = (page - 1) * pageSize;
  const sortMeta = SORTS.find((s) => s.key === sortKey) || SORTS[0];
  ui.renderCards(list.slice(start, start + pageSize), {
    onQuickToggle: toggleStatus,
    onOpen: openDetail,
    emptyText: searchQuery.trim() ? '没有匹配的任务' : '暂无任务',
    timeField: sortMeta.key,
    timeLabel: sortMeta.short,
    matchById,
  });
  renderPagination(total, maxPage);
}

function pagerRange(current, total) {
  if (total <= PAGER_COUNT) return { pages: Array.from({ length: total }, (_, i) => i + 1), leftBreak: false, rightBreak: false };
  const half = Math.floor(PAGER_COUNT / 2);
  let start = Math.max(1, current - half);
  let end = start + PAGER_COUNT - 1;
  if (end > total) { end = total; start = end - PAGER_COUNT + 1; }
  const leftBreak = start > 2;
  const rightBreak = end < total - 1;
  const pages = [1];
  if (start > 2) pages.push('…L');
  for (let i = start; i <= end; i++) if (i !== 1 && i !== total) pages.push(i);
  if (end < total - 1) pages.push('…R');
  pages.push(total);
  return { pages, leftBreak, rightBreak };
}

function jumpTo(p) {
  if (p === page) return;
  page = p;
  refresh();
}

function renderPageSizeDropdown() {
  const dd = $('#pageSizeDropdown');
  dd.innerHTML = PAGE_SIZE_OPTIONS.map((n) =>
    `<div class="ps-option${n === pageSize ? ' active' : ''}" data-size="${n}">${n} 条/页</div>`
  ).join('');
  dd.querySelectorAll('.ps-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      pageSize = Number(opt.dataset.size);
      page = 1;
      $('#pageSizeDropdown').classList.add('hidden');
      $('#pageSizeSelect').classList.remove('open');
      refresh();
    });
  });
  $('#pageSizeLabel').textContent = `${pageSize} 条/页`;
}

function renderPagination(total, maxPage) {
  const box = $('#pagination');
  box.classList.remove('hidden');
  const { pages } = pagerRange(page, maxPage);
  const pagerBtns = pages.map((p) => {
    if (p === '…L' || p === '…R') {
      const jump = p === '…L' ? Math.max(1, page - PAGER_COUNT) : Math.min(maxPage, page + PAGER_COUNT);
      return `<button type="button" class="pg-more" data-jump="${jump}">…</button>`;
    }
    return `<button type="button" class="pg-num${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
  }).join('');
  const prevDisabled = page <= 1 ? ' disabled' : '';
  const nextDisabled = page >= maxPage ? ' disabled' : '';
  box.innerHTML = `
    <span class="pg-total">共 ${total} 条</span>
    <div class="pg-pager">
      <button type="button" class="pg-prev${prevDisabled}"${prevDisabled ? ' disabled' : ''} data-dir="-1"><</button>
      ${pagerBtns}
      <button type="button" class="pg-next${nextDisabled}"${nextDisabled ? ' disabled' : ''} data-dir="1">></button>
    </div>
    <div id="pageSizeWrap" class="pg-size-wrap">
      <div id="pageSizeSelect" class="pg-size-select">
        <span id="pageSizeLabel">${pageSize} 条/页</span>
        <span class="ms-arrow">▾</span>
      </div>
      <div id="pageSizeDropdown" class="pg-size-dropdown hidden"></div>
    </div>`;
  box.querySelectorAll('.pg-num').forEach((btn) => {
    btn.addEventListener('click', () => jumpTo(Number(btn.dataset.page)));
  });
  box.querySelectorAll('.pg-more').forEach((btn) => {
    btn.addEventListener('click', () => jumpTo(Number(btn.dataset.jump)));
  });
  const prevBtn = box.querySelector('.pg-prev');
  const nextBtn = box.querySelector('.pg-next');
  if (prevBtn && !prevBtn.disabled) prevBtn.addEventListener('click', () => jumpTo(page - 1));
  if (nextBtn && !nextBtn.disabled) nextBtn.addEventListener('click', () => jumpTo(page + 1));
  renderPageSizeDropdown();
}

document.addEventListener('click', (e) => {
  const wrap = $('#pageSizeWrap');
  if (!wrap) return;
  if (e.target.closest('#pageSizeSelect')) {
    e.stopPropagation();
    const dd = $('#pageSizeDropdown');
    dd.classList.toggle('hidden');
    wrap.querySelector('#pageSizeSelect').classList.toggle('open', !dd.classList.contains('hidden'));
    return;
  }
  if (!e.target.closest('#pageSizeWrap')) {
    $('#pageSizeDropdown').classList.add('hidden');
    $('#pageSizeSelect').classList.remove('open');
  }
});

function renderTagFilter() {
  ui.renderTagFilter(tagList, tagFilter, (id, checked) => {
    if (checked) { if (!tagFilter.includes(id)) tagFilter.push(id); }
    else tagFilter = tagFilter.filter((x) => x !== id);
    ui.renderTagSelected(tagFilter);
    page = 1;
    refresh();
  });
  ui.renderTagSelected(tagFilter);
}

function closeTagDropdown() {
  $('#tagFilterDropdown').classList.add('hidden');
  $('#tagFilterControl').classList.remove('open');
}
function closeRangeDropdown() {
  $('#rangeDropdown').classList.add('hidden');
  $('#rangeSelect').classList.remove('open');
}
function closeSortDropdown() {
  const dd = $('#sortDropdown');
  const sel = $('#sortSelect');
  if (dd) dd.classList.add('hidden');
  if (sel) sel.classList.remove('open');
}
function closeStatusDropdown() {
  // 状态已改为分段选择，无下拉可关
}
function closeToolbarPopups({ clearSearch = false } = {}) {
  closeTagDropdown();
  closeRangeDropdown();
  closeSortDropdown();
  closeStatusDropdown();
  if (clearSearch && searchInput) {
    searchInput.value = '';
    if (searchQuery) {
      searchQuery = '';
      page = 1;
      refresh();
    }
    syncFilterBadge();
  }
}
function toggleTagDropdown() {
  const isOpen = !$('#tagFilterDropdown').classList.contains('hidden');
  // 打开标签时先收起其他下拉，避免叠层
  if (!isOpen) {
    closeRangeDropdown();
    closeSortDropdown();
    closeStatusDropdown();
  }
  $('#tagFilterDropdown').classList.toggle('hidden', isOpen);
  $('#tagFilterControl').classList.toggle('open', !isOpen);
}
document.getElementById('tagFilterControl').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleTagDropdown();
});
document.getElementById('tagFilterClear').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!tagFilter.length) return;
  tagFilter = [];
  ui.renderTagSelected(tagFilter);
  renderTagFilter();
  page = 1;
  refresh();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tagFilterWrap')) closeTagDropdown();
});

function renderStatusSeg() {
  const wrap = $('#statusWrap');
  if (!wrap) return;
  wrap.querySelectorAll('.status-seg-btn').forEach((btn) => {
    const on = btn.dataset.filter === filter;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
function selectStatus(key) {
  if (filter === key) return;
  filter = key;
  page = 1;
  renderStatusSeg();
  refresh();
}
const statusWrapEl = document.getElementById('statusWrap');
if (statusWrapEl) {
  statusWrapEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.status-seg-btn');
    if (!btn) return;
    e.stopPropagation();
    closeTagDropdown();
    closeRangeDropdown();
    closeSortDropdown();
    selectStatus(btn.dataset.filter);
  });
}
renderStatusSeg();

function renderRangeDropdown() {
  const dd = $('#rangeDropdown');
  dd.innerHTML = RANGES.map((r) =>
    `<div class="range-option${range === r.key ? ' active' : ''}" data-range="${r.key}">${r.label}</div>`
  ).join('');
  dd.querySelectorAll('.range-option').forEach((opt) => {
    opt.addEventListener('click', () => selectRange(opt.dataset.range));
  });
  $('#rangeSelected').textContent = (RANGES.find((r) => r.key === range) || RANGES[0]).label;
}
function selectRange(key) {
  range = key;
  page = 1;
  renderRangeDropdown();
  closeRangeDropdown();
  syncFilterBadge();
  refresh();
}
document.getElementById('rangeSelect').addEventListener('click', (e) => {
  e.stopPropagation();
  closeTagDropdown();
  closeSortDropdown();
  closeStatusDropdown();
  renderRangeDropdown();
  $('#rangeDropdown').classList.toggle('hidden');
  $('#rangeSelect').classList.toggle('open', !$('#rangeDropdown').classList.contains('hidden'));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#rangeWrap')) closeRangeDropdown();
});

function renderSortDropdown() {
  const dd = $('#sortDropdown');
  if (!dd) return;
  dd.innerHTML = SORTS.map((s) =>
    `<div class="range-option${sortKey === s.key ? ' active' : ''}" data-sort="${s.key}">${s.label}</div>`
  ).join('');
  dd.querySelectorAll('.range-option').forEach((opt) => {
    opt.addEventListener('click', () => selectSort(opt.dataset.sort));
  });
  $('#sortSelected').textContent = (SORTS.find((s) => s.key === sortKey) || SORTS[0]).label;
}
function selectSort(key) {
  sortKey = key;
  page = 1;
  renderSortDropdown();
  closeSortDropdown();
  syncFilterBadge();
  refresh();
}
document.getElementById('sortSelect').addEventListener('click', (e) => {
  e.stopPropagation();
  closeTagDropdown();
  closeRangeDropdown();
  closeStatusDropdown();
  renderSortDropdown();
  $('#sortDropdown').classList.toggle('hidden');
  $('#sortSelect').classList.toggle('open', !$('#sortDropdown').classList.contains('hidden'));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sortWrap')) closeSortDropdown();
});
renderSortDropdown();

// 标题栏：点标题/按钮可收起；中间拖拽区拖窗口时由主进程 will-move 通知收起
const titlebarEl = document.getElementById('titlebar');
if (titlebarEl) {
  titlebarEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('#titlebar-drag')) return;
    closeToolbarPopups();
  });
}
if (typeof API !== 'undefined' && API.onClosePopups) {
  API.onClosePopups(() => closeToolbarPopups());
}
// 二级筛选：排序 / 时间范围 / 搜索（默认收起）
const filtersToggle = document.getElementById('filtersToggle');
const filtersBadge = document.getElementById('filtersBadge');
const filtersReset = document.getElementById('filtersReset');
const toolbarSecondary = document.getElementById('toolbarSecondary');
const searchWrap = document.getElementById('searchWrap');
const searchInput = document.getElementById('searchInput');
let searchTimer = null;
/** 图内搜索插件开启时为 rel→text 映射，否则 null */
let ocrSearchTexts = null;

async function syncOcrSearchPlugin() {
  const defaultPh = '搜索正文或附件名…';
  const ocrPh = '搜索正文、附件或图内文字…';
  try {
    const list = await API.listPlugins();
    const p = (list || []).find((x) => x.id === 'ocr-search');
    if (p && p.enabled) {
      ocrSearchTexts = (await API.ocrIndexGetAll()) || {};
      if (searchInput) searchInput.placeholder = ocrPh;
    } else {
      ocrSearchTexts = null;
      if (searchInput) searchInput.placeholder = defaultPh;
    }
  } catch (_) {
    ocrSearchTexts = null;
    if (searchInput) searchInput.placeholder = defaultPh;
  }
}

window.refreshOcrSearchPlugin = async () => {
  await syncOcrSearchPlugin();
  refresh();
};

syncOcrSearchPlugin();
if (typeof API !== 'undefined' && API.onOcrIndexUpdated) {
  API.onOcrIndexUpdated(() => {
    if (typeof window.refreshOcrSearchPlugin === 'function') window.refreshOcrSearchPlugin();
  });
}

/** 各任务卡片上的图内文字识别进度：taskId -> { current, total, status } */
window.ocrTaskProgress = window.ocrTaskProgress || {};

function patchCardOcrProgress(taskId, p) {
  if (taskId == null || taskId === '') return;
  const card = document.querySelector(`.card[data-task-id="${CSS.escape(String(taskId))}"]`);
  if (!card) return;
  const main = card.querySelector('.card-main');
  if (!main) return;
  let box = main.querySelector('.card-ocr');
  if (!p || p.status === 'done') {
    if (box) box.remove();
    return;
  }
  const cur = p.current || 0;
  const total = p.total || 0;
  const pct = total ? Math.round((cur / total) * 100) : 0;
  if (!box) {
    box = document.createElement('div');
    box.className = 'card-ocr';
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = `<div class="card-ocr-label"></div><div class="card-ocr-track"><div class="card-ocr-fill"></div></div>`;
    main.appendChild(box);
  }
  const label = box.querySelector('.card-ocr-label');
  const fill = box.querySelector('.card-ocr-fill');
  if (label) label.textContent = `识别图内文字 ${cur}/${total}`;
  if (fill) fill.style.width = `${pct}%`;
}

if (typeof API !== 'undefined' && API.onOcrIndexAutoProgress) {
  const hideTimers = {};
  API.onOcrIndexAutoProgress((p) => {
    if (!p || p.taskId == null || p.taskId === '') return;
    const id = String(p.taskId);
    if (p.status === 'start' || p.status === 'progress') {
      if (hideTimers[id]) { clearTimeout(hideTimers[id]); delete hideTimers[id]; }
      window.ocrTaskProgress[id] = {
        current: p.current || 0,
        total: p.total || 0,
        status: p.status,
      };
      patchCardOcrProgress(id, window.ocrTaskProgress[id]);
    } else if (p.status === 'done') {
      window.ocrTaskProgress[id] = {
        current: p.total || 0,
        total: p.total || 0,
        status: 'done',
      };
      patchCardOcrProgress(id, { current: p.total, total: p.total, status: 'progress' });
      const label = document.querySelector(`.card[data-task-id="${CSS.escape(id)}"] .card-ocr-label`);
      if (label) label.textContent = '图内文字识别完成';
      const fill = document.querySelector(`.card[data-task-id="${CSS.escape(id)}"] .card-ocr-fill`);
      if (fill) fill.style.width = '100%';
      hideTimers[id] = setTimeout(() => {
        delete window.ocrTaskProgress[id];
        patchCardOcrProgress(id, null);
        delete hideTimers[id];
      }, 900);
    }
  });
}

function secondaryBaseline() {
  if (typeof loadViewDefaults === 'function') {
    const p = loadViewDefaults();
    return { sortKey: p.sortKey, range: p.range };
  }
  return { sortKey: 'createdAt', range: 'all' };
}

function secondaryFilterCount() {
  const base = secondaryBaseline();
  let n = 0;
  if (sortKey !== base.sortKey) n += 1;
  if (range !== base.range) n += 1;
  if (searchQuery.trim()) n += 1;
  return n;
}

function syncFilterBadge() {
  if (!filtersBadge || !filtersToggle) return;
  const n = secondaryFilterCount();
  if (n > 0) {
    filtersBadge.textContent = String(n);
    filtersBadge.classList.remove('hidden');
    filtersBadge.setAttribute('aria-hidden', 'false');
  } else {
    filtersBadge.classList.add('hidden');
    filtersBadge.setAttribute('aria-hidden', 'true');
  }
  filtersToggle.classList.toggle('has-active', n > 0);
  if (filtersReset) {
    const show = n > 0;
    filtersReset.hidden = !show;
    filtersReset.classList.toggle('hidden', !show);
  }
}

function resetSecondaryFilters() {
  const base = secondaryBaseline();
  let changed = false;
  if (sortKey !== base.sortKey) {
    sortKey = base.sortKey;
    changed = true;
  }
  if (range !== base.range) {
    range = base.range;
    changed = true;
  }
  if (searchQuery || (searchInput && searchInput.value)) {
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    changed = true;
  }
  closeSortDropdown();
  closeRangeDropdown();
  renderSortDropdown();
  renderRangeDropdown();
  syncFilterBadge();
  if (changed) {
    page = 1;
    refresh();
  }
}

function setFiltersExpanded(open) {
  filtersExpanded = !!open;
  if (!toolbarSecondary || !filtersToggle) return;
  toolbarSecondary.hidden = !filtersExpanded;
  toolbarSecondary.classList.toggle('hidden', !filtersExpanded);
  filtersToggle.classList.toggle('open', filtersExpanded);
  filtersToggle.setAttribute('aria-expanded', filtersExpanded ? 'true' : 'false');
  filtersToggle.setAttribute('aria-label', filtersExpanded ? '收起筛选' : '展开筛选');
  filtersToggle.title = filtersExpanded ? '收起筛选' : '筛选';
  if (filtersExpanded && searchInput) {
    requestAnimationFrame(() => searchInput.focus());
  } else {
    closeSortDropdown();
    closeRangeDropdown();
  }
}

function toggleFiltersExpanded() {
  setFiltersExpanded(!filtersExpanded);
}

if (filtersToggle) {
  filtersToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTagDropdown();
    closeStatusDropdown();
    toggleFiltersExpanded();
  });
}
if (filtersReset) {
  filtersReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetSecondaryFilters();
  });
}
setFiltersExpanded(false);
syncFilterBadge();

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value || '';
      page = 1;
      syncFilterBadge();
      refresh();
    }, 200);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      if (searchQuery) {
        searchQuery = '';
        page = 1;
        refresh();
      }
      syncFilterBadge();
      searchInput.blur();
    }
  });
}
