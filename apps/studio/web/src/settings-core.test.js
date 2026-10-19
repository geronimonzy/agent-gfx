// node apps/studio/web/src/settings-core.test.js — the JS twins of prefs.rs (settings, overrides, recent list, gfx.json edit).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPref, patchMachine, sanitizeMachine, patchProject, sanitizeProject, resolvePref, sanitizeRecent, touchRecent, pinRecent,
  removeRecent, relocateRecent, addFolder, removeFolder, setSettingsText, MAX_RECENT, PROJECT_KEYS, migratePanelHeaders, isProjectKey,
  workflowFields, workflowArg,
} from './settings-core.js';
import { applyRenderDefaults, RENDER_PREF_FIELDS } from './render-prefs.js';

test('settings validation', () => {
  assert.equal(checkPref('renderMode', 'exact'), 'exact');
  assert.throws(() => checkPref('renderMode', 'slow'));
  assert.equal(checkPref('renderWorkers', 4), 4);
  for (const bad of [-1, 17, 2.5, '2']) assert.throws(() => checkPref('renderWorkers', bad), String(bad));
  assert.equal(checkPref('uiZoom', 1.2500001), 1.25);
  assert.throws(() => checkPref('uiZoom', 1.3));
  assert.equal(checkPref('renderOutDir', 'out\\renders\\'), 'out/renders');
  for (const bad of ['renders', '/out', 'out/../x', 'out//x', 'C:/out', 'out/a:b']) assert.throws(() => checkPref('renderOutDir', bad), bad);
  assert.equal(checkPref('claudeCommand', '  claude --continue '), 'claude --continue');
  assert.throws(() => checkPref('claudeCommand', 'claude\nrm -rf /'));
  assert.equal(checkPref('projectsDir', 'C:\\Users\\k\\gfx'), 'C:\\Users\\k\\gfx');
  assert.equal(checkPref('projectsDir', ''), '');
  assert.throws(() => checkPref('projectsDir', 'relative/dir'));
  assert.equal(checkPref('engineDir', '\\\\wsl.localhost\\Ubuntu\\home\\k\\gfx'), '\\\\wsl.localhost\\Ubuntu\\home\\k\\gfx');
  assert.throws(() => checkPref('engineDir', 'engine'));
  assert.ok(!isProjectKey('engineDir'), 'Engine folder is machine-only');
  assert.throws(() => checkPref('nope', 1));
  assert.equal(checkPref('renderPreset', '1080p'), '1080p');
  assert.throws(() => checkPref('renderPreset', '../x'));
});

test('last Claude target persists as a machine preference, defaults to terminal and rejects project overrides', () => {
  assert.equal(resolvePref('claudeTarget', {}, {}).value, 'terminal');
  const saved = JSON.parse(JSON.stringify(patchMachine({}, { claudeTarget: 't3' })));
  assert.equal(resolvePref('claudeTarget', sanitizeMachine(saved), {}).value, 't3');
  assert.throws(() => checkPref('claudeTarget', 'other'));
  assert.throws(() => patchProject({}, { claudeTarget: 't3' }), /not a per-project/);
  assert.equal(resolvePref('claudeTarget', patchMachine(saved, { claudeTarget: null }), {}).value, 'terminal');
});

test('settings merge: patch, null resets, unknown keys refused, file sanitized', () => {
  let s = sanitizeMachine({ shell: 'pwsh', t3WebhookUrl: 'https://old', renderWorkers: 'x', askSend: true });
  assert.deepEqual(s, { shell: 'pwsh', claudeCommand: '', askSend: true });
  s = patchMachine(s, { renderMode: 'exact', uiZoom: 1.5 });
  assert.equal(s.renderMode, 'exact');
  s = patchMachine(s, { renderMode: null, shell: null });
  assert.ok(!('renderMode' in s) && s.shell === '');
  assert.throws(() => patchMachine(s, { webhook: 'x' }));
  assert.throws(() => patchMachine(s, { renderWorkers: 99 }));
});

