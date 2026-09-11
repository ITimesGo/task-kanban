/** 应用检查更新：版本比较与 feed 判定（纯逻辑，便于单测） */

const path = require('path');

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

/** PowerShell 单引号字面量（路径含空格/中文） */
function psSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function toBase64Utf8(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

/**
 * portable 包运行时会解压到临时目录，process.execPath 指向临时文件。
 * electron-builder 会设置 PORTABLE_EXECUTABLE_FILE 为用户真正双击的那个 exe。
 */
function resolveUpdateTargetPath({ isPackaged, execPath, env = process.env } = {}) {
  if (isPackaged) {
    const portable = String(env.PORTABLE_EXECUTABLE_FILE || '').trim();
    if (portable) return portable;
    const dir = String(env.PORTABLE_EXECUTABLE_DIR || '').trim();
    const name = String(env.PORTABLE_EXECUTABLE_APP_FILENAME || '').trim();
    if (dir && name) {
      return path.join(dir, /\.exe$/i.test(name) ? name : `${name}.exe`);
    }
  }
  return String(execPath || '');
}

/** 是否像解压后的临时目录（绝不能当作“用户的 exe”去覆盖） */
function isExtractedTempPath(filePath, tmpDir = require('os').tmpdir()) {
  const p = String(filePath || '').replace(/\//g, '\\').toLowerCase();
  if (!p) return true;
  const tmp = String(tmpDir || '').replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
  if (tmp && p.startsWith(tmp + '\\')) return true;
  if (p.includes('\\temp\\') || p.includes('\\tmp\\')) return true;
  if (p.includes('\\appdata\\local\\temp\\')) return true;
  // electron-builder portable 默认解到 %TEMP%\<uuid>\ 或 $PLUGINSDIR
  if (p.includes('\\pluginsdir\\')) return true;
  return false;
}

/**
 * 生成替换脚本。路径用 Base64 传入，避免 ps1 文件编码把中文路径弄坏。
 * 下载包放在临时目录；成功则覆盖用户原来的 exe 并删临时包；失败则挪到「下载」文件夹，避免桌面留下 kanban-update-*.exe。
 */
function buildApplyUpdateScript({
  pid,
  parentPid = 0,
  sourcePath,
  targetPath,
  logPath = '',
  fallbackDir = '',
} = {}) {
  const pidNum = Number(pid);
  if (!Number.isFinite(pidNum) || pidNum <= 0) {
    throw new Error('invalid pid');
  }
  const parentNum = Number(parentPid);
  const waitParent = Number.isFinite(parentNum) && parentNum > 0 && parentNum !== pidNum;
  const srcB64 = toBase64Utf8(sourcePath);
  const dstB64 = toBase64Utf8(targetPath);
  const logB64 = logPath ? toBase64Utf8(logPath) : '';
  const fallbackB64 = fallbackDir ? toBase64Utf8(fallbackDir) : '';

  return [
    "$ErrorActionPreference = 'Continue'",
    `function Decode-B64([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }`,
    `$src = Decode-B64 '${srcB64}'`,
    `$dst = Decode-B64 '${dstB64}'`,
    logB64
      ? `$log = Decode-B64 '${logB64}'`
      : `$log = Join-Path $env:TEMP ('kanban-update-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '.log')`,
    fallbackB64
      ? `$fallbackDir = Decode-B64 '${fallbackB64}'`
      : `$fallbackDir = [Environment]::GetFolderPath('UserProfile') + '\\Downloads'`,
    `function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + $m) -Encoding UTF8 } catch {} }`,
    `Log ('start src=' + $src)`,
    `Log ('start dst=' + $dst)`,
    `$pids = @(${pidNum}${waitParent ? `,${parentNum}` : ''})`,
    `Log ('wait pids=' + ($pids -join ','))`,
    'foreach ($p in $pids) {',
    '  while (Get-Process -Id $p -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
    '}',
    'Start-Sleep -Milliseconds 1000',
    'function Test-ExclusiveWrite([string]$path) {',
    '  try {',
    "    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
    '    $fs.Close()',
    '    return $true',
    '  } catch { return $false }',
    '}',
    '$ready = $false',
    'for ($i = 1; $i -le 120; $i++) {',
    '  if (-not (Test-Path -LiteralPath $dst)) { $ready = $true; break }',
    '  if (Test-ExclusiveWrite $dst) { $ready = $true; break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'if (-not $ready) { Log "target still locked"; throw "target still locked" }',
    'Log "target unlocked"',
    '$srcLen = (Get-Item -LiteralPath $src).Length',
    '$copied = $false',
    'for ($i = 1; $i -le 50; $i++) {',
    '  try {',
    '    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force -ErrorAction Stop }',
    '    Move-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop',
    '    $dstLen = (Get-Item -LiteralPath $dst).Length',
    '    if ($dstLen -ne $srcLen) { throw "size mismatch" }',
    '    $copied = $true',
    '    Log ("replaced ok size=" + $dstLen)',
    '    break',
    '  } catch {',
    '    Log ("replace try " + $i + " fail: " + $_.Exception.Message)',
    '    try {',
    '      Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop',
    '      $dstLen = (Get-Item -LiteralPath $dst).Length',
    '      if ($dstLen -ne $srcLen) { throw "size mismatch" }',
    '      Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue',
    '      $copied = $true',
    '      Log ("copied ok size=" + $dstLen)',
    '      break',
    '    } catch {',
    '      Log ("copy try " + $i + " fail: " + $_.Exception.Message)',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '  }',
    '}',
    'if (-not $copied) {',
    '  try {',
    '    if (-not (Test-Path -LiteralPath $fallbackDir)) { New-Item -ItemType Directory -Path $fallbackDir -Force | Out-Null }',
    "    $fb = Join-Path $fallbackDir ('task-kanban-update-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '.exe')",
    '    Move-Item -LiteralPath $src -Destination $fb -Force',
    '    Log ("fallback moved to " + $fb)',
    '  } catch { Log ("fallback move fail: " + $_.Exception.Message) }',
    '  throw "failed to replace executable"',
    '}',
    'if (Test-Path -LiteralPath $src) { Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue }',
    'Start-Process -FilePath $dst',
    'Log "started"',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');
}

module.exports = {
  UPDATE_FEED_URL,
  parseVersion,
  compareVersions,
  evaluateUpdate,
  psSingleQuote,
  toBase64Utf8,
  resolveUpdateTargetPath,
  isExtractedTempPath,
  buildApplyUpdateScript,
};
