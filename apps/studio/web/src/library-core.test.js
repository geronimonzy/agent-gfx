// node apps/studio/web/src/library-core.test.js — Library guards (twins of src-tauri/src/library.rs) and page helpers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLibRel, checkLibWritable, checkLibRef, checkRefDest, cleanFileName, uniqueName, validId, lookMeta, presetSwatches, renamePreset,
  paletteSaver, parsePalette, paletteText, blankLook, wslPath, checkLibBytes,
  lookBriefText, parseLookBrief, wslProject, claudeLibPath, makeLookMessage, rebuildSampleMessage, lookFiles, fileKey, altLine, previewStatus,
  soundSourceId, validSourceId, wslEngine, engineFolder, parseJsonOut, soundList, soundRowState, filesPerSec,
} from './library-core.js';

test('sound sources: ids, engine paths, list JSON, row state (docs/SOUND-LIBRARY.md §4)', () => {
  assert.equal(soundSourceId('C:\\Users\\k\\SFX\\My UI Sounds'), 'my-ui-sounds');
  assert.equal(soundSourceId('/home/k/sfx/Café Pack/'), 'cafe-pack');
  assert.equal(soundSourceId('\\\\wsl.localhost\\Ubuntu\\home\\k\\kenney', ['kenney', 'kenney-2']), 'kenney-3');
  assert.equal(soundSourceId('///'), 'sounds');
  assert.ok(validSourceId('my-ui_1.0') && !validSourceId('a b') && !validSourceId('') && !validSourceId('..') && !validSourceId('a/b'));
  assert.equal(wslEngine('\\\\wsl.localhost\\Ubuntu\\home\\k\\p', { wsl: false }), true);
  assert.equal(wslEngine('C:\\p', { wsl: true }), true);
  assert.equal(wslEngine('C:\\p', { wsl: false }), false);
  assert.equal(wslEngine('/home/k/p', null), false);
  // a Windows engine takes the picked path as is; a WSL engine gets C:/x and the Linux path of \\wsl.localhost
  assert.equal(engineFolder('C:\\SFX\\ui', { wsl: false }), 'C:\\SFX\\ui');
  assert.equal(engineFolder('\\\\wsl.localhost\\Ubuntu\\home\\k\\sfx', { wsl: false }), '\\\\wsl.localhost\\Ubuntu\\home\\k\\sfx');
  assert.equal(engineFolder('C:\\SFX\\ui', { wsl: true }), 'C:/SFX/ui');
  assert.equal(engineFolder('D:', { wsl: true }), 'D:');
  assert.equal(engineFolder('\\\\wsl.localhost\\Ubuntu\\home\\k\\sfx', { wsl: true }), '/home/k/sfx');
  assert.equal(engineFolder('\\\\wsl$\\Debian\\srv\\a b', { wsl: true }), '/srv/a b');
  assert.equal(engineFolder(' /home/k/sfx ', { wsl: true }), '/home/k/sfx');
  // --json output: whole stdout (pretty), or the last JSON line after log lines
  assert.deepEqual(parseJsonOut(['[', '  {"id":"synth"}', ']']), [{ id: 'synth' }]);
  assert.deepEqual(parseJsonOut(['indexing…', '{"ok":true}']), { ok: true });
  assert.deepEqual(parseJsonOut(['x', '[1,2]', 'tail']), [1, 2]);
  assert.equal(parseJsonOut(['nothing here']), null);
  const l = soundList([{ id: 'synth', kind: 'synth', license: 'own', enabled: true, files: null, indexed: 67, version: 2 },
    { id: 'kenney', kind: 'folder', path: 'library/kenney', license: 'CC0', enabled: false, files: 461, indexed: 461, version: 1 },
    { id: 'p', kind: 'folder', path: 'sfx', enabled: true, files: 'missing', indexed: 0, project: '/x' }, null]);
  assert.equal(l.dir, '');
  assert.deepEqual(l.sources.map((s) => [s.id, s.enabled, s.files, s.indexed, s.version]), [['synth', true, null, 67, 2], ['kenney', false, 461, 461, 1], ['p', true, 'missing', 0, null]]);
  assert.equal(soundList({ library: '/lib', sources: [] }).dir, '/lib');
  assert.equal(soundList({ library: { path: '/lib2' }, sources: [] }).dir, '/lib2');
  assert.equal(soundList({ nope: 1 }), null);
  const [synth, kenney, proj] = l.sources;
  assert.deepEqual([soundRowState(synth).entries, soundRowState(synth).canRemove, soundRowState(synth).status.kind], ['67 recipes', false, 'none']);
  assert.equal(soundRowState(kenney).entries, '461 / 461');
  assert.equal(soundRowState(kenney).status.kind, 'note', 'a v1 index offers a re-index');
  assert.ok(soundRowState(kenney).canRemove && soundRowState(kenney).canToggle);
  const p = soundRowState(proj);
  assert.ok(p.readOnly && !p.canRemove && !p.canToggle && /gfx\.json/.test(p.status.text));
  assert.equal(soundRowState({ ...kenney, indexed: 0, version: null }).status.kind, 'warn');
  const run = soundRowState(kenney, { done: 3, total: 12, rate: 2.5, finished: false });
  assert.deepEqual([run.status.kind, run.status.pct, run.status.text], ['progress', 25, 'Indexing 3 / 12 · 2.5 files/s']);
  assert.equal(soundRowState(kenney, { done: 0, total: 0, finished: false }).status.pct, null);
  assert.deepEqual(soundRowState(kenney, { finished: true }, 'boom').status, { kind: 'error', text: 'boom' });
  assert.equal(filesPerSec(0, 0, 1000), null);
  assert.equal(filesPerSec(10, 0, 2000), 5);
});