test('project overrides: only project keys; resolution project > machine > default', () => {
  assert.deepEqual(PROJECT_KEYS.sort(), ['codeAutosave', 'renderAudio', 'renderFrameFormat', 'renderMode', 'renderOutDir', 'renderPreset', 'renderQuality', 'renderWorkers', 'versionsAuto', 'workflow']);
  assert.throws(() => patchProject({}, { shell: 'x' }), /not a per-project/);
  const p = patchProject({}, { renderMode: 'exact', codeAutosave: true });
  assert.deepEqual(sanitizeProject({ ...p, shell: 'bad', renderWorkers: 'nope' }), p);
  assert.deepEqual(resolvePref('renderMode', { renderMode: 'fast' }, p), { value: 'exact', source: 'project' });
  assert.deepEqual(resolvePref('renderMode', { renderMode: 'exact' }, {}), { value: 'exact', source: 'machine' });
  assert.deepEqual(resolvePref('renderMode', {}, {}), { value: 'fast', source: 'default' });
  assert.deepEqual(resolvePref('shell', { shell: '' }, {}), { value: '', source: 'default' });
  assert.deepEqual(resolvePref('projectsDir', {}, {}, { projectsDir: '/home/k/gfx' }), { value: '/home/k/gfx', source: 'default' });
  assert.deepEqual(resolvePref('shell', {}, { shell: 'x' }), { value: '', source: 'default' }); // machine-only keys ignore project values
});

test('recent list: touch, pin keeps it on top, cap 12, remove, relocate, folders', () => {
  let r = sanitizeRecent({ recent: [{ path: 'C:\\a', name: 'A', opened: 1 }, { path: 'c:/A/', name: 'dup', opened: 9 }, { nope: 1 }], folders: ['D:\\p', 'd:/p/'] });
  assert.equal(r.recent.length, 1);
  assert.equal(r.folders.length, 1);
  for (let i = 0; i < 14; i++) r = touchRecent(r, `C:\\p${i}`, `P${i}`, 100 + i);
  assert.equal(r.recent.length, MAX_RECENT);
  assert.equal(r.recent[0].path, 'C:\\p13');
  assert.ok(!r.recent.some((e) => e.path === 'C:\\a' || e.path === 'C:\\p0'));
  r = pinRecent(r, 'C:\\p2', true);
  assert.equal(r.recent[0].path, 'C:\\p2');
  for (let i = 20; i < 40; i++) r = touchRecent(r, `C:\\q${i}`, '', 200 + i);
  assert.equal(r.recent.length, MAX_RECENT);
  assert.equal(r.recent[0].path, 'C:\\p2', 'pinned entries survive the cap');
  assert.equal(r.recent[1].path, 'C:\\q39');
  r = touchRecent(r, 'c:/P2', 'renamed', 999);
  assert.ok(r.recent[0].pinned && r.recent[0].name === 'renamed' && r.recent.length === MAX_RECENT);
  // all pinned: the new one still gets in, the oldest pinned goes
  let full = { recent: [], folders: [] };
  for (let i = 0; i < 12; i++) full = pinRecent(touchRecent(full, `/x${i}`, '', i), `/x${i}`, true);
  full = touchRecent(full, '/new', '', 50);
  assert.ok(full.recent.some((e) => e.path === '/new') && !full.recent.some((e) => e.path === '/x0') && full.recent.length === 12);
  r = removeRecent(r, 'C:/p2');
  assert.ok(!r.recent.some((e) => e.path === 'C:\\p2'));
  r = relocateRecent(r, 'C:\\q39', 'E:\\moved', '', 1000);
  assert.ok(r.recent[0].path === 'E:\\moved' && !r.recent.some((e) => e.path === 'C:\\q39'));
  r = addFolder(addFolder(r, '/f'), '/F/');
  assert.equal(r.folders.filter((f) => f.toLowerCase().startsWith('/f')).length, 1);
  r = removeFolder(r, '/f');
  assert.ok(!r.folders.includes('/f'));
});

test('gfx.json settings edit keeps the other keys and their formatting', () => {
  const src = '{\n    "version": 1,\n    "name": "My \\"proj\\"",\n    "engine": ">=0.2",\n    "library": { "sources": [ { "id": "x", "path": "a/b" } ] }\n}\n';
  const a = setSettingsText(src, { renderMode: 'exact' });
  assert.equal(a, src.replace('] }\n}', '] },\n    "settings": {\n      "renderMode": "exact"\n    }\n}'));
  const b = setSettingsText(a, { renderMode: 'fast', renderWorkers: 2 });
  assert.deepEqual(JSON.parse(b).settings, { renderMode: 'fast', renderWorkers: 2 });
  assert.ok(b.startsWith('{\n    "version": 1,\n    "name": "My \\"proj\\"",'));
  const c = setSettingsText(b, null);
  assert.equal(c, src);
  // settings first / only key
  const d = '{"settings": {"renderMode": "exact"}, "name": "x"}';
  assert.equal(setSettingsText(d, {}), '{"name": "x"}');
  assert.equal(setSettingsText('{ "settings": {} }', null), '{}');
  assert.equal(setSettingsText('{}', { codeAutosave: true }), '{\n  "settings": {\n    "codeAutosave": true\n  }\n}');
  assert.throws(() => setSettingsText('[1]', { a: 1 }));
  assert.throws(() => setSettingsText('{"a": }', { a: 1 }));
});

