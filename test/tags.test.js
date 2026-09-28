const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTag, renameTag, deleteTag, countTagUsage, reorderTags, stripDeletedFromTasks,
} = require('../src/main/tags');

test('createTag 空名报 EMPTY_NAME，重名报 DUP_NAME', () => {
  assert.throws(() => createTag([], '  '), (e) => e.code === 'EMPTY_NAME');
  const one = createTag([], '工作');
  assert.throws(() => createTag(one, ' 工作 '), (e) => e.code === 'DUP_NAME');
});

test('createTag/renameTag 超过15字符报 TOO_LONG', () => {
  const long = '一二三四五六七八九十一二三四五六'; // 16
  assert.throws(() => createTag([], long), (e) => e.code === 'TOO_LONG');
  let tags = createTag([], '短名');
  assert.throws(() => renameTag(tags, tags[0].id, long), (e) => e.code === 'TOO_LONG');
  const ok15 = createTag([], '一二三四五六七八九十一二三四五'); // 15
  assert.equal(ok15[0].name.length, 15);
});

test('createTag 生成 id 并 trim 名称', () => {
  const tags = createTag([], '  紧急  ');
  assert.equal(tags.length, 1);
  assert.ok(tags[0].id);
  assert.equal(tags[0].name, '紧急');
});

test('createTag/renameTag 大小写不敏感重名', () => {
  const one = createTag([], 'Work');
  assert.throws(() => createTag(one, 'work'), (e) => e.code === 'DUP_NAME');
  assert.throws(() => createTag(one, ' WORK '), (e) => e.code === 'DUP_NAME');
  const two = createTag(one, 'home');
  assert.throws(() => renameTag(two, two[1].id, 'work'), (e) => e.code === 'DUP_NAME');
  const renamed = renameTag(two, two[0].id, 'WORK');
  assert.equal(renamed[0].name, 'WORK');
  assert.throws(() => renameTag(renamed, 'nope', 'x'), (e) => e.code === 'NOT_FOUND');
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

test('countTagUsage 统计任务引用', () => {
  const tagA = createTag([], 'a')[0];
  const tagB = createTag([], 'b')[0];
  const tasks = [
    { id: 't1', tags: [tagA.id, tagB.id] },
    { id: 't2', tags: [tagB.id] },
    { id: 't3', tags: [] },
    { id: 't4' },
  ];
  assert.equal(countTagUsage(tasks, tagA.id), 1);
  assert.equal(countTagUsage(tasks, tagB.id), 2);
  assert.equal(countTagUsage(tasks, 'missing'), 0);
  assert.equal(countTagUsage(null, tagA.id), 0);
});

test('reorderTags 插入语义与边界', () => {
  let tags = createTag([], 'A');
  tags = createTag(tags, 'B');
  tags = createTag(tags, 'C');
  const [a, b, c] = tags;
  const cToA = reorderTags(tags, c.id, a.id);
  assert.deepEqual(cToA.map((t) => t.name), ['C', 'A', 'B']);
  const aToC = reorderTags(tags, a.id, c.id);
  assert.deepEqual(aToC.map((t) => t.name), ['B', 'C', 'A']);
  const same = reorderTags(tags, a.id, a.id);
  assert.deepEqual(same.map((t) => t.name), ['A', 'B', 'C']);
  assert.throws(() => reorderTags(tags, 'nope', a.id), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => reorderTags(tags, a.id, 'nope'), (e) => e.code === 'NOT_FOUND');
  const ends = reorderTags(tags, a.id, c.id);
  assert.deepEqual(reorderTags(ends, ends[2].id, ends[0].id).map((t) => t.name), ['A', 'B', 'C']);
  assert.equal(b.name, 'B');
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
