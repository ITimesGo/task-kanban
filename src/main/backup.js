const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const DATA_FILES = ['tasks.json', 'tags.json', 'trash.json'];
const DATA_DIRS = ['images', 'attachments', 'videos'];

function exportZip(appDataDir, zipPath) {
  const zip = new AdmZip();
  for (const name of DATA_FILES) {
    const abs = path.join(appDataDir, name);
    if (fs.existsSync(abs)) zip.addLocalFile(abs, '', name);
  }
  for (const dir of DATA_DIRS) {
    const abs = path.join(appDataDir, dir);
    if (fs.existsSync(abs)) zip.addLocalFolder(abs, dir);
  }
  zip.writeZip(zipPath);
  return { ok: true, path: zipPath };
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : fallback;
  } catch (_) {
    return fallback;
  }
}

function mergeById(existing, incoming) {
  const ids = new Set(existing.map((x) => x.id));
  let added = 0;
  const out = [...existing];
  for (const item of incoming) {
    if (!item || !item.id || ids.has(item.id)) continue;
    ids.add(item.id);
    out.push(item);
    added++;
  }
  return { list: out, added };
}

function copyDirMerge(srcDir, destDir) {
  let copied = 0;
  let skipped = 0;
  if (!fs.existsSync(srcDir)) return { copied, skipped };
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    const d = path.join(destDir, name);
    if (!fs.statSync(s).isFile()) continue;
    if (fs.existsSync(d)) { skipped++; continue; }
    fs.copyFileSync(s, d);
    copied++;
  }
  return { copied, skipped };
}

/** 将 zip 合并导入到 appDataDir（同 id / 同名文件跳过） */
function importZip(zipPath, appDataDir) {
  if (!fs.existsSync(zipPath)) return { ok: false, error: '备份文件不存在' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-import-'));
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tmp, true);

    const tasksPath = path.join(appDataDir, 'tasks.json');
    const tagsPath = path.join(appDataDir, 'tags.json');
    const trashPath = path.join(appDataDir, 'trash.json');

    const taskMerge = mergeById(
      readJsonSafe(tasksPath, []),
      readJsonSafe(path.join(tmp, 'tasks.json'), [])
    );
    const tagMerge = mergeById(
      readJsonSafe(tagsPath, []),
      readJsonSafe(path.join(tmp, 'tags.json'), [])
    );
    const trashMerge = mergeById(
      readJsonSafe(trashPath, []),
      readJsonSafe(path.join(tmp, 'trash.json'), [])
    );

    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(tasksPath, JSON.stringify(taskMerge.list, null, 2));
    fs.writeFileSync(tagsPath, JSON.stringify(tagMerge.list, null, 2));
    fs.writeFileSync(trashPath, JSON.stringify(trashMerge.list, null, 2));

    const img = copyDirMerge(path.join(tmp, 'images'), path.join(appDataDir, 'images'));
    const att = copyDirMerge(path.join(tmp, 'attachments'), path.join(appDataDir, 'attachments'));

    return {
      ok: true,
      tasksAdded: taskMerge.added,
      tagsAdded: tagMerge.added,
      trashAdded: trashMerge.added,
      filesCopied: img.copied + att.copied,
      filesSkipped: img.skipped + att.skipped,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { exportZip, importZip, mergeById };