test('library paths (same cases as library.rs library_paths)', () => {
  assert.equal(checkLibRel('looks/clean-dark').kind, 'lookDir');
  assert.equal(checkLibRel('looks/clean-dark/LOOK.md').kind, 'lookFile');
  assert.equal(checkLibRel('looks/a/refs/shot 1.png').kind, 'lookFile');
  assert.equal(checkLibRel('presets/brand.js').kind, 'preset');
  assert.equal(checkLibRel('palettes/soft.json').kind, 'palette');
  assert.equal(checkLibRel('taste/sounds.json').kind, 'taste');
  for (const bad of ['taste', 'taste/x.json', 'taste/sounds.json/x']) assert.throws(() => checkLibRel(bad));
  for (const bad of ['looks', 'looks/Bad', 'looks/-a', 'looks/a/../b', '../x', '/abs', 'C:/x', 'presets/a.json', 'presets/x/y.js', 'palettes/a.js',
    'other/x', 'looks/a/.hidden', 'looks/a/b:c', 'looks/a/1/2/3/4/5', 'presets/A.js']) assert.throws(() => checkLibRel(bad), bad);
  assert.ok(checkLibWritable('looks/a/LOOK.md'));
  assert.ok(checkLibWritable('looks/a/refs/notes.txt'));
  assert.throws(() => checkLibWritable('looks/a'));
  assert.throws(() => checkLibWritable('looks/a/refs/x.png'), 'binary files are not written as text');
  assert.ok(checkLibRef('looks/a/refs/x.png'));
  assert.throws(() => checkLibRef('looks/a/x.png'));
  assert.throws(() => checkLibRef('looks/a/refs/x.exe'));
  assert.ok(checkRefDest('scenes/intro/refs/mood.jpg'));
  assert.ok(checkRefDest('scenes/intro/refs/clip.MP4'));
  for (const bad of ['scenes/intro/mood.jpg', 'scenes/intro/refs/a/b.jpg', 'scenes/../refs/x.png', 'out/x/refs/a.png', 'scenes/intro/refs/run.exe', 'scenes/intro/refs/.x.png']) assert.throws(() => checkRefDest(bad), bad);
  assert.equal(cleanFileName('a:b?.png'), 'a-b-.png');
  assert.equal(cleanFileName('..hidden.jpg'), 'hidden.jpg');
  assert.equal(cleanFileName(''), 'ref');
  assert.ok(validId('clean-dark') && !validId('Clean') && !validId('a-') && !validId(''));
  assert.equal(uniqueName('a.png', new Set(['a.png', 'a-2.png'])), 'a-3.png');
  assert.equal(uniqueName('a.png', new Set()), 'a.png');
});

