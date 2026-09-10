// 独立工具：清理 attachment/images 目录里不被任何任务引用的孤儿文件
//（历史 bug 曾导致删除任务/附件后文件未删）。
//
// 用法（需在项目根目录、且设置了 ELECTRON_RUN_AS_NODE 环境时用 node 直接跑）：
//   node src/main/cleanupOrphans.js            # 试运行：只列出，不删除
//   node src/main/cleanupOrphans.js --apply    # 真正删除
//
// 存储目录解析复用 storage.js 的逻辑（含自定义路径）。

const fs = require('fs');
const path = require('path');

const storage = require('./storage');

function resolveStorageDir() {
  // 与主进程一致：APPDATA 下默认目录 TaskApp 里读 config.json 的自定义路径
  const appDataRoot = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
  return storage.resolveStoragePath(appDataRoot);
}

function toPosixRel(kind, parts) {
  return [kind, ...parts].join('/');
}

/** 递归收集 kind 下所有文件的 POSIX rel */
function walkFiles(kindRoot, kind, parts, out) {
  const abs = path.join(kindRoot, ...parts);
  let entries;
  try { entries = fs.readdirSync(abs); } catch (_) { return; }
  for (const name of entries) {
    const childAbs = path.join(abs, name);
    let st;
    try { st = fs.statSync(childAbs); } catch (_) { continue; }
    if (st.isDirectory()) {
      walkFiles(kindRoot, kind, parts.concat(name), out);
    } else if (st.isFile()) {
      out.push({ abs: childAbs, rel: toPosixRel(kind, parts.concat(name)) });
    }
  }
}

function rmEmptyDirs(absDir) {
  let entries;
  try { entries = fs.readdirSync(absDir); } catch (_) { return; }
  for (const name of entries) {
    const child = path.join(absDir, name);
    let st;
    try { st = fs.statSync(child); } catch (_) { continue; }
    if (st.isDirectory()) rmEmptyDirs(child);
  }
  try {
    if (fs.readdirSync(absDir).length === 0) fs.rmdirSync(absDir);
  } catch (_) {}
}

// 清理指定存储目录下的孤儿文件。返回 { found, deleted, orphans: string[] }
function cleanupOrphans(dir) {
  let found = 0;
  let deleted = 0;
  const orphans = [];

  const tasksFile = path.join(dir, 'tasks.json');
  if (!fs.existsSync(tasksFile)) return { found, deleted, orphans };

  const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));

  // 收集所有被引用的 rel（图片通常是字符串，附件是 {name,rel} 或字符串）
  // 含回收站中的任务，避免误删可恢复内容
  const referenced = new Set();
  const collect = (list) => {
    for (const t of list || []) {
      for (const img of t.images || []) if (typeof img === 'string') referenced.add(img.replace(/\\/g, '/'));
      for (const vid of t.videos || []) if (typeof vid === 'string') referenced.add(vid.replace(/\\/g, '/'));
      for (const m of t.media || []) {
        if (m && typeof m.rel === 'string') referenced.add(m.rel.replace(/\\/g, '/'));
      }
      for (const att of t.attachments || []) {
        if (typeof att === 'string') referenced.add(att.replace(/\\/g, '/'));
        else if (att && att.rel) referenced.add(String(att.rel).replace(/\\/g, '/'));
      }
    }
  };
  collect(tasks);
  const trashFile = path.join(dir, 'trash.json');
  if (fs.existsSync(trashFile)) {
    try { collect(JSON.parse(fs.readFileSync(trashFile, 'utf8'))); } catch (_) {}
  }

  const cleanKind = (subdir) => {
    const absDir = path.join(dir, subdir);
    if (!fs.existsSync(absDir)) return;
    const files = [];
    walkFiles(absDir, subdir, [], files);
    for (const f of files) {
      if (!referenced.has(f.rel)) {
        found++;
        orphans.push(f.rel);
        try { fs.unlinkSync(f.abs); deleted++; } catch (_) {}
      }
    }
    // 删空子目录，保留 kind 根目录本身
    let entries;
    try { entries = fs.readdirSync(absDir); } catch (_) { return; }
    for (const name of entries) {
      const child = path.join(absDir, name);
      try {
        if (fs.statSync(child).isDirectory()) rmEmptyDirs(child);
      } catch (_) {}
    }
  };

  cleanKind('attachments');
  cleanKind('images');
  cleanKind('videos');

  return { found, deleted, orphans };
}

// 直接以命令行运行：node cleanupOrphans.js [--apply]
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const dir = resolveStorageDir();
  console.log('存储目录:', dir);
  const res = cleanupOrphans(dir);
  res.orphans.forEach((r) => console.log('  孤儿: ' + r));
  console.log(`\n共发现 ${res.found} 个未被引用的文件${apply ? `，已删除 ${res.deleted} 个` : '（未删除，加 --apply 真正删除）'}。`);
}

module.exports = { cleanupOrphans };
