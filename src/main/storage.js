const fs = require('fs');
const path = require('path');

// 存储路径管理：默认目录 + 配置持久化 + 数据迁移
function defaultDir(appDataRoot) {
  return path.join(appDataRoot, 'TaskApp');
}

// 配置固定存在默认目录下，这样即使切换存储路径也能读到上次的选择
function configFile(appDataRoot) {
  return path.join(defaultDir(appDataRoot), 'config.json');
}

function resolveStoragePath(appDataRoot) {
  // 读配置，若记录了自定义路径且目录存在则使用，否则用默认目录
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(appDataRoot), 'utf8'));
    if (cfg && cfg.storagePath) {
      return cfg.storagePath;
    }
  } catch (_) {}
  return defaultDir(appDataRoot);
}

function saveStoragePath(appDataRoot, storagePath) {
  const def = defaultDir(appDataRoot);
  fs.mkdirSync(def, { recursive: true });
  const cfg = { storagePath };
  const tmp = configFile(appDataRoot) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, configFile(appDataRoot));
}

// 把 src 目录下的数据复制到 dest（复制而非移动，旧数据保留可回退；同名文件跳过不覆盖）
// 返回 { copied, skipped }
function migrateData(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(path.join(dest, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'videos'), { recursive: true });
  let copied = 0;
  let skipped = 0;

  const copyFile = (name) => {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (!fs.existsSync(s)) return;
    if (fs.existsSync(d)) { skipped++; return; }
    fs.copyFileSync(s, d);
    copied++;
  };

  copyFile('tasks.json');
  copyFile('tags.json');
  copyFile('trash.json');

  const copyDir = (subdir) => {
    const srcDir = path.join(src, subdir);
    const destDir = path.join(dest, subdir);
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, file);
      if (!fs.statSync(s).isFile()) continue;
      const d = path.join(destDir, file);
      if (fs.existsSync(d)) { skipped++; continue; }
      fs.copyFileSync(s, d);
      copied++;
    }
  };
  copyDir('images');
  copyDir('attachments');
  copyDir('videos');
  return { copied, skipped };
}

module.exports = { defaultDir, resolveStoragePath, saveStoragePath, migrateData };
