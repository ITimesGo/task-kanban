const fs = require('fs');
const path = require('path');
const images = require('./images');
const mediaLayout = require('./mediaLayout');

class FileStore {
  #tasks = null;
  #tags = null;
  #trash = null;

  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.imagesDir = path.join(appDataDir, 'images');
    this.attachmentsDir = path.join(appDataDir, 'attachments');
    this.tasksFile = path.join(appDataDir, 'tasks.json');
    this.tagsFile = path.join(appDataDir, 'tags.json');
    this.trashFile = path.join(appDataDir, 'trash.json');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
  }

  #mediaSubdir(tags) {
    return mediaLayout.subdirFor(tags || [], this.loadTags());
  }

  #ensureKindSubdir(kind, subdir) {
    const abs = path.join(this.appDataDir, kind, subdir);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  // 把外部文件拷入 attachments/{subdir}/，返回 { name, rel }
  copyAttachment(srcPath, taskId, origName, opts = {}) {
    const subdir = this.#mediaSubdir(opts.tags);
    const destDir = this.#ensureKindSubdir('attachments', subdir);
    const safeName = path.basename(origName || srcPath);
    const name = mediaLayout.allocConflictName(destDir, safeName, (p) => fs.existsSync(p));
    const abs = path.join(destDir, name);
    fs.copyFileSync(srcPath, abs);
    const rel = mediaLayout.relFor('attachments', subdir, name);
    return { name, rel };
  }

  // 流式拷贝附件，逐块上报进度（0-100）。返回 Promise<{ name, rel }>
  // 签名：copyAttachmentAsync(srcPath, taskId, origName, onProgress, opts?)
  copyAttachmentAsync(srcPath, taskId, origName, onProgress, opts = {}) {
    return new Promise((resolve, reject) => {
      const subdir = this.#mediaSubdir(opts.tags);
      const destDir = this.#ensureKindSubdir('attachments', subdir);
      const safeName = path.basename(origName || srcPath);
      const name = mediaLayout.allocConflictName(destDir, safeName, (p) => fs.existsSync(p));
      const abs = path.join(destDir, name);
      let total = 0;
      try { total = fs.statSync(srcPath).size; } catch (_) {}
      const src = fs.createReadStream(srcPath);
      const dst = fs.createWriteStream(abs);
      let copied = 0;
      src.on('data', (chunk) => {
        copied += chunk.length;
        if (onProgress) onProgress(total ? Math.min(100, Math.round((copied / total) * 100)) : 100);
      });
      src.on('error', reject);
      dst.on('error', reject);
      dst.on('finish', () => resolve({ name, rel: mediaLayout.relFor('attachments', subdir, name) }));
      src.pipe(dst);
    });
  }

  // rels 中的元素可能是字符串 rel，也可能是 { name, rel } 对象，统一提取 rel 再删除
  deleteAttachments(rels) {
    for (const item of rels || []) {
      const rel = typeof item === 'string' ? item : (item && item.rel);
      if (!rel) continue;
      try { fs.unlinkSync(path.join(this.appDataDir, rel)); } catch (_) {}
    }
  }

  loadTags() {
    if (this.#tags === null) this.#tags = this.#readJson(this.tagsFile, []);
    return this.#tags;
  }

  saveTags(tags) {
    this.#tags = tags;
    this.#writeJson(this.tagsFile, tags);
  }

  #readJson(file, fallback) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(data) ? data : fallback;
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      try { fs.renameSync(file, file + '.bak'); } catch (_) {}
      return fallback;
    }
  }

  #writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // 原子写
  }

  loadTasks() {
    if (this.#tasks === null) this.#tasks = this.#readJson(this.tasksFile, []);
    return this.#tasks;
  }

  saveTasks(tasks) {
    this.#tasks = tasks;
    this.#writeJson(this.tasksFile, tasks);
  }

  loadTrash() {
    if (this.#trash === null) this.#trash = this.#readJson(this.trashFile, []);
    return this.#trash;
  }

  saveTrash(list) {
    this.#trash = list;
    this.#writeJson(this.trashFile, list);
  }

  /** 导入/外部改盘后强制从磁盘重载缓存 */
  reloadAll() {
    this.#tasks = null;
    this.#tags = null;
    this.#trash = null;
  }

  // dataUrl -> 写文件，返回相对路径 images/{subdir}/{id}_{i}.{ext}
  copyImage(dataUrl, taskId, index, opts = {}) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error('无效图片数据');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const subdir = this.#mediaSubdir(opts.tags);
    this.#ensureKindSubdir('images', subdir);
    const filename = `${taskId}_${index}.${ext}`;
    const rel = mediaLayout.relFor('images', subdir, filename);
    fs.writeFileSync(path.join(this.appDataDir, rel), Buffer.from(m[2], 'base64'));
    return rel;
  }

  // 从本地路径拷贝（不经 base64）
  copyImageFromPath(srcPath, taskId, index, opts = {}) {
    images.assertImageFile(srcPath);
    let ext = images.extOf(srcPath);
    if (ext === 'jpeg') ext = 'jpg';
    const subdir = this.#mediaSubdir(opts.tags);
    this.#ensureKindSubdir('images', subdir);
    const filename = `${taskId}_${index}.${ext}`;
    const rel = mediaLayout.relFor('images', subdir, filename);
    fs.copyFileSync(srcPath, path.join(this.appDataDir, rel));
    return rel;
  }

  // 统一处理：dataUrl | {srcPath} | 已有相对路径
  ingestImage(item, taskId, index, opts = {}) {
    if (typeof item === 'string' && item.startsWith('data:')) {
      return this.copyImage(item, taskId, index, opts);
    }
    if (item && typeof item === 'object' && item.srcPath) {
      return this.copyImageFromPath(item.srcPath, taskId, index, opts);
    }
    return item;
  }

  readImageDataUrl(rel) {
    const abs = path.join(this.appDataDir, rel);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    const ext = path.extname(rel).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  }

  deleteImages(rels) {
    for (const rel of rels || []) {
      try { fs.unlinkSync(path.join(this.appDataDir, rel)); } catch (_) {}
    }
  }

  safeMove(absFrom, destDirAbs, preferredName) {
    fs.mkdirSync(destDirAbs, { recursive: true });
    const name = mediaLayout.allocConflictName(destDirAbs, preferredName, (p) => fs.existsSync(p));
    const absTo = path.join(destDirAbs, name);
    try {
      fs.renameSync(absFrom, absTo);
    } catch (_) {
      fs.copyFileSync(absFrom, absTo);
      fs.unlinkSync(absFrom);
    }
    return absTo;
  }

  moveMediaForTask(task, tagList) {
    const sub = mediaLayout.subdirFor(task.tags || [], tagList);
    const moveOne = (rel, kind) => {
      if (!rel || typeof rel !== 'string') return rel;
      const preferred = path.basename(rel);
      const targetRel = mediaLayout.relFor(kind, sub, preferred);
      const norm = rel.replace(/\\/g, '/');
      if (norm === targetRel && fs.existsSync(path.join(this.appDataDir, rel))) return targetRel;
      const from = path.join(this.appDataDir, rel);
      if (!fs.existsSync(from)) return rel;
      try {
        const absTo = this.safeMove(from, path.join(this.appDataDir, kind, sub), preferred);
        return mediaLayout.relFor(kind, sub, path.basename(absTo));
      } catch (_) {
        return rel;
      }
    };
    const imgs = (task.images || []).map((r) => moveOne(r, 'images'));
    const attachments = (task.attachments || []).map((a) => {
      if (typeof a === 'string') return moveOne(a, 'attachments');
      if (!a || !a.rel) return a;
      const newRel = moveOne(a.rel, 'attachments');
      return { ...a, rel: newRel, name: path.basename(newRel) };
    });
    return { ...task, images: imgs, attachments };
  }

  #rmEmptyDirs(kind) {
    const root = path.join(this.appDataDir, kind);
    if (!fs.existsSync(root)) return;
    let entries;
    try { entries = fs.readdirSync(root); } catch (_) { return; }
    for (const name of entries) {
      const abs = path.join(root, name);
      let st;
      try { st = fs.statSync(abs); } catch (_) { continue; }
      if (!st.isDirectory()) continue;
      try {
        if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
      } catch (_) {}
    }
  }

  rmEmptyMediaDirs() {
    this.#rmEmptyDirs('images');
    this.#rmEmptyDirs('attachments');
  }

  migrateMediaLayout() {
    const tagList = this.loadTags();
    let moved = 0;
    const errors = [];
    const mapList = (list) => list.map((t) => {
      const next = this.moveMediaForTask(t, tagList);
      if (JSON.stringify(next.images) !== JSON.stringify(t.images)
        || JSON.stringify(next.attachments) !== JSON.stringify(t.attachments)) moved++;
      return next;
    });
    this.saveTasks(mapList(this.loadTasks()));
    this.saveTrash(mapList(this.loadTrash()));
    this.rmEmptyMediaDirs();
    return { moved, errors };
  }

  /**
   * Rename/merge tag media folders and rewrite tasks/trash rels.
   * On disk failure: undo then throw without changing JSON.
   */
  renameTagFolders(tagId, tagsBefore, tagsAfter) {
    const oldSub = mediaLayout.subdirFor([tagId], tagsBefore);
    const newSub = mediaLayout.subdirFor([tagId], tagsAfter);
    if (oldSub === newSub) return;

    const undos = [];
    /** @type {Map<string, string>} oldRel -> newRel */
    const relMap = new Map();

    const applyKind = (kind) => {
      const oldAbs = path.join(this.appDataDir, kind, oldSub);
      const newAbs = path.join(this.appDataDir, kind, newSub);
      if (!fs.existsSync(oldAbs)) return;

      if (!fs.existsSync(newAbs)) {
        fs.renameSync(oldAbs, newAbs);
        undos.push(() => {
          if (fs.existsSync(newAbs) && !fs.existsSync(oldAbs)) fs.renameSync(newAbs, oldAbs);
        });
        // whole-dir rename: map every file under newAbs
        for (const name of fs.readdirSync(newAbs)) {
          const abs = path.join(newAbs, name);
          if (!fs.statSync(abs).isFile()) continue;
          const oldRel = mediaLayout.relFor(kind, oldSub, name);
          const newRel = mediaLayout.relFor(kind, newSub, name);
          relMap.set(oldRel, newRel);
        }
        return;
      }

      // merge
      for (const name of fs.readdirSync(oldAbs)) {
        const from = path.join(oldAbs, name);
        if (!fs.statSync(from).isFile()) continue;
        const absTo = this.safeMove(from, newAbs, name);
        const finalName = path.basename(absTo);
        const oldRel = mediaLayout.relFor(kind, oldSub, name);
        const newRel = mediaLayout.relFor(kind, newSub, finalName);
        relMap.set(oldRel, newRel);
        undos.push(() => {
          if (!fs.existsSync(absTo)) return;
          fs.mkdirSync(oldAbs, { recursive: true });
          const backName = mediaLayout.allocConflictName(oldAbs, name, (p) => fs.existsSync(p));
          const backAbs = path.join(oldAbs, backName);
          try { fs.renameSync(absTo, backAbs); }
          catch (_) { fs.copyFileSync(absTo, backAbs); fs.unlinkSync(absTo); }
        });
      }
      try {
        if (fs.existsSync(oldAbs) && fs.readdirSync(oldAbs).length === 0) fs.rmdirSync(oldAbs);
      } catch (_) {}
    };

    try {
      applyKind('images');
      applyKind('attachments');
    } catch (err) {
      for (let i = undos.length - 1; i >= 0; i--) {
        try { undos[i](); } catch (_) {}
      }
      throw err;
    }

    const rewriteRel = (rel) => {
      if (!rel || typeof rel !== 'string') return rel;
      const norm = rel.replace(/\\/g, '/');
      if (relMap.has(norm)) return relMap.get(norm);
      const prefixImg = `images/${oldSub}/`;
      const prefixAtt = `attachments/${oldSub}/`;
      if (norm.startsWith(prefixImg)) {
        return mediaLayout.relFor('images', newSub, path.basename(norm));
      }
      if (norm.startsWith(prefixAtt)) {
        return mediaLayout.relFor('attachments', newSub, path.basename(norm));
      }
      return rel;
    };

    const rewriteTask = (t) => {
      const images = (t.images || []).map(rewriteRel);
      const attachments = (t.attachments || []).map((a) => {
        if (typeof a === 'string') return rewriteRel(a);
        if (!a || !a.rel) return a;
        const newRel = rewriteRel(a.rel);
        return { ...a, rel: newRel, name: path.basename(newRel) };
      });
      return { ...t, images, attachments };
    };

    this.saveTasks(this.loadTasks().map(rewriteTask));
    this.saveTrash(this.loadTrash().map(rewriteTask));
    this.rmEmptyMediaDirs();
  }
}

module.exports = FileStore;