function memoryStorage(entries) {
  const data = new Map(Object.entries(entries));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

test('header migration strips every legacy layout; Off and reset survive another startup', async () => {
  const storage = memoryStorage({
    'gfx.layout.v1.review': JSON.stringify({ showHeaders: true, dock: { groups: [1] } }),
    'gfx.layout.v1.code': JSON.stringify({ showHeaders: true, dock: {} }),
  });
  const patches = [];
  const write = async (patch) => { patches.push(patch); return patch; };
  assert.deepEqual(await migratePanelHeaders(storage, {}, write), { showHeaders: true });
  for (const mode of ['review', 'code']) assert.ok(!Object.hasOwn(JSON.parse(storage.getItem(`gfx.layout.v1.${mode}`)), 'showHeaders'));
  assert.deepEqual(JSON.parse(storage.getItem('gfx.layout.v1.review')).dock, { groups: [1] });
  for (const machine of [{ showHeaders: false }, {}, {}]) await migratePanelHeaders(storage, machine, write);
  assert.equal(patches.length, 1, 'an explicit Off (stored as absent) or reset cannot re-migrate');
});

test('header migration respects a machine choice and retains legacy data if persistence fails', async () => {
  const storage = memoryStorage({ 'gfx.layout.v1.code': '{"showHeaders":true,"dock":{}}' });
  await assert.rejects(migratePanelHeaders(storage, {}, async () => { throw new Error('disk full'); }), /disk full/);
  assert.equal(JSON.parse(storage.getItem('gfx.layout.v1.code')).showHeaders, true);
  const machine = { showHeaders: false };
  assert.equal(await migratePanelHeaders(storage, machine, async () => assert.fail('must preserve explicit Off')), machine);
  assert.deepEqual(JSON.parse(storage.getItem('gfx.layout.v1.code')), { dock: {} });
});

test('render defaults refresh all untouched fields and preserve explicit choices, including choices equal to defaults', () => {
  const old = { mode: 'fast', quality: 'normal', preset: 'scene', audio: true, workers: 0, frameFormat: 'png', outDir: 'out' };
  const next = { mode: 'exact', quality: 'high', preset: '4k', audio: false, workers: 4, frameFormat: 'jpeg', outDir: 'out/finals' };
  const d = { _edited: {} };
  applyRenderDefaults(d, old);
  applyRenderDefaults(d, next); // also applies while the dialog is cached / closed
  assert.deepEqual(Object.fromEntries(RENDER_PREF_FIELDS.map((k) => [k, d[k]])), { ...next, preset: 'p:4k' });
  for (const key of RENDER_PREF_FIELDS) {
    const edited = { _edited: { [key]: true } };
    applyRenderDefaults(edited, old);
    edited[key] = key === 'preset' ? 'scene' : old[key];
    applyRenderDefaults(edited, next);
    assert.equal(edited[key], key === 'preset' ? 'scene' : old[key], key);
    for (const other of RENDER_PREF_FIELDS.filter((k) => k !== key)) assert.equal(edited[other], other === 'preset' ? 'p:4k' : next[other], other);
  }
  applyRenderDefaults(d, old);
  assert.equal(d.preset, 'scene');
});

test('welcome switch waits for a matching acknowledgement, cleans up on cancel/error/timeout, and supports the shim', async (t) => {
  const previous = Object.fromEntries(['window', 'document', 'location', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let listener, response = 'cancelled', unlistens = 0, reply;
  globalThis.window = { __TAURI__: {
    core: { invoke: async (op, { requestId }) => {
      assert.equal(op, 'welcome_open');
      assert.ok(listener, 'subscribe before requesting the switch');
      if (response === 'reject') throw new Error('backend failed');
      if (response === 'opened') return 'opened';
      listener({ payload: { requestId: 'unrelated', status: 'accepted' } });
      if (response !== 'timeout') listener({ payload: { requestId, status: response, error: 'switch failed' } });
      return 'switched';
    } },
    event: {
      listen: async (event, fn) => { assert.equal(event, 'gfx://open-project-result'); listener = fn; return () => { listener = null; unlistens++; }; },
      emitTo: async (...args) => { reply = args; },
    },
  } };
  const api = await import('./api.js?welcome-test');
  for (const status of ['cancelled', 'accepted', 'opened']) {
    response = status;
    assert.equal(await api.welcomeOpen('/project'), status);
    assert.equal(listener, null);
  }
  response = 'error';
  await assert.rejects(api.welcomeOpen('/project'), /switch failed/);
  response = 'reject';
  await assert.rejects(api.welcomeOpen('/project'), /backend failed/);
  response = 'timeout';
  await assert.rejects(api.welcomeOpen('/project', 5), /timed out/);
  assert.equal(unlistens, 6);
  assert.equal(listener, null);
  await api.welcomeOpenResult('id', 'cancelled');
  assert.deepEqual(reply, [{ kind: 'Webview', label: 'welcome' }, 'gfx://open-project-result', { requestId: 'id', status: 'cancelled', error: undefined }]);
  delete globalThis.window;
  globalThis.document = { baseURI: 'http://shim.test/' };
  globalThis.location = { href: '' };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: 'opened' }) });
  const shim = await import('./api.js?welcome-shim-test');
  assert.equal(await shim.welcomeOpen('/project'), 'opened');
  assert.equal(location.href, './index.html');
});

