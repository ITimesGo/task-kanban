/**
 * Windows 桌面/开始菜单快捷方式修复：
 * - 图标指向 %LOCALAPPDATA%\{product}\app.ico（安装目录外，内容不变不覆盖）
 * - 写入 AppUserModelId，与 app.setAppUserModelId / electron-builder appId 对齐
 * 避免每次重装覆盖 $INSTDIR 内 ico/exe 时桌面图标闪动。
 */
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const AUMI = 'com.local.taskkanban';

/** %LOCALAPPDATA%\{productName}\app.ico —— 与 installer.nsh 一致 */
function resolveStableIconPath(productName) {
  const local = process.env.LOCALAPPDATA;
  if (!local) return path.join(app.getPath('userData'), 'app.ico');
  return path.join(local, productName || '任务看板', 'app.ico');
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (_) { return -1; }
}

function ensureStableIcon(srcIco, destIco) {
  if (!srcIco || !fs.existsSync(srcIco)) {
    return destIco && fs.existsSync(destIco) ? destIco : '';
  }
  try {
    fs.mkdirSync(path.dirname(destIco), { recursive: true });
  } catch (_) { /* ignore */ }
  const srcSz = fileSize(srcIco);
  const dstSz = fileSize(destIco);
  if (dstSz < 0 || srcSz !== dstSz) {
    try {
      fs.copyFileSync(srcIco, destIco);
    } catch (_) {
      return fs.existsSync(destIco) ? destIco : srcIco;
    }
  }
  return fs.existsSync(destIco) ? destIco : srcIco;
}

function collectShortcutCandidates(productName) {
  const name = `${productName}.lnk`;
  const desktop = app.getPath('desktop');
  const startMenu = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  return [
    path.join(desktop, name),
    path.join(desktop, 'applications', name),
    path.join(startMenu, name),
  ].filter((p) => {
    try { return fs.existsSync(p); } catch (_) { return false; }
  });
}

function needsRepair(details, exePath, iconPath) {
  if (!details) return true;
  const target = String(details.target || '').toLowerCase();
  const exe = String(exePath || '').toLowerCase();
  if (target !== exe) return true; // 空 target 或旧路径：一并修好
  const icon = String(details.icon || '').toLowerCase();
  const want = String(iconPath || '').toLowerCase();
  const aumi = String(details.appUserModelId || '');
  if (aumi !== AUMI) return true;
  if (want && icon !== want) return true;
  return false;
}

/**
 * @param {{ productName?: string, exePath?: string, installIcon?: string }} opts
 */
function repairWindowsShortcuts(opts = {}) {
  if (process.platform !== 'win32' || !app.isPackaged) return;

  const productName = opts.productName || app.getName() || '任务看板';
  const marker = path.join(resolveStableIconPath(productName), '..', '.shortcut-ok');
  // 已修好过则跳过（避免每次启动写 .lnk 触发壳层刷新卡顿）
  try {
    if (fs.existsSync(marker) && !opts.force) {
      const age = Date.now() - fs.statSync(marker).mtimeMs;
      if (age < 7 * 24 * 3600 * 1000) return;
    }
  } catch (_) { /* ignore */ }

  const exePath = opts.exePath || process.execPath;
  const installDir = path.dirname(exePath);
  const installIcon = opts.installIcon
    || path.join(installDir, 'uninstallerIcon.ico');
  const stableIcon = ensureStableIcon(installIcon, resolveStableIconPath(productName));
  if (!stableIcon) return;

  let wrote = false;
  for (const lnk of collectShortcutCandidates(productName)) {
    let details = null;
    try { details = shell.readShortcutLink(lnk); } catch (_) { details = null; }

    if (details && details.target) {
      const t = String(details.target).toLowerCase();
      const exe = String(exePath).toLowerCase();
      if (t !== exe && !t.includes('task-kanban') && !t.includes(productName.toLowerCase())) {
        continue;
      }
    }

    if (!needsRepair(details, exePath, stableIcon) && details) continue;

    try {
      shell.writeShortcutLink(lnk, details ? 'update' : 'replace', {
        target: exePath,
        cwd: installDir,
        description: (details && details.description) || productName,
        icon: stableIcon,
        iconIndex: 0,
        appUserModelId: AUMI,
      });
      wrote = true;
    } catch (_) { /* ignore */ }
  }
  if (wrote || fs.existsSync(stableIcon)) {
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, String(Date.now()), 'utf8');
    } catch (_) { /* ignore */ }
  }
}

module.exports = {
  AUMI,
  repairWindowsShortcuts,
  resolveStableIconPath,
  ensureStableIcon,
};
