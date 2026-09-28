const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMediaFig, buildMediaMenuItems } = require('../src/renderer/mediaFig');

test('kind from class / data-kind', () => {
  assert.equal(parseMediaFig({ className: 'doc-media doc-video', dataset: { src: 'videos/a.mp4', kind: 'video' } }).kind, 'video');
  assert.equal(parseMediaFig({ className: 'doc-media doc-image', dataset: { src: 'images/a.png' } }).kind, 'image');
});

test('dataSrc pending / data / rel', () => {
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'pending:2' } }).isPending, true);
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'data:image/png;base64,xx' } }).isDataUrl, true);
  assert.equal(parseMediaFig({ className: 'doc-media', dataset: { src: 'images/a.png' } }).rel, 'images/a.png');
});

test('menu: readonly no delete; open* disabled without local path', () => {
  const items = buildMediaMenuItems({ kind: 'image', hasLocalPath: false, hasDataUrl: true, canDelete: false });
  assert.equal(items.some((i) => i.id === 'delete'), false);
  const open = items.find((i) => i.id === 'open');
  assert.equal(open.disabled, true);
  assert.equal(open.title, '无本地文件');
  assert.equal(items.find((i) => i.id === 'copy').disabled, false);
});

test('menu: video without path disables copy + open*', () => {
  const items = buildMediaMenuItems({ kind: 'video', hasLocalPath: false, hasDataUrl: false, canDelete: true });
  assert.equal(items.find((i) => i.id === 'copy').disabled, true);
  assert.equal(items.find((i) => i.id === 'copy').title, '无本地文件');
  assert.equal(items.find((i) => i.id === 'open').disabled, true);
});

test('menu: editor with path enables open* and delete', () => {
  const items = buildMediaMenuItems({ kind: 'video', hasLocalPath: true, hasDataUrl: false, canDelete: true });
  assert.ok(items.find((i) => i.id === 'delete'));
  assert.equal(items.find((i) => i.id === 'showInFolder').disabled, false);
  assert.equal(items.find((i) => i.id === 'copy').disabled, false);
});
