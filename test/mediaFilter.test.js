const test = require('node:test');
const assert = require('node:assert/strict');
const {
  taskMediaFlags,
  taskMatchesMediaFilter,
} = require('../src/renderer/taskMedia');

test('taskMediaFlags: empty task', () => {
  assert.deepEqual(taskMediaFlags(null), { image: false, video: false, attachment: false });
  assert.deepEqual(taskMediaFlags({}), { image: false, video: false, attachment: false });
});

test('taskMediaFlags: media array + attachments', () => {
  const t = {
    media: [
      { kind: 'image', rel: 'a.png' },
      { kind: 'video', rel: 'b.mp4' },
    ],
    attachments: ['x.pdf'],
  };
  assert.deepEqual(taskMediaFlags(t), { image: true, video: true, attachment: true });
});

test('taskMediaFlags: legacy images/videos', () => {
  const t = { images: ['a.png'], videos: [], attachments: [] };
  assert.deepEqual(taskMediaFlags(t), { image: true, video: false, attachment: false });
});

test('taskMatchesMediaFilter: empty selected = all', () => {
  assert.equal(taskMatchesMediaFilter({ images: [] }, []), true);
  assert.equal(taskMatchesMediaFilter({ images: ['a.png'] }, []), true);
});

test('taskMatchesMediaFilter: OR semantics', () => {
  const withImage = { images: ['a.png'] };
  const withVideo = { videos: ['b.mp4'] };
  const withAtt = { attachments: ['c.zip'] };
  const plain = { text: 'hi' };
  assert.equal(taskMatchesMediaFilter(withImage, ['image']), true);
  assert.equal(taskMatchesMediaFilter(withImage, ['video']), false);
  assert.equal(taskMatchesMediaFilter(withImage, ['image', 'video']), true);
  assert.equal(taskMatchesMediaFilter(withVideo, ['image', 'video']), true);
  assert.equal(taskMatchesMediaFilter(withAtt, ['attachment']), true);
  assert.equal(taskMatchesMediaFilter(plain, ['image', 'video', 'attachment']), false);
});
