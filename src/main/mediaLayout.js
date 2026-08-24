const path = require('path');

const PUBLIC = '公共';
const ILLEGAL = /[\\/:*?"<>|]/g;

function sanitizeTagName(name) {
  // trim first so leading/trailing spaces do not become leading/trailing '_'
  const s = String(name || '').trim().replace(ILLEGAL, '').replace(/\s+/g, '_');
  return s || 'tag';
}

function id8(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8);
}

function subdirFor(tagIds, tagList) {
  const ids = tagIds || [];
  if (ids.length !== 1) return PUBLIC;
  const tag = (tagList || []).find((t) => t.id === ids[0]);
  if (!tag) return PUBLIC;
  return `${sanitizeTagName(tag.name)}_${id8(tag.id)}`;
}

function relFor(kind, subdir, filename) {
  return `${kind}/${subdir}/${filename}`.replace(/\\/g, '/');
}

/** exists(absPath) -> boolean; returns filename that does not collide under dirAbs */
function allocConflictName(dirAbs, filename, exists) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let name = filename;
  let n = 1;
  while (exists(path.join(dirAbs, name))) {
    name = `${base}_${n}${ext}`;
    n++;
  }
  return name;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseImageIndex(relOrName, taskId) {
  const base = path.basename(relOrName || '');
  const re = new RegExp(`^${escapeRe(taskId)}_(\\d+)(?:_\\d+)?\\.[^.]+$`);
  const m = re.exec(base);
  return m ? Number(m[1]) : null;
}

function imageIndexTakenSet(rels, taskId) {
  const set = new Set();
  for (const r of rels || []) {
    const i = parseImageIndex(r, taskId);
    if (i !== null) set.add(i);
  }
  return set;
}

module.exports = {
  PUBLIC, sanitizeTagName, subdirFor, relFor, allocConflictName, parseImageIndex, imageIndexTakenSet, id8,
};
