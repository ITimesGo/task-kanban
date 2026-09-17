const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEW_FACTORY_DEFAULTS,
  normalizeViewDefaults,
  cloneViewDefaults,
} = require('../src/renderer/viewDefaults');

test('出厂默认 createPanelMode 为 docked', () => {
  assert.equal(VIEW_FACTORY_DEFAULTS.createPanelMode, 'docked');
});

test('normalize 接受 docked/collapsed，其它回退 docked', () => {
  assert.equal(normalizeViewDefaults({ createPanelMode: 'collapsed' }).createPanelMode, 'collapsed');
  assert.equal(normalizeViewDefaults({ createPanelMode: 'docked' }).createPanelMode, 'docked');
  assert.equal(normalizeViewDefaults({ createPanelMode: 'nope' }).createPanelMode, 'docked');
  assert.equal(normalizeViewDefaults({}).createPanelMode, 'docked');
});

test('clone 保留 createPanelMode', () => {
  const c = cloneViewDefaults({
    filter: 'all',
    sortKey: 'createdAt',
    range: 'all',
    pageSize: 50,
    filtersExpanded: false,
    createPanelMode: 'collapsed',
  });
  assert.equal(c.createPanelMode, 'collapsed');
});