test('LOOK.md meta, preset swatches, palette round trip', () => {
  const md = '---\nname: Clean dark\ndescription: Calm\ntags: [dark, minimal]\n---\n# x';
  assert.deepEqual(lookMeta(md), { name: 'Clean dark', description: 'Calm', tags: ['dark', 'minimal'] });
  assert.deepEqual(lookMeta('no frontmatter'), { name: null, description: null, tags: [] });
  assert.deepEqual(lookMeta(blankLook('My look', { tags: ['a'] })).tags, ['a']);
  const preset = "export default {\n  name: 'dark-grid',\n  colors: {\n    bg: '#111111',\n    accent: \"#d97757\",\n    soft: 'rgba(0,0,0,.2)',\n  },\n  radius: 8,\n};";
  assert.deepEqual(presetSwatches(preset), [{ key: 'bg', hex: '#111111' }, { key: 'accent', hex: '#d97757' }]);
  assert.deepEqual(presetSwatches('export default {}'), []);
  const cols = { bg: '4f63ff', grid: '5e70ff', stroke: '1f1a4d', text: 'ffffff', muted: 'c9d0ff', accent: 'ff4f9a', surface: 'ffffff', border: '1f1a4d', sun: 'ffd23f', mint: '2fe0a4', tangerine: 'ff8a3d', shadow: '2c37b8' };
  const many = `colors: { ${Object.entries(cols).map(([k, v]) => `${k}: '${'#' + v}'`).join(', ')} }`;
  assert.deepEqual(presetSwatches(many).map((c) => c.key), ['bg', 'text', 'accent', 'sun', 'mint', 'tangerine', 'shadow', 'grid'], 'key colours, then extra keys; duplicate hex skipped');
  assert.match(renamePreset(preset, 'look-x'), /name: 'look-x'/);
  const entries = parsePalette('[{"role":"whoosh","sound":"whoosh","variant":"air","params":{"pitch":-2},"tags":["soft"],"note":""},{"role":"hit","src":"kenney:a/b.ogg","x":1}]');
  assert.equal(entries.length, 2);
  const text = paletteText(entries);
  assert.equal(text, '[\n  { "role": "whoosh", "sound": "whoosh", "variant": "air", "params": { "pitch": -2 }, "tags": ["soft"] },\n  { "role": "hit", "src": "kenney:a/b.ogg", "x": 1 }\n]\n');
  assert.deepEqual(parsePalette(text).map((e) => e.role), ['whoosh', 'hit']);
  assert.equal(paletteText([]), '[]\n');
  assert.throws(() => parsePalette('{'), /not valid JSON/);
  assert.throws(() => parsePalette('{}'), /list/);
  assert.equal(paletteText([{ role: 'a', sound: 'tick', note: 'has ": , inside' }]), '[\n  { "role": "a", "sound": "tick", "note": "has \\": , inside" }\n]\n');
});

