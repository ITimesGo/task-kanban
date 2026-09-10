const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTag, renameTag, deleteTag, stripDeletedFromTasks,
} = require('../src/main/tags');

test('createTag 空名报 EMPTY_NAME，重名报 DUP_NAME', () => {
  assert.throws(() => createTag([], '  '), (e) => e.code === 'EMPTY_NAME');
  const one = createTag([], '工作');
  assert.throws(() => createTag(one, ' 工作 '), (e) => e.code === 'DUP_NAME');
});

test('createTag/renameTag 超过12字符报 TOO_LONG', () => {
  const long = '一二三四五六七八九十一二三四';
  assert.throws(() => createTag([], long), (e) => e.code === 'TOO_LONG');
  let tags = createTag([], '短名');
  assert.throws(() => renameTag(tags, tags[0].id, long), (e) => e.code === 'TOO_LONG');
});

test('createTag 生成 id 并 trim 名称', () => {
  const tags = createTag([], '  紧急  ');
  assert.equal(tags.length, 1);
  assert.ok(tags[0].id);
  assert.equal(tags[0].name, '紧急');
});

test('renameTag 改名且冲突时报错', () => {
  let tags = createTag([], 'a');
  const b = createTag(tags, 'b');
  tags = renameTag(b, b[0].id, 'A');
  assert.equal(tags[0].name, 'A');
  assert.throws(() => renameTag(tags, tags[1].id, 'A'), (e) => e.code === 'DUP_NAME');
  assert.throws(() => renameTag(tags, 'nope', 'x'), (e) => e.code === 'NOT_FOUND');
});

test('deleteTag 仅移除匹配 id', () => {
  let tags = createTag([], 'a');
  tags = createTag(tags, 'b');
  tags = createTag(tags, 'c');
  const deleted = tags[1];
  const rest = deleteTag(tags, deleted.id);
  assert.equal(rest.length, 2);
  assert.ok(!rest.some((t) => t.id === deleted.id));
});

test('stripDeletedFromTasks 移除任务中对应 tag 引用', () => {
  const tagA = createTag([], 'a')[0];
  const tagB = createTag([], 'b')[0];
  const tasks = [
    { id: 't1', tags: [tagA.id, tagB.id] },
    { id: 't2', tags: [tagB.id] },
    { id: 't3' }, // 旧任务可能无 tags 字段
  ];
  const out = stripDeletedFromTasks(tasks, tagA.id);
  assert.deepEqual(out[0].tags, [tagB.id]);
  assert.deepEqual(out[1].tags, [tagB.id]);
  assert.equal(out[2].tags, undefined);
});
