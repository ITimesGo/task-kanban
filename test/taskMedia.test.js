const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  taskMediaItems,
  normalizeMediaPayload,
  moveMediaItem,
  capMediaItems,
  splitMediaRels,
} = require('../src/renderer/taskMedia');
const { createTask, updateTask } = require('../src/main/store');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FileStore = require('../src/main/fileStore');

test('taskMediaItems 无 media 时图片在前视频在后', () => {
  const items = taskMediaItems({
    images: ['images/a.png'],
    videos: ['videos/b.mp4'],
  });
  assert.deepEqual(items.map((m) => m.value), ['images/a.png', 'videos/b.mp4']);
});

test('taskMediaItems 有 media 时保留混排顺序', () => {
  const items = taskMediaItems({
    images: ['images/a.png'],
    videos: ['videos/b.mp4'],
    media: [
      { kind: 'video', rel: 'videos/b.mp4' },
      { kind: 'image', rel: 'images/a.png' },
    ],
  });
  assert.deepEqual(items.map((m) => [m.kind, m.value]), [
    ['video', 'videos/b.mp4'],
    ['image', 'images/a.png'],
  ]);
});

test('taskMediaItems 空 media 但有 images 时回退，避免误清空', () => {
  const items = taskMediaItems({
    images: ['images/a.png'],
    videos: ['videos/b.mp4'],
    media: [],
  });
  assert.deepEqual(items.map((m) => m.value), ['images/a.png', 'videos/b.mp4']);
});

test('normalizeMediaPayload 剥离 taskimage:// 前缀', () => {
  const items = normalizeMediaPayload({
    media: [{ kind: 'image', value: 'taskimage://local/images/a.png' }],
  });
  assert.equal(items[0].value, 'images/a.png');
});

test('normalizeMediaPayload 优先使用 media 混排', () => {
  const items = normalizeMediaPayload({
    images: ['i1'],
    videos: ['v1'],
    media: [
      { kind: 'video', value: { srcPath: 'c:/a.mp4' } },
      { kind: 'image', value: 'data:image/png;base64,aa' },
    ],
  });
  assert.equal(items[0].kind, 'video');
  assert.equal(items[1].kind, 'image');
  assert.equal(items[0].value.srcPath, 'c:/a.mp4');
});

test('normalizeMediaPayload 无 media 时由 images+videos 拼接', () => {
  const items = normalizeMediaPayload({ images: ['i1'], videos: ['v1'] });
  assert.deepEqual(items.map((m) => [m.kind, m.value]), [
    ['image', 'i1'],
    ['video', 'v1'],
  ]);
});

test('moveMediaItem 把项移到目标下标', () => {
  const arr = ['a', 'b', 'c'];
  assert.deepEqual(moveMediaItem(arr, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveMediaItem(arr, 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(arr, ['a', 'b', 'c']);
});

test('capMediaItems 按种类上限裁剪且保持相对顺序', () => {
  const items = capMediaItems([
    { kind: 'image', value: 'i1' },
    { kind: 'video', value: 'v1' },
    { kind: 'image', value: 'i2' },
    { kind: 'video', value: 'v2' },
    { kind: 'video', value: 'v3' },
  ], { maxImages: 1, maxVideos: 2 });
  assert.deepEqual(items.map((m) => m.value), ['i1', 'v1', 'v2']);
});

test('splitMediaRels 拆出 images/videos 并保留 media 顺序', () => {
  const { images, videos, media } = splitMediaRels([
    { kind: 'video', rel: 'videos/b.mp4' },
    { kind: 'image', rel: 'images/a.png' },
  ]);
  assert.deepEqual(images, ['images/a.png']);
  assert.deepEqual(videos, ['videos/b.mp4']);
  assert.deepEqual(media.map((m) => m.kind), ['video', 'image']);
});

test('createTask / updateTask 持久化 media 混排', () => {
  const t = createTask({
    text: 'x',
    images: ['i1'],
    videos: ['v1'],
    media: [{ kind: 'video', rel: 'v1' }, { kind: 'image', rel: 'i1' }],
  });
  assert.deepEqual(t.media.map((m) => m.kind), ['video', 'image']);
  const list = updateTask([t], t.id, {
    media: [{ kind: 'image', rel: 'i1' }, { kind: 'video', rel: 'v1' }],
  });
  assert.deepEqual(list[0].media.map((m) => m.kind), ['image', 'video']);
});

test('moveMediaForTask 同步改写 media.rel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-media-'));
  const s = new FileStore(dir);
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  s.saveTags([{ id: tid, name: '工作' }]);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'abc_0.png'), 'IMG');
  fs.writeFileSync(path.join(dir, 'videos', 'abc_0.mp4'), 'VID');
  const moved = s.moveMediaForTask(
    {
      id: 'abc',
      tags: [tid],
      images: ['images/abc_0.png'],
      videos: ['videos/abc_0.mp4'],
      media: [
        { kind: 'video', rel: 'videos/abc_0.mp4' },
        { kind: 'image', rel: 'images/abc_0.png' },
      ],
      attachments: [],
    },
    s.loadTags()
  );
  assert.equal(moved.media[0].rel, 'videos/工作_aaaaaaaa/abc_0.mp4');
  assert.equal(moved.media[1].rel, 'images/工作_aaaaaaaa/abc_0.png');
  assert.equal(moved.media[0].kind, 'video');
});
