import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

function load(file, globals, exports) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
  const context = vm.createContext({ console, setTimeout: () => 1, clearTimeout() {}, ...globals });
  vm.runInContext(`${source}\nglobalThis.subject = { ${exports} };`, context);
  return context;
}
function versions() {
  const storage = new Map(), events = [], S = { root: '/a', name: 'scene' };
  const context = load('./versions.js', {
    S, localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    api: { stat: async () => null }, on() {}, emit: (...args) => events.push(args),
    esc: (s) => s, confirm: () => true, noteExternal() {},
  }, 'V, checkpoint, beforeAsk, restoreVersion, run, failureMessage');
  Object.assign(context.subject.V, { loaded: true, root: S.root, status: { repo: true } });
  return { context, ...context.subject, S, storage, events };
}

test('checkpoint stops if project changes while status is in flight', async () => {
  const h = versions(), calls = [];
  h.context.cli = async (args) => { calls.push(args[0]); h.S.root = '/b'; return { dirty: [], head: { sha: 'abc' } }; };
  vm.runInContext('vcli = cli', h.context);
  assert.equal(await h.checkpoint('Before asking Claude'), null);
  assert.deepEqual(calls, ['status']);
});

test('checkpoint stops if project changes during attribution save', async () => {
  const h = versions(), calls = [];
  h.context.cli = async (args) => {
    calls.push(args[0]);
    if (args[0] === 'save') h.S.root = '/b';
    return { dirty: [{ path: 'scenes/a/scene.js' }], head: { msg: 'Before asking Claude', sha: 'abc' } };
  };
  vm.runInContext('vcli = cli', h.context);
  assert.equal(await h.checkpoint('Before asking Claude'), null);
  assert.deepEqual(calls, ['status', 'save']);
});

test('a clean before-ask save records HEAD per request and project', async () => {
  const h = versions();
  h.context.cli = async (args) => args[0] === 'save' ? { skipped: 'clean' }
    : { repo: true, dirty: [], head: { sha: 'abc123', msg: 'User version' } };
  vm.runInContext('vcli = cli', h.context);
  await h.beforeAsk('First request');
  await h.beforeAsk('Second request');
  const records = JSON.parse(h.storage.get('gfx-studio.versions.requests:/a'));
  assert.equal(records.length, 2);
  assert.equal(records[1].sha, 'abc123');
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(h.storage.has('gfx-studio.versions.requests:/b'), false);
});

test('engine failures show the real error; engine update only when the engine lacks the command', () => {
  const { failureMessage } = versions();
  const crash = ['node:internal/modules/cjs/loader:1228', '  throw err;', '  ^', "Error: Cannot find module '/home/k/p/runner/cli.js'",
    '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)', '    at node:internal/main/run_main_module:28:49 {',
    "  code: 'MODULE_NOT_FOUND',", '  requireStack: []', '}', 'Node.js v24.22.0'];
  const a = failureMessage({ err: crash, code: 1 });
  assert.equal(a.msg, "Error: Cannot find module '/home/k/p/runner/cli.js'");
  assert.equal(a.update, false);
  const b = failureMessage({ out: ['gfx <command> [options]', '  init <dir>'], code: 1, cmd: 'version status' });
  assert.equal(b.update, true);
  assert.match(b.msg, /no `gfx version` command/);
  const c = failureMessage({ err: ['bash: line 1: node: command not found'], code: 127 });
  assert.equal(c.msg, 'bash: line 1: node: command not found');
  assert.equal(c.update, false);
  assert.equal(failureMessage({ error: 'not a git repo', err: ['x'] }).msg, 'not a git repo');
  assert.equal(failureMessage({ code: 3, cmd: 'version log' }).msg, 'gfx version log exited with 3');
});

test('busy actions fail without executing or reporting a restore', async () => {
  const h = versions();
  h.V.busy = 'Saving…';
  let called = false;
  assert.equal(await h.run('Restoring…', () => { called = true; }), undefined);
  assert.equal(await h.restoreVersion('abc123'), false);
  assert.equal(called, false);
  assert.equal(h.events.length, 0);
});

test('code reference requests have independent generations per host', async () => {
  const deferred = [];
  const context = load('./code.js', {
    localStorage: { getItem: () => null }, request: () => new Promise((resolve) => deferred.push(resolve)),
    esc: (s) => s,
  }, 'renderRefs');
  const host = () => {
    const list = { innerHTML: '', querySelectorAll: () => [] };
    return { dataset: {}, innerHTML: '', querySelector: () => list, list };
  };
  const visible = host(), hidden = host();
  context.subject.renderRefs(visible, 'visible-key');
  context.subject.renderRefs(hidden, 'hidden-key');
  for (const resolve of deferred) resolve({ refs: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(visible.list.innerHTML, /No code references/);
  assert.match(hidden.list.innerHTML, /No code references/);
});

test('code outlines throttle refreshes throughout continuous playback', () => {
  let now = 0, pending = null, refreshes = 0;
  const context = load('./live.js', {
    transport: { playing: true }, performance: { now: () => now }, emit() {},
    setTimeout: (fn, delay) => { pending = { fn, due: now + delay }; return 1; },
    clearTimeout: () => { pending = null; },
  }, 'afterRender');
  context.recordRefresh = () => { refreshes++; };
  vm.runInContext("codeKeys = ['element']; refreshCodeBounds = () => { cLast = performance.now(); recordRefresh(); }", context);
  for (now = 0; now <= 1000; now += 16) {
    if (pending && pending.due <= now) { const fn = pending.fn; pending = null; fn(); }
    context.subject.afterRender();
  }
  assert.ok(refreshes >= 7, `expected ongoing refreshes, got ${refreshes}`);
});

test('loading a scene in Code mode re-enables Live', async () => {
  const listeners = new Map(), elements = new Map();
  let enabled = 0;
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, { addEventListener() {}, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const context = load('./code.js', {
    $: byId, // dom.js's lookup (imports are stripped by load())
    esc: (s) => s, S: { name: 'new-scene' }, L: { on: false }, toggleLive: () => { enabled++; },
    localStorage: { getItem: () => null }, on: (event, fn) => listeners.set(event, fn), emit() {},
    api: { listProjectFiles: async () => ({ files: [] }) },
    setInterval: () => 1, window: { addEventListener() {} },
    document: {
      querySelectorAll: () => [],
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, { addEventListener() {} });
        return elements.get(id);
      },
    },
  }, 'C, initCode');
  context.subject.initCode();
  context.subject.C.on = true;
  listeners.get('scene')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(enabled, 1);
});
