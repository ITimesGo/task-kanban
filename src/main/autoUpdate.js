/**
 * 基于 electron-updater 的自动更新（NSIS 安装版）。
 * 流程：检查 → 下载 → quitAndInstall → 安装并自动重启。
 */
const { app, net } = require('electron');
const { compareVersions, isPortableBuild } = require('./appUpdate');

let autoUpdater = null;
let configured = false;
let downloading = false;

function normalizeNotes(raw) {
  if (raw == null) return '';
  if (Array.isArray(raw)) {
    return raw
      .map((n) => (typeof n === 'string' ? n : (n && n.note) || ''))
      .filter(Boolean)
      .join('\n');
  }
  return String(raw);
}

/** 去掉 GitHub / electron-updater 可能返回的 HTML，保留换行与列表感 */
function notesToPlainText(notes) {
  let s = String(notes || '');
  if (!s) return '';
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fetchGithubReleaseBody(version) {
  const tags = [`v${version}`, String(version)];
  const tryOne = (url) => new Promise((resolve) => {
    try {
      const req = net.request({
        method: 'GET',
        url,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'task-kanban-updater',
        },
      });
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString('utf8'); });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve('');
            return;
          }
          try {
            const json = JSON.parse(body);
            resolve(notesToPlainText(json.body || ''));
          } catch (_) {
            resolve('');
          }
        });
      });
      req.on('error', () => resolve(''));
      req.end();
    } catch (_) {
      resolve('');
    }
  });

  return (async () => {
    for (const tag of tags) {
      const text = await tryOne(
        `https://api.github.com/repos/ITimesGo/task-kanban/releases/tags/${encodeURIComponent(tag)}`
      );
      if (text) return text;
    }
    return '';
  })();
}

function getAutoUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
  }
  return autoUpdater;
}

function configure() {
  if (configured) return;
  configured = true;
  const updater = getAutoUpdater();
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  try {
    updater.setFeedURL({
      provider: 'github',
      owner: 'ITimesGo',
      repo: 'task-kanban',
    });
  } catch (_) { /* ignore */ }
}

function send(win, channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch (_) { /* ignore */ }
}

/**
 * @param {{ ipcHandle: Function, getWin: () => any }} opts
 */
function registerUpdateIpc({ ipcHandle, getWin }) {
  configure();

  ipcHandle('app:getVersion', () => app.getVersion());

  ipcHandle('update:check', async () => {
    const current = app.getVersion();
    if (!app.isPackaged) {
      return {
        ok: true,
        status: 'latest',
        current,
        latest: current,
        message: '开发模式不检查远程更新',
      };
    }
    if (isPortableBuild()) {
      return {
        ok: false,
        current,
        code: 'PORTABLE',
        error: '当前是便携版，无法自动安装更新。请下载并运行安装包（task-kanban-setup-*.exe），之后即可一键升级并自动重启。',
      };
    }
    try {
      const updater = getAutoUpdater();
      const result = await updater.checkForUpdates();
      const info = result && result.updateInfo;
      const latest = info && info.version ? String(info.version) : '';
      if (!latest) {
        return { ok: true, status: 'latest', current, latest: current };
      }
      let notes = notesToPlainText(normalizeNotes(info.releaseNotes));
      if (!notes && latest) {
        try { notes = await fetchGithubReleaseBody(latest); } catch (_) { /* ignore */ }
      }
      if (compareVersions(current, latest) < 0) {
        return {
          ok: true,
          status: 'available',
          current,
          latest,
          notes: notes.slice(0, 8000),
        };
      }
      return { ok: true, status: 'latest', current, latest };
    } catch (err) {
      return {
        ok: false,
        current,
        error: (err && err.message) || '检查更新失败（请确认 GitHub Release 已上传 setup 与 latest.yml）',
      };
    }
  });

  ipcHandle('update:download', async () => {
    const current = app.getVersion();
    if (!app.isPackaged) {
      return { ok: false, error: '开发模式不支持安装更新' };
    }
    if (isPortableBuild()) {
      return {
        ok: false,
        error: '便携版请改用安装包。下载 task-kanban-setup-*.exe 安装后即可自动更新。',
        code: 'PORTABLE',
      };
    }
    if (downloading) {
      return { ok: false, error: '正在下载更新，请稍候' };
    }

    downloading = true;
    const win = typeof getWin === 'function' ? getWin() : null;
    const updater = getAutoUpdater();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        downloading = false;
        updater.removeListener('download-progress', onProgress);
        updater.removeListener('update-downloaded', onDownloaded);
        updater.removeListener('error', onError);
        resolve(payload);
      };

      const onProgress = (p) => {
        const percent = p && typeof p.percent === 'number' ? Math.round(p.percent) : null;
        send(win, 'update:downloadProgress', {
          percent,
          transferred: p && p.transferred,
          total: p && p.total,
        });
      };

      const onDownloaded = () => {
        send(win, 'update:downloadProgress', { percent: 100 });
        finish({
          ok: true,
          applied: true,
          message: '下载完成，正在退出并安装，随后会自动打开新版本…',
        });
        setTimeout(() => {
          try {
            // true = 静默安装：沿用已有目录，不弹出「选用户/选目录」向导
            updater.quitAndInstall(true, true);
          } catch (_) {
            try { app.quit(); } catch (__) { /* ignore */ }
          }
        }, 600);
      };

      const onError = (err) => {
        finish({
          ok: false,
          error: (err && err.message) || '下载或安装更新失败',
        });
      };

      updater.on('download-progress', onProgress);
      updater.once('update-downloaded', onDownloaded);
      updater.once('error', onError);

      updater.downloadUpdate().catch((err) => {
        onError(err || new Error('downloadUpdate failed'));
      });
    });
  });
}

module.exports = {
  configure,
  registerUpdateIpc,
  isPortableBuild,
};
