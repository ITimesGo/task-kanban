/** 应用检查更新：版本比较与 feed 判定（纯逻辑，便于单测） */

/** 发版时更新仓库中的 docs/kanban-latest.json（version / notes / url） */
const UPDATE_FEED_URL =
  'https://raw.githubusercontent.com/ITimesGo/task-kanban/main/docs/kanban-latest.json';

function parseVersion(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^v/i, '');
  const parts = s.split(/[.+-]/).filter(Boolean).slice(0, 3);
  const nums = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    nums[i] = Number.isFinite(n) ? n : 0;
  }
  return nums;
}

/** @returns {-1|0|1} a<b / equal / a>b */
function compareVersions(a, b) {
  const aa = parseVersion(a);
  const bb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (aa[i] < bb[i]) return -1;
    if (aa[i] > bb[i]) return 1;
  }
  return 0;
}

/**
 * @param {string} localVersion
 * @param {object|null} feed
 * @returns {{ status: 'available'|'latest'|'invalid', current?: string, latest?: string, url?: string, notes?: string, error?: string }}
 */
function evaluateUpdate(localVersion, feed) {
  if (!feed || typeof feed !== 'object') {
    return { status: 'invalid', error: '更新信息不完整' };
  }
  const latest = String(feed.version || '').trim();
  const url = String(feed.url || '').trim();
  if (!latest || !url) {
    return { status: 'invalid', error: '更新信息不完整（需要 version 与 url）' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { status: 'invalid', error: '下载地址无效' };
  }
  const current = String(localVersion || '').trim() || '0.0.0';
  if (compareVersions(current, latest) < 0) {
    return {
      status: 'available',
      current,
      latest,
      url,
      notes: feed.notes != null ? String(feed.notes) : '',
    };
  }
  return { status: 'latest', current, latest };
}

module.exports = {
  UPDATE_FEED_URL,
  parseVersion,
  compareVersions,
  evaluateUpdate,
};
