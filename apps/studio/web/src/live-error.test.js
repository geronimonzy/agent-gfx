import assert from 'node:assert/strict';
import test from 'node:test';
import { errorLocation, errorText, errorWhere } from './live-error.js';

test('live error: first project frame of a live-server stack', () => {
  const stack = 'ReferenceError: __GM__ is not defined\n    at http://127.0.0.1:5199/scenes/orbit/scene.js?v=3:18:16';
  assert.deepEqual(errorLocation(stack), { path: 'scenes/orbit/scene.js', line: 18, col: 16 });
  // engine frames first (setup called from core.js): skipped
  const s2 = 'Error: boom\n    at buildScene (http://127.0.0.1:5199/runner/player/core.js:120:9)\n    at Object.setup (http://127.0.0.1:5199/scenes/a/lib/x.js?import:4:3)';
  assert.deepEqual(errorLocation(s2), { path: 'scenes/a/lib/x.js', line: 4, col: 3 });
  // Firefox-style frames, no column
  assert.deepEqual(errorLocation('setup@http://localhost:5199/scenes/b/scene.js:7'), { path: 'scenes/b/scene.js', line: 7, col: 1 });
});

test('live error: /@fs/ paths inside the project only', () => {
  const root = '/home/u/gfx-projects/p1';
  assert.deepEqual(errorLocation('at http://127.0.0.1:5199/@fs/home/u/gfx-projects/p1/scenes/x/scene.js:2:5', root), { path: 'scenes/x/scene.js', line: 2, col: 5 });
  assert.equal(errorLocation('at http://127.0.0.1:5199/@fs/home/u/engine/runner/player/core.js:2:5', root), null);
  assert.equal(errorLocation('at http://127.0.0.1:5199/node_modules/.vite-gfx-serve/deps/animejs.js:9:1'), null);
  assert.equal(errorLocation('__GM__ is not defined'), null);
  assert.equal(errorLocation(''), null);
});

test('live error: text and where', () => {
  assert.equal(errorText('Uncaught ReferenceError: x\nmore'), 'ReferenceError: x');
  assert.equal(errorText(''), 'scene error');
  assert.equal(errorWhere({ path: 'scenes/a/scene.js', line: 3 }), 'scenes/a/scene.js:3');
  assert.equal(errorWhere({ message: 'x' }), '');
});