test('new-look brief and WSL paths', () => {
  assert.equal(wslPath('C:\\Users\\k\\Pictures\\a.png'), '/mnt/c/Users/k/Pictures/a.png');
  assert.equal(wslPath('\\\\wsl.localhost\\Ubuntu\\home\\k\\x.jpg'), '/home/k/x.jpg');
  assert.equal(wslPath('/home/k/x.jpg'), '/home/k/x.jpg');
  assert.equal(wslProject('\\\\wsl.localhost\\Ubuntu\\home\\k\\p', 'C:\\lib'), true);
  assert.equal(wslProject('/home/k/p', 'C:\\Users\\k\\gfx library'), true);
  assert.equal(wslProject('C:\\p', 'C:\\lib'), false);
  assert.equal(wslProject('/home/k/p', '/home/k/lib'), false);
  assert.equal(claudeLibPath('C:\\Users\\k\\Documents\\gfx library\\', true), '/mnt/c/Users/k/Documents/gfx library');
  assert.equal(claudeLibPath('C:\\lib', false), 'C:\\lib');
  assert.equal(makeLookMessage('soft', '/lib'), 'Make the look soft from its BRIEF.md (look-design skill). Library: /lib');
  assert.equal(rebuildSampleMessage('soft', '/lib'), 'Rebuild the sample scene of look soft (look-design skill). Library: /lib');
});

