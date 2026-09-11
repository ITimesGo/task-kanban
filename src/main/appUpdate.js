/** 应用检查更新：版本比较与 feed 判定（纯逻辑，便于单测） */

const path = require('path');
const fs = require('fs');

/** 发版时更新仓库中的 docs/kanban-latest.json（version / notes / url） */
const UPDATE_FEED_URL =
  'https://raw.githubusercontent.com/ITimesGo/task-kanban/main/docs/kanban-latest.json';

const HANDOFF_FILE = 'update-handoff.json';
const SELF_UPDATE_FLAG = '--kanban-self-update';

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
  if (p.includes('\\pluginsdir\\')) return true;
  return false;
}

function handoffPath(userDataDir) {
  return path.join(String(userDataDir || ''), HANDOFF_FILE);
}

function writeHandoff(userDataDir, payload) {
  const dir = String(userDataDir || '');
  if (!dir) throw new Error('userDataDir required');
  fs.mkdirSync(dir, { recursive: true });
  const file = handoffPath(dir);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

function readHandoff(userDataDir) {
  try {
    const raw = fs.readFileSync(handoffPath(userDataDir), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (_) {
    return null;
  }
}

function clearHandoff(userDataDir) {
  try { fs.unlinkSync(handoffPath(userDataDir)); } catch (_) { /* ignore */ }
}

/**
 * 旧进程退出后，在外部脚本里：复制新包 → 覆盖用户原来的 exe → 启动原路径。
 * 绝不能在「正从原路径运行」的进程里 copy 覆盖自己（会 EBUSY）。
 */
function buildReplaceAndLaunchScript({
  pid,
  parentPid = 0,
  newExePath,
  targetPath,
  logPath = '',
  handoffJsonPath = '',
} = {}) {
  const pidNum = Number(pid);
  if (!Number.isFinite(pidNum) || pidNum <= 0) {
    throw new Error('invalid pid');
  }
  const parentNum = Number(parentPid);
  const waitParent = Number.isFinite(parentNum) && parentNum > 0 && parentNum !== pidNum;
  const newB64 = toBase64Utf8(newExePath);
  const dstB64 = toBase64Utf8(targetPath);
  const logB64 = logPath ? toBase64Utf8(logPath) : '';
  const hoB64 = handoffJsonPath ? toBase64Utf8(handoffJsonPath) : '';

  return [
    "$ErrorActionPreference = 'Continue'",
    `function Decode-B64([string]$b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }`,
    `$newExe = Decode-B64 '${newB64}'`,
    `$dst = Decode-B64 '${dstB64}'`,
    logB64
      ? `$log = Decode-B64 '${logB64}'`
      : `$log = Join-Path $env:TEMP ('kanban-replace-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '.log')`,
    hoB64 ? `$handoff = Decode-B64 '${hoB64}'` : `$handoff = ''`,
    `function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + $m) -Encoding UTF8 } catch {} }`,
    `Log ('replace newExe=' + $newExe)`,
    `Log ('replace dst=' + $dst)`,
    `$pids = @(${pidNum}${waitParent ? `,${parentNum}` : ''})`,
    `Log ('wait pids=' + ($pids -join ','))`,
    'foreach ($p in $pids) {',
    '  while (Get-Process -Id $p -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
    '}',
    'Start-Sleep -Milliseconds 1500',
    'function Test-ExclusiveWrite([string]$path) {',
    '  try {',
    "    if (-not (Test-Path -LiteralPath $path)) { return $true }",
    "    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
    '    $fs.Close()',
    '    return $true',
    '  } catch { return $false }',
    '}',
    '$ready = $false',
    'for ($i = 1; $i -le 120; $i++) {',
    '  if (Test-ExclusiveWrite $dst) { $ready = $true; break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'if (-not $ready) { Log "dst still locked"; throw "dst still locked" }',
    'if (-not (Test-Path -LiteralPath $newExe)) { Log "new exe missing"; throw "new exe missing" }',
    '$srcLen = (Get-Item -LiteralPath $newExe).Length',
    '$ok = $false',
    'for ($i = 1; $i -le 40; $i++) {',
    '  try {',
    '    Copy-Item -LiteralPath $newExe -Destination $dst -Force',
    '    $dstLen = (Get-Item -LiteralPath $dst).Length',
    '    if ($dstLen -ne $srcLen) { throw "size mismatch" }',
    '    $ok = $true',
    '    Log ("copied ok size=" + $dstLen)',
    '    break',
    '  } catch {',
    '    Log ("copy try " + $i + " fail: " + $_.Exception.Message)',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    'if (-not $ok) { throw "copy failed" }',
    'try { Remove-Item -LiteralPath $newExe -Force -ErrorAction SilentlyContinue } catch {}',
    'if ($handoff) { try { Remove-Item -LiteralPath $handoff -Force -ErrorAction SilentlyContinue } catch {} }',
    'Start-Process -FilePath $dst',
    'Log "started dst"',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');
}

/** @deprecated 保留别名，避免旧引用报错 */
function buildHandoffScript(opts) {
  return buildReplaceAndLaunchScript({
    ...opts,
    targetPath: opts.targetPath || opts.newExePath,
    newExePath: opts.newExePath,
  });
}

/**
 * 把当前正在运行的新 portable 包复制到用户原来的快捷方式/桌面路径。
 * 若 source/target 相同，或目标正被本进程占用，不要调用。
 */
function copyPortableOverTarget(sourcePath, targetPath) {
  const src = String(sourcePath || '');
  const dst = String(targetPath || '');
  if (!src || !dst) return { ok: false, error: 'missing path' };
  if (path.resolve(src).toLowerCase() === path.resolve(dst).toLowerCase()) {
    return { ok: true, skipped: true };
  }
  if (!fs.existsSync(src)) return { ok: false, error: 'source missing' };
  try {
    fs.copyFileSync(src, dst);
    const a = fs.statSync(src).size;
    const b = fs.statSync(dst).size;
    if (a !== b) return { ok: false, error: `size mismatch ${a} vs ${b}` };
    return { ok: true, bytes: a };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

module.exports = {
  UPDATE_FEED_URL,
  HANDOFF_FILE,
  SELF_UPDATE_FLAG,
  parseVersion,
  compareVersions,
  evaluateUpdate,
  toBase64Utf8,
  resolveUpdateTargetPath,
  isExtractedTempPath,
  handoffPath,
  writeHandoff,
  readHandoff,
  clearHandoff,
  buildReplaceAndLaunchScript,
  buildHandoffScript,
  copyPortableOverTarget,
};
