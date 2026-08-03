const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.imagesDir = path.join(appDataDir, 'images');
    this.tasksFile = path.join(appDataDir, 'tasks.json');
    fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  loadTasks() {
    try {
      const data = JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      // JSON 损坏：备份原文件，以空列表启动
      try { fs.renameSync(this.tasksFile, this.tasksFile + '.bak'); } catch (_) {}
      return [];
    }
  }

  saveTasks(tasks) {
    const tmp = this.tasksFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    fs.renameSync(tmp, this.tasksFile); // 原子写
  }

  // dataUrl -> 写文件，返回相对路径 images/{id}_{i}.{ext}
  copyImage(dataUrl, taskId, index) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error('无效图片数据');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const rel = `images/${taskId}_${index}.${ext}`;
    fs.writeFileSync(path.join(this.appDataDir, rel), Buffer.from(m[2], 'base64'));
    return rel;
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
}

module.exports = FileStore;