test('look BRIEF.md round trip (docs/LOOK-PIPELINE.md §5)', () => {
  const b = lookBriefText({ name: 'Ghibli  soft', prompt: 'Warm pastels.\n\nDrifting clouds.', notes: '', startFrom: 'both', sample: false,
    refs: [{ rel: 'refs/board.png', note: 'the colours\nand light' }, { url: 'https://example.com/x', note: '' }] });
  assert.match(b, /^---\nname: Ghibli soft\nstartFrom: both\nsample: no\n---\n/);
  assert.match(b, /## References\n- refs\/board\.png — the colours and light\n- https:\/\/example\.com\/x\n/);
  assert.deepEqual(parseLookBrief(b), { name: 'Ghibli soft', startFrom: 'both', sample: false, project: '', prompt: 'Warm pastels.\n\nDrifting clouds.', notes: '',
    refs: [{ rel: 'refs/board.png', note: 'the colours and light' }, { url: 'https://example.com/x', note: '' }] });
  const e = parseLookBrief(lookBriefText({ name: 'X', startFrom: 'nope' }));
  assert.deepEqual([e.startFrom, e.sample, e.prompt, e.refs], ['references', true, '', []]);
  assert.match(lookBriefText({ name: 'X', startFrom: 'project' }), /- project: this project/);
  const pr = lookBriefText({ name: 'X', startFrom: 'prompt', project: '/p' });
  assert.match(pr, /^---\nname: X\nstartFrom: prompt\nsample: yes\n---\n/);
  assert.equal(parseLookBrief(pr).startFrom, 'prompt');
  const proj = claudeLibPath('\\\\wsl.localhost\\Ubuntu\\home\\k\\proj\\', wslProject('\\\\wsl.localhost\\Ubuntu\\home\\k\\proj\\', 'C:\\lib'));
  assert.equal(proj, '/home/k/proj');
  for (const sf of ['project', 'both']) {
    const t = lookBriefText({ name: 'X', startFrom: sf, project: proj });
    assert.match(t, new RegExp(`^---\\nname: X\\nstartFrom: ${sf}\\nsample: yes\\nproject: /home/k/proj\\n---\\n`));
    assert.equal(parseLookBrief(t).project, '/home/k/proj');
  }
  assert.doesNotMatch(lookBriefText({ name: 'X', startFrom: 'references', project: proj }), /^project:/m, 'no project line when starting from references');
});

test('look media, byte reads, palette alt line, preview progress', () => {
  assert.ok(checkLibBytes('looks/a/thumb.jpg') && checkLibBytes('looks/a/preview.mp4') && checkLibBytes('looks/a/refs/clip.WEBM') && checkLibBytes('looks/a/refs/x.svg'));
  for (const bad of ['looks/a/LOOK.md', 'looks/a/x.mov', 'looks/a', 'presets/a.js', 'looks/a/sample/scene.js']) assert.throws(() => checkLibBytes(bad), bad);
  const files = [{ path: 'looks/a/LOOK.md', size: 1, mtime: 1 }, { path: 'looks/a/thumb.jpg', size: 9, mtime: 5 }, { path: 'looks/a/sample/scene.json', size: 1, mtime: 1 },
    { path: 'looks/ab/preview.mp4', size: 1, mtime: 1 }, { path: 'looks/b/BRIEF.md', size: 1, mtime: 1 }];
  const a = lookFiles(files, 'a');
  assert.deepEqual([a.look, a.brief, a.thumb?.path, a.preview, a.sample, a.analysis], [true, false, 'looks/a/thumb.jpg', null, true, false]);
  assert.deepEqual([lookFiles(files, 'b').brief, lookFiles(files, 'b').look], [true, false]);
  assert.equal(fileKey(a.thumb), 'looks/a/thumb.jpg|9|5');
  const png = { path: 'looks/a/thumb.png', size: 8, mtime: 6 };
  assert.equal(lookFiles([...files, png], 'a').thumb.path, 'looks/a/thumb.jpg', 'jpg preferred when both exist');
  assert.equal(lookFiles([...files.filter((f) => f.path !== 'looks/a/thumb.jpg'), png], 'a').thumb, png, 'png fallback for cards and Preview');

  assert.equal(fileKey(null), '');
  assert.equal(altLine({ src: 'kenney:ui/click.ogg', alt: { sound: 'click', variant: 'soft' } }), '↳ synth: click soft');
  assert.equal(altLine({ src: 'kenney:ui/click.ogg', alt: { sound: 'whoosh' } }), '↳ synth: whoosh');
  assert.equal(altLine({ src: 'k:x', alt: {} }), '');
  assert.deepEqual(parsePalette(paletteText(parsePalette('[{"role":"hit","src":"k:a.ogg","alt":{"sound":"thump","variant":"deep"}}]')))[0].alt, { sound: 'thump', variant: 'deep' }, 'palette edits keep alt');
  assert.equal(altLine({ sound: 'tick', alt: { sound: 'click' } }), '', 'synth rows have no fallback line');
  assert.equal(previewStatus({ phase: 'copy' }), 'Copying the look into a temp project…');
  assert.equal(previewStatus({ phase: 'preview', done: 36, total: 144 }), 'Rendering the preview clip 25%');
  assert.equal(previewStatus({ phase: 'thumbnail', done: 0, total: 1 }), 'Rendering the thumbnail…', 'no 0% before anything is done');
  assert.equal(previewStatus({ phase: 'other' }), '');
});

test('palette autosave captures edits, flushes before switching, and orders in-flight writes', async () => {
  const writes = [];
  let release;
  const first = new Promise((r) => { release = r; });
  const saver = paletteSaver(async (target, rel, text) => {
    if (!writes.length) await first;
    writes.push({ target, rel, entries: JSON.parse(text) });
  });
  let pal = { rel: 'palettes/a.json', entries: [{ role: 'edited', sound: 'tick', tags: ['soft'], note: 'keep' }] };
  const a = pal;
  saver.schedule(pal);
  const saving = saver.flush();
  pal = { rel: 'palettes/b.json', entries: [] };
  saver.schedule(pal);
  const done = saver.flush();
  pal = null; // closing must not redirect or break the pending save
  a.entries[0].note = 'later';
  release();
  await saving; await done;
  assert.deepEqual(writes.map((w) => w.rel), ['palettes/a.json', 'palettes/b.json']);
  assert.equal(writes[0].target, a);
  assert.deepEqual(writes[0].entries[0], { role: 'edited', sound: 'tick', tags: ['soft'], note: 'keep' });
  await saver.flush();
  assert.equal(writes.length, 2);
});

test('palette autosave debounces the captured text without requiring a flush', async () => {
  const writes = [];
  let saved;
  const done = new Promise((resolve) => { saved = resolve; });
  const saver = paletteSaver(async (_target, rel, text) => { writes.push([rel, JSON.parse(text)]); saved(); }, 1);
  const a = { rel: 'looks/a/sounds.json', entries: [{ role: 'old', sound: 'tick' }] };
  saver.schedule(a);
  a.entries[0].role = 'new';
  saver.schedule(a);
  await done;
  await saver.flush();
  assert.deepEqual(writes, [['looks/a/sounds.json', [{ role: 'new', sound: 'tick' }]]]);
});
