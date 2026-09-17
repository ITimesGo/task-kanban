const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  panelVisibility,
  reduceCreatePanelAction,
  initialOpenForMode,
} = require('../src/renderer/createPanelMode');

test('visibility: docked always panel, never fab', () => {
  assert.deepEqual(panelVisibility('docked', false), { showPanel: true, showFab: false });
  assert.deepEqual(panelVisibility('docked', true), { showPanel: true, showFab: false });
});

test('visibility: collapsed depends on open', () => {
  assert.deepEqual(panelVisibility('collapsed', false), { showPanel: false, showFab: true });
  assert.deepEqual(panelVisibility('collapsed', true), { showPanel: true, showFab: false });
});

test('openFab / collapse / pin / unpin', () => {
  let s = { mode: 'collapsed', open: false };
  s = reduceCreatePanelAction(s, 'openFab');
  assert.deepEqual(s, { mode: 'collapsed', open: true });
  s = reduceCreatePanelAction(s, 'pin');
  assert.deepEqual(s, { mode: 'docked', open: true });
  s = reduceCreatePanelAction(s, 'unpin');
  assert.deepEqual(s, { mode: 'collapsed', open: true });
  s = reduceCreatePanelAction(s, 'collapse');
  assert.deepEqual(s, { mode: 'collapsed', open: false });
});

test('applyMode reasons', () => {
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: true }, 'applyMode', { mode: 'collapsed', reason: 'same-mode' }),
    { mode: 'collapsed', open: true }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: true }, 'applyMode', { mode: 'collapsed', reason: 'cold' }),
    { mode: 'collapsed', open: false }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'docked', open: true }, 'applyMode', { mode: 'collapsed', reason: 'mode-change' }),
    { mode: 'collapsed', open: false }
  );
  assert.deepEqual(
    reduceCreatePanelAction({ mode: 'collapsed', open: false }, 'applyMode', { mode: 'docked', reason: 'mode-change' }),
    { mode: 'docked', open: true }
  );
});

test('initialOpenForMode', () => {
  assert.equal(initialOpenForMode('docked'), true);
  assert.equal(initialOpenForMode('collapsed'), false);
});
