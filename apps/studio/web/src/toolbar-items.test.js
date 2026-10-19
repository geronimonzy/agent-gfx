import assert from 'node:assert/strict';
import test from 'node:test';
import { appMenuItems, sceneMenuItems } from './toolbar-items.js';

test('app menu preserves actions and obtains hints from the supplied registry', () => {
  const calls = [], actions = Object.fromEntries(['settings', 'library', 'panels', 'help', 'welcome'].map((id) => [id, () => calls.push(id)]));
  const items = appMenuItems(actions, (id) => `registry:${id}`);
  assert.deepEqual(items.filter((i) => !i.sep).map((i) => i.id), ['settings', 'library', 'panels', 'help', 'welcome']);
  assert.equal(items[0].hint, 'registry:settings');
  for (const i of items.filter((i) => !i.sep)) i.run();
  assert.deepEqual(calls, ['settings', 'library', 'panels', 'help', 'welcome']);
  assert.equal(appMenuItems({})[1].disabled, true);
});

test('scene menu checks the current scene, gates brief by its file and preserves selection callbacks', () => {
  const calls = [], state = { scenes: [{ name: 'one', hasVideo: true }, { name: 'two', hasCues: true }], current: 'two', hasBrief: true, hasProject: true, loading: false };
  const actions = { select: (name) => calls.push(name), newScene() {}, brief() {}, reload() {} };
  const items = sceneMenuItems(state, actions);
  assert.equal(items[0].checked, false); assert.equal(items[1].checked, true);
  items[0].run(); assert.deepEqual(calls, ['one']);
  assert.deepEqual(items.slice(3).map((i) => i.id), ['scene-new', 'brief', 'reload']);
  assert.ok(!sceneMenuItems({ ...state, hasBrief: false }, actions).some((i) => i.id === 'brief'));
  assert.ok(sceneMenuItems({ ...state, loading: true }, actions).filter((i) => !i.sep).every((i) => i.disabled));
  const empty = sceneMenuItems({ scenes: [], hasProject: false }, actions);
  assert.ok(empty.filter((i) => !i.sep).every((i) => i.disabled));
});
