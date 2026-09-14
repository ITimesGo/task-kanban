/** 版本比较（纯逻辑，便于单测） */

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

/** @returns {-1|0|1} */
function compareVersions(a, b) {
  const aa = parseVersion(a);
  const bb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (aa[i] < bb[i]) return -1;
    if (aa[i] > bb[i]) return 1;
  }
  return 0;
}

/** 是否 portable 单文件（electron-updater 不支持对此类包做静默安装） */
function isPortableBuild(env = process.env) {
  return !!(env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR);
}

module.exports = {
  parseVersion,
  compareVersions,
  isPortableBuild,
};
