/** 应用检查更新 + 侧载安装（不覆盖正在运行的 exe） */

const path = require('path');
const fs = require('fs');

/** 发版时更新仓库中的 docs/kanban-latest.json（version / notes / url） */
const UPDATE_FEED_URL =
  'https://raw.githubusercontent.com/ITimesGo/task-kanban/main/docs/kanban-latest.json';

const HANDOFF_FILE = 'update-handoff.json'; // 旧方案残留，启动时清理
const INSTALL_SUBDIR = 'install';
const CURRENT_FILE = 'current.json';

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

function toBase64Utf8(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

function installDir(userDataDir) {
  return path.join(String(userDataDir || ''), INSTALL_SUBDIR);
}

function currentPointerPath(userDataDir) {
  return path.join(installDir(userDataDir), CURRENT_FILE);
}

function readCurrentPointer(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(currentPointerPath(userDataDir), 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeCurrentPointer(userDataDir, payload) {
  const dir = installDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(currentPointerPath(userDataDir), JSON.stringify(payload, null, 2), 'utf8');
}

function handoffPath(userDataDir) {
  return path.join(String(userDataDir || ''), HANDOFF_FILE);
}

function clearHandoff(userDataDir) {
  try { fs.unlinkSync(handoffPath(userDataDir)); } catch (_) { /* ignore */ }
}

/** 从下载 URL 或 version 生成安装文件名 */
function installExeName(version, url) {
  const ver = String(version || '').trim() || 'update';
  try {
    const base = path.basename(new URL(String(url || '')).pathname);
    if (base && /\.exe$/i.test(base)) return decodeURIComponent(base);
  } catch (_) { /* ignore */ }
  return `task-kanban-${ver}.exe`;
}

/**
 * 旧进程退出后：创建/更新桌面快捷方式 → 启动新 exe（新文件，无覆盖冲突）。
 */
function buildSideBySideLaunchScript({
  pid,
  parentPid = 0,
  newExePath,
  shortcutPath = '',
  logPath = '',
} = {}) {
  const pidNum = Number(pid);
  if (!Number.isFinite(pidNum) || pidNum <= 0) throw new Error('invalid pid');
  const parentNum = Number(parentPid);
  const waitParent = Number.isFinite(parentNum) && parentNum > 0 && parentNum !== pidNum;
  const newB64 = toBase64Utf8(newExePath);
  const shortcutB64 = shortcutPath ? toBase64Utf8(shortcutPath) : '';
  const logB64 = logPath ? toBase64Utf8(logPath) : '';

  return [
    "$ErrorActionPreference = 'Continue'",
    `function Decode-B64([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }`,
    `$newExe = Decode-B64 '${newB64}'`,
    shortcutB64 ? `$shortcut = Decode-B64 '${shortcutB64}'` : `$shortcut = ''`,
    logB64
      ? `$log = Decode-B64 '${logB64}'`
      : `$log = Join-Path $env:TEMP ('kanban-launch-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '.log')`,
    `function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + $m) -Encoding UTF8 } catch {} }`,
    `Log ('side-by-side launch ' + $newExe)`,
    `$pids = @(${pidNum}${waitParent ? `,${parentNum}` : ''})`,
    'foreach ($p in $pids) {',
    '  while (Get-Process -Id $p -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
    '}',
    'Start-Sleep -Milliseconds 800',
    'if (-not (Test-Path -LiteralPath $newExe)) { Log "new exe missing"; throw "new exe missing" }',
    'if ($shortcut) {',
    '  try {',
    '    $shell = New-Object -ComObject WScript.Shell',
    '    $lnk = $shell.CreateShortcut($shortcut)',
    '    $lnk.TargetPath = $newExe',
    '    $lnk.WorkingDirectory = Split-Path -Parent $newExe',
    '    $lnk.IconLocation = ($newExe + ",0")',
    '    $lnk.Save()',
    '    Log ("shortcut ok " + $shortcut)',
    '  } catch { Log ("shortcut fail: " + $_.Exception.Message) }',
    '}',
    'Start-Process -FilePath $newExe',
    'Log "started"',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');
}

/** 清理 install 目录里非当前版本的旧包 */
function cleanupOldInstalls(userDataDir, keepExePath) {
  const dir = installDir(userDataDir);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  const keep = path.resolve(String(keepExePath || '')).toLowerCase();
  for (const name of names) {
    if (!/\.exe$/i.test(name)) continue;
    const full = path.join(dir, name);
    if (keep && path.resolve(full).toLowerCase() === keep) continue;
    try { fs.unlinkSync(full); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  UPDATE_FEED_URL,
  HANDOFF_FILE,
  INSTALL_SUBDIR,
  parseVersion,
  compareVersions,
  evaluateUpdate,
  toBase64Utf8,
  installDir,
  readCurrentPointer,
  writeCurrentPointer,
  handoffPath,
  clearHandoff,
  installExeName,
  buildSideBySideLaunchScript,
  cleanupOldInstalls,
};