test('workflow profile and Library folder (docs/LOOKS.md §1, §3)', () => {
  assert.equal(checkPref('workflow', 'quick'), 'quick');
  assert.equal(checkPref('workflow', 'full'), 'full');
  for (const bad of ['custom', 'fast', 3, null, [], { verify: 'all' }, { render: 'yes' }, { sound: 'never' }]) assert.throws(() => checkPref('workflow', bad), JSON.stringify(bad));
  assert.deepEqual(checkPref('workflow', { verify: 'stills', render: true, sound: 'always', profile: 'custom', extra: 1 }), { verify: 'stills', render: true, sound: 'always' });
  assert.deepEqual(checkPref('workflow', { render: true }), { verify: 'sheet', render: true, sound: 'asked' }, 'missing fields come from quick');
  assert.ok(isProjectKey('workflow'));
  assert.deepEqual(workflowFields('full'), { profile: 'full', verify: 'full', render: true, sound: 'always' });
  assert.deepEqual(workflowFields({ verify: 'stills', render: false, sound: 'asked' }), { profile: 'custom', verify: 'stills', render: false, sound: 'asked' });
  assert.equal(workflowArg('quick'), 'quick');
  assert.equal(workflowArg({ verify: 'stills', render: false, sound: 'asked' }), '{"verify":"stills","render":false,"sound":"asked"}');
  // project override wins, then the machine default, then quick
  assert.deepEqual(resolvePref('workflow', {}, {}), { value: 'quick', source: 'default' });
  assert.deepEqual(resolvePref('workflow', { workflow: 'full' }, {}), { value: 'full', source: 'machine' });
  assert.deepEqual(resolvePref('workflow', { workflow: 'full' }, sanitizeProject({ workflow: { verify: 'stills' } })).value, { verify: 'stills', render: false, sound: 'asked' });
  assert.deepEqual(sanitizeProject({ workflow: 'nope', renderMode: 'exact' }), { renderMode: 'exact' }, 'an invalid gfx.json value is dropped');
  // Library folder: machine-only absolute path (WSL UNC allowed), '' = the default
  const unc = String.raw`\\wsl.localhost\Ubuntu\home\k\lib`, win = String.raw`C:\Users\k\Documents\gfx library`;
  assert.equal(checkPref('libraryDir', unc), unc);
  assert.equal(checkPref('libraryDir', win), win);
  assert.equal(checkPref('libraryDir', ''), '');
  assert.throws(() => checkPref('libraryDir', 'gfx library'));
  assert.ok(!isProjectKey('libraryDir'));
  assert.throws(() => patchProject({}, { libraryDir: '/x' }), /not a per-project/);
});
