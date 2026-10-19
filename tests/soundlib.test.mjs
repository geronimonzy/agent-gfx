// Sound library tags, ranking and CLI (docs/SOUND-LIBRARY.md §6). Pure parts always run; the CLI / re-tag parts use a
// temp GFX_LIBRARY (never the real sources.json) with the repo's CLAP model linked in (skipped when it is missing).
// Run: node tests/soundlib.test.mjs   (needs ffmpeg; no browser)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { roleOf, tagsOf, similar, queryFromCue, entriesOf, ROLE_GROUPS, ROLES, RANK_VERSION, KW, stem, queryTokens, entryTokens, keywordScore } from '../runner/lib/sound-rank.js';
import { makeCue, resolveCues, SOUND_NAMES, VARIANTS, defaultStem } from '../runner/lib/sfx.js';
import { synthRecipes, synthEntryId } from '../runner/lib/library/indexer.js';
import { bandEnergies, embToB64, CLAP_LABELS } from '../runner/lib/vox-features.js';
import { runFfmpeg } from '../runner/lib/ffmpeg.js';
import { resolveRef, sceneCues } from '../runner/lib/cli/commands/lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : '')); } };

// ---------- pure ----------
console.log('roleOf / tagsOf');
{
  ok(ROLES.every((r) => ROLE_GROUPS[r]?.length) && Object.values(ROLE_GROUPS).flat().every((l) => CLAP_LABELS.includes(l)), 'every group label is a CLAP label');
  const short = { dur: 0.1, attack: 0.002, env: [1, 0.5, 0.2, 0.1, 0, 0, 0, 0] };
  ok(roleOf([['click', 0.5], ['thud', 0.3]], short).role === 'ui', 'short click -> ui');
  ok(roleOf([{ label: 'whoosh', score: 0.4 }, { label: 'click', score: 0.4 }], { dur: 0.9, attack: 0.3, env: [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1, 0.5] }).role === 'motion', 'long rising whoosh/click -> motion (priors)');
  ok(roleOf({ thud: 0.6, ding: 0.2 }).role === 'hits', 'object form, no features');
  const n = roleOf([], short);
  ok(n.role === null && n.roleScore === 0, 'no labels -> unknown');
  const r = roleOf([['click', 0.5], ['ding', 0.5]]);
  ok(r.role === 'ui' && r.roleScore === 0.5, 'roleScore = winning share', r);
  const t = tagsOf({ probs: [{ label: 'pop', score: 0.1 }, { label: 'click', score: 0.6 }, { label: 'tick', score: 0.2 }, { label: 'ding', score: 0.1 }], features: short, bands: [0.1, 0.6, 0.3] });
  ok(t.labels.length === 3 && t.labels[0][0] === 'click' && t.labels[0][1] === 0.6 && t.role === 'ui' && t.bands[1] === 0.6, 'tagsOf: top 3 sorted, role, bands', t);
  const s = tagsOf({ probs: [['click', 0.9]], features: short, sound: 'impact' });
  ok(s.role === 'hits' && s.roleScore === 1, 'synth: role = defaultStem, score 1', s);
  ok(Number.isInteger(RANK_VERSION), 'RANK_VERSION');
}

console.log('bandEnergies');
{
  const tone = (hz, sec = 0.3) => { const x = new Float32Array(Math.round(48000 * sec)); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / 48000); return x; };
  const lo = bandEnergies(tone(100)), mid = bandEnergies(tone(1000)), hi = bandEnergies(tone(8000));
  ok(lo[0] > 0.9 && mid[1] > 0.9 && hi[2] > 0.9, 'sines land in their band', { lo, mid, hi });
  ok(Math.abs(mid[0] + mid[1] + mid[2] - 1) < 0.002, 'shares sum to 1');
  ok(bandEnergies(new Float32Array(4800)).every((v) => v === 0), 'silence -> zeros');
}

console.log('similar');
{
  const unit = (...v) => { const s = Math.hypot(...v); return Float32Array.from(v.map((x) => x / s)); };
  const fv = (d) => Array.from({ length: 20 }, (_, i) => (i === 0 ? d : 0.5));
  const mk = (id, emb, dur, role, rs = 0.9, bands = [0.2, 0.6, 0.2]) => ({ id, emb, fv: fv(dur), dur, tags: role === undefined ? undefined : { role, roleScore: rs, bands, labels: [] } });
  const q = mk('q', unit(1, 0, 0), 0.2, 'ui');
  const E = [
    mk('a', unit(1, 0.1, 0), 0.2, 'ui'),
    mk('b', unit(1, 0.1, 0), 0.2, 'hits'),            // confident other role: dropped
    mk('c', unit(1, 0.1, 0), 0.2, 'hits', 0.3),       // uncertain: kept, lower
    mk('d', unit(1, 0.1, 0), 0.2, undefined),          // unknown: kept, neutral
    mk('e', unit(1, 0.1, 0), 2.0, 'ui'),               // 10x longer: dropped
    mk('f', unit(0, 1, 0), 0.2, 'ui'),                 // same role, unlike
    q,
  ];
  let r = similar(q, E);
  const ids = r.map((h) => h.entry.id);
  ok(ids.join() === 'a,d,c,f', 'role filter + uncertain lower + unknown neutral + duration window + no self', ids);
  ok(r[0].why.includes('same role') && r[0].why.includes('sounds alike') && typeof r[0].score === 'number', 'why text', r[0]);
  ok(similar(q, E, { role: 'hits' }).map((h) => h.entry.id).join() === 'b,d,c', 'explicit role wins over the query\'s', similar(q, E, { role: 'hits' }).map((h) => h.entry.id));
  ok(similar(q, E, { maxDur: 5 }).some((h) => h.entry.id === 'e'), 'maxDur overrides the window');
  ok(similar(q, E, { n: 2, exclude: ['a'] }).map((h) => h.entry.id).join() === 'd,c', 'n + exclude ids');
  ok(similar(q, E, { exclude: (e) => e.id === 'd' }).every((h) => h.entry.id !== 'd'), 'exclude predicate');
  const tie = [mk('z', unit(1, 0, 0), 0.2, 'ui'), mk('y', unit(1, 0, 0), 0.2, 'ui')];
  ok(similar(q, tie).map((h) => h.entry.id).join() === 'y,z', 'ties: by id');
  ok(similar({ ...q, tags: undefined, id: 'q2' }, E).length === 6, 'query without tags: no role filter');
  const raw = { id: 'raw', emb: embToB64(unit(1, 0.1, 0)), features: { dur: 0.2, env: new Array(32).fill(0.5), peakDb: -6, attack: 0.01, decay: 0.1, centroid: 1000, centroidSlope: 0, flatness: 0.1, pitch: { voiced: 0, hz: 0, slope: 0 }, zcr: 1000, onsets: 1 }, dur: 0.2, tags: { role: 'ui', roleScore: 0.9 } };
  ok(similar(q, [raw])[0]?.entry === raw, 'raw index lines (base64 emb + features) work');
  ok(similar({ id: 'x', src: 'lib/a.wav', start: 0, emb: unit(1, 0, 0), dur: 0.2 }, [{ id: 'y', src: 'lib/a.wav', start: 0, emb: unit(1, 0, 0), dur: 0.2 }]).length === 0, 'same src + start = the query itself');
}

console.log('queryFromCue');
{
  const S = [
    { id: 'synth:impact/thud/i0.25', synth: { sound: 'impact', variant: 'thud', intensity: 0.25 } },
    { id: 'synth:impact/thud/i0.55', synth: { sound: 'impact', variant: 'thud', intensity: 0.55 } },
    { id: 'synth:impact/punch/i0.9', synth: { sound: 'impact', variant: 'punch', intensity: 0.9 } },
    { id: 'synth:whoosh/air/i0.55/d0.35', synth: { sound: 'whoosh', variant: 'air', intensity: 0.55, dur: 0.35 } },
    { id: 'synth:whoosh/air/i0.55/d0.9', synth: { sound: 'whoosh', variant: 'air', intensity: 0.55, dur: 0.9 } },
    { id: 'synth:click', synth: { sound: 'click' } },
  ];
  const F = [{ id: 'k:a.ogg', src: 'library/k/a.ogg', start: 0 }, { id: 'k:long.ogg#1.50', src: 'library/k/long.ogg', start: 1.5 }];
  ok(queryFromCue({ sound: 'impact', variant: 'thud', intensity: 0.3 }, S)?.id === 'synth:impact/thud/i0.25', 'nearest intensity within the variant');
  ok(queryFromCue({ sound: 'impact' }, S)?.id === 'synth:impact/thud/i0.55', 'default intensity (0.55), any variant');
  ok(queryFromCue({ sound: 'whoosh', variant: 'air', dur: 1 }, S)?.id === 'synth:whoosh/air/i0.55/d0.9', 'nearest length');
  ok(queryFromCue({ sound: 'whoosh', variant: 'air' }, S)?.id === 'synth:whoosh/air/i0.55/d0.35', 'nominal length (air 0.4)');
  ok(queryFromCue({ sound: 'click' }, new Map([['synth', S], ['k', F]]))?.id === 'synth:click', 'Map(source -> entries)');
  ok(queryFromCue({ sound: 'sample', src: 'library/k/long.ogg', start: 1.5 }, { synth: S, k: F })?.id === 'k:long.ogg#1.50', 'sample: src + start');
  ok(queryFromCue({ sound: 'sample', src: 'library/k/none.ogg' }, F) === null && queryFromCue({ sound: 'chime' }, S) === null, 'no match -> null');
  ok(entriesOf(new Map(F.map((e) => [e.id, e]))).length === 2, 'entriesOf: Map(id -> entry)');
}

console.log('keyword score (hybrid lib search)');
{
  ok(stem('clicks') === 'click' && stem('placed') === stem('place') && stem('wooden') === 'wood' && stem('punchy') === 'punch' && stem('tap') === 'tap', 'stem');
  ok(queryTokens('A book placed on the table, 2 sounds').join() === 'book,placed,table', 'queryTokens: stopwords / numbers dropped', queryTokens('A book placed on the table, 2 sounds'));
  const punch = { id: 'kenney:impact/Audio/impactPunch_medium_002.ogg' }, step = { id: 'kenney:impact/Audio/footstep_carpet_001.ogg' };
  ok(keywordScore(queryTokens('impact punch'), punch) === 1 && keywordScore(queryTokens('impact punch'), step) === 0.25, 'file name words 1, folder 0.5', [keywordScore(queryTokens('impact punch'), punch), keywordScore(queryTokens('impact punch'), step)]);
  ok(keywordScore(queryTokens('punchy impacts'), punch) === 1, 'stemmed query words');
  ok(keywordScore(queryTokens('book place'), { id: 'kenney:rpg/Audio/bookPlace1.ogg' }) === 1 && keywordScore(queryTokens('book placed on table'), { id: 'kenney:rpg/Audio/bookPlace1.ogg' }) > 0.6, 'camelCase + digits split');
  ok(keywordScore(queryTokens('mouse release'), { id: 'kenney:ui/Audio/mouserelease1.ogg' }) === 1, 'adjacent query words match a joined file word');
  const lab = { id: 'k:x/switch5.ogg', tags: { labels: [['click', 0.9], ['paper rustle', 0.05]], role: 'hits' } };
  ok(keywordScore(['click'], lab) === 0.5 && keywordScore(['rustle'], lab) === 0.5 && keywordScore(['hit'], lab) === 0.3, 'labels 0.5, role 0.3 (hits -> hit)');
  ok(keywordScore(['audio'], punch) === 0 && keywordScore([], punch) === 0, 'Audio folder / empty query: 0');
  const wind = { id: 'synth:wind/breeze/i0.25/d3', synth: { sound: 'wind', variant: 'breeze', intensity: 0.25, dur: 3 } };
  ok(keywordScore(queryTokens('wind'), wind) === 1 && Math.abs(keywordScore(queryTokens('soft breeze'), wind) - 0.8) < 1e-9 && entryTokens(wind).get('synth') === 0.5, 'synth: sound / variant 1, description words 0.6', [...entryTokens(wind)]);
  ok(keywordScore(queryTokens('i0'), wind) === 0, 'synth id parameters are not words');
  ok(KW.weight > 0 && KW.weakClap > 0 && KW.weakKw > 0, 'KW weights');
}

console.log('synth beep / wind');
{
  ok(SOUND_NAMES.includes('beep') && SOUND_NAMES.includes('wind') && defaultStem('beep') === 'ui' && defaultStem('wind') === 'motion', 'beep (ui) / wind (motion) are synth sounds');
  ok(VARIANTS.beep.join() === 'soft,digital' && VARIANTS.wind.join() === 'breeze,gust', 'variants');
  const c = makeCue(1, 'wind', { variant: 'gust', dur: 4, intensity: 0.3 });
  ok(c.stem === 'motion' && c.dur === 4 && c.variant === 'gust' && c.intensity === 0.3, 'wind cue keeps dur / variant / intensity', c);
  const r = resolveCues([makeCue(1, 'beep', { id: 'b1' }), makeCue(2, 'beep', { id: 'b2', variant: 'loud' }), makeCue(3, 'wind', { id: 'w' })]);
  ok(!r.cues[0].variant && !r.cues[2].variant && r.warnings.length === 1 && /variant "loud"/.test(r.warnings[0]), 'no auto variant (recipe defaults soft / breeze); bad variant warned', r);
  const rec = synthRecipes().filter((o) => o.sound === 'beep' || o.sound === 'wind');
  ok(rec.length === 2 + 12 && rec.every((o) => o.sound === 'beep' || o.dur <= 3), 'index recipes: beep x2, wind x2 variants x3 intensities x2 lengths (<= 3 s: fits the slot)', rec.map(synthEntryId));
  const W = rec.filter((o) => o.sound === 'wind').map((o) => ({ id: synthEntryId(o), synth: o }));
  ok(queryFromCue({ sound: 'wind', variant: 'breeze', intensity: 0.4 }, W)?.id === 'synth:wind/breeze/i0.25/d3', 'queryFromCue: wind nominal 2.5 s');
}

// ---------- CLI + re-tag (temp library) ----------
const MODELS = path.join(ROOT, 'library', '.models');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-soundlib-'));
const LIB = path.join(tmp, 'global', 'library');
const cli = (args, env = {}) => {
  const e = { ...process.env, GFX_LIBRARY: LIB, ...env };
  delete e.GFX_PROJECT;
  // File-backed output also works in sandboxes that deny spawnSync's pipe capture (EPERM).
  const stdout = path.join(tmp, 'cli.stdout'), stderr = path.join(tmp, 'cli.stderr');
  const out = fs.openSync(stdout, 'w'), err = fs.openSync(stderr, 'w');
  try {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, env: e, stdio: ['ignore', out, err], timeout: 300000 });
    return { code: r.error ? null : r.status, out: fs.readFileSync(stdout, 'utf8'), err: fs.readFileSync(stderr, 'utf8') + (r.error ? `\n${r.error.message}` : '') };
  } finally { fs.closeSync(out); fs.closeSync(err); }
};
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
try {
  fs.mkdirSync(path.join(tmp, 'sounds'), { recursive: true });
  fs.mkdirSync(path.join(LIB, 'index'), { recursive: true });
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=1500:duration=0.12', '-af', 'afade=t=out:st=0.02:d=0.1', path.join(tmp, 'sounds', 'blip.wav')]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=80:duration=0.4', '-af', 'afade=t=out:st=0.05:d=0.35', path.join(tmp, 'sounds', 'thump.wav')]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.6:c=pink:a=0.4', '-af', 'afade=t=in:d=0.5', path.join(tmp, 'sounds', 'swell.wav')]);
  fs.writeFileSync(path.join(LIB, 'sources.json'), JSON.stringify({ sources: [{ id: 'synth', kind: 'synth', license: 'own', enabled: false }, { id: 'tst', kind: 'folder', path: path.join(tmp, 'sounds'), license: 'CC0', enabled: true }] }));

  console.log('lib list --json / add --json');
  let r = cli(['lib', 'list', '--json']);
  let j = json(r);
  ok(r.code === 0 && j?.library === LIB && Array.isArray(j.sources) && j.sources.length === 2, 'list --json: { library, sources }', r.out + r.err);
  j = j?.sources;
  const t0 = j?.find((s) => s.id === 'tst');
  ok(t0 && t0.kind === 'folder' && t0.files === 3 && t0.indexed === 0 && t0.version === null && t0.enabled === true && t0.license === 'CC0' && t0.path && t0.dir, 'list: folder row fields', t0);
  ok(j?.find((s) => s.id === 'synth')?.files > 0, 'list: synth files = recipes');
  fs.mkdirSync(path.join(tmp, 'other'));
  r = cli(['lib', 'add', 'other', path.join(tmp, 'other'), '--license', 'own', '--json']);
  j = json(r);
  ok(r.code === 0 && j?.id === 'other' && j.kind === 'folder' && j.license === 'own' && j.enabled === true && j.exists === true, 'add --json', r.out + r.err);

  console.log('lib remove');
  fs.writeFileSync(path.join(LIB, 'index', 'other.jsonl'), '{"id":"other:x.wav"}\n');
  fs.writeFileSync(path.join(LIB, 'index', 'other.meta.json'), '{}\n');
  fs.writeFileSync(path.join(tmp, 'other', 'keep.wav'), 'x');
  r = cli(['lib', 'remove', 'other', '--json']);
  j = json(r);
  ok(r.code === 0 && j?.removed === 'other' && j.deleted.length === 2, 'remove --json', r.out + r.err);
  ok(!fs.existsSync(path.join(LIB, 'index', 'other.jsonl')) && !fs.existsSync(path.join(LIB, 'index', 'other.meta.json')) && fs.existsSync(path.join(tmp, 'other', 'keep.wav')), 'index deleted, audio kept');
  ok(!JSON.parse(fs.readFileSync(path.join(LIB, 'sources.json'), 'utf8')).sources.some((s) => s.id === 'other'), 'source gone from sources.json');
  ok(!fs.readdirSync(LIB).some((f) => f.endsWith('.tmp')), 'atomic save leaves no temp file');
  r = cli(['lib', 'remove', 'synth']);
  ok(r.code !== 0 && /built in/.test(r.err), 'remove refuses synth', r.err);
  r = cli(['lib', 'remove', 'nope']);
  ok(r.code !== 0 && /unknown source/.test(r.err), 'remove: unknown id');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, 'scenes', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'sfx'));
  fs.writeFileSync(path.join(proj, 'gfx.json'), JSON.stringify({ name: 'p', library: { sources: [{ id: 'proj-sfx', path: 'sfx', license: 'own' }] } }));
  fs.writeFileSync(path.join(proj, 'scenes', 'demo', 'scene.json'), JSON.stringify({ name: 'demo', kind: 'canvas', width: 320, height: 180, fps: 30, duration: 2 }));
  r = cli(['lib', 'remove', 'proj-sfx', '--project', proj]);
  ok(r.code !== 0 && /gfx\.json/.test(r.err), 'remove refuses project sources', r.err);

  console.log('context: Sound library line');
  r = cli(['context', 'demo', '--project', proj]);
  ok(r.code === 0 && /^Sound library: tst \(not indexed, CC0\), proj-sfx \(not indexed, own\) · find sounds: gfx lib search "<text>" --json \/ gfx lib similar <scene>:<cue> --json$/m.test(r.out), 'context md line', r.out + r.err);
  r = cli(['context', 'demo', '--project', proj, '--format', 'json']);
  j = json(r);
  ok(j?.soundLibrary?.length === 2 && j.soundLibrary[0].id === 'tst' && j.soundLibrary[0].entries === 0, 'context json: soundLibrary', j?.soundLibrary);

  console.log('lib info / files / --help (no CLAP)');
  r = cli(['lib', 'info', path.join(tmp, 'sounds', 'blip.wav'), '--json']);
  j = json(r);
  ok(r.code === 0 && j?.installed === true && j.source === 'tst' && j.license === 'CC0' && j.sourcePath === 'blip.wav' && j.indexed === false && Math.abs(j.fileDur - 0.12) < 0.01 && j.path === path.join(tmp, 'sounds', 'blip.wav'), 'info <abs path> --json', r.out + r.err);
  r = cli(['lib', 'info', 'tst/thump.wav', '--json']);
  j = json(r);
  ok(r.code === 0 && j?.installed && j.src === path.join(tmp, 'sounds', 'thump.wav') && j.dur === j.fileDur, 'info <source>/<file>; src outside the library parent = absolute', r.out + r.err);
  r = cli(['lib', 'info', 'tst:swell.wav']);
  ok(r.code === 0 && /\(tst, CC0\)/.test(r.out) && /not indexed/.test(r.out), 'info <entry id form> (text)', r.out + r.err);
  r = cli(['lib', 'info', 'library/kenney/none.ogg', '--json']);
  j = json(r);
  ok(r.code === 1 && j?.installed === false && j.ref === 'library/kenney/none.ogg', 'info: not installed -> exit 1 (json)', r.out + r.err);
  r = cli(['lib', 'info', 'synth:beep/soft']);
  ok(r.code === 1 && /not installed/.test(r.err), 'info: synth entry not indexed -> exit 1', r.out + r.err);
  r = cli(['lib', 'files', '--json']);
  j = json(r);
  ok(r.code === 0 && j?.length === 3 && j.every((x) => x.source === 'tst' && x.indexed === false && x.license === 'CC0' && x.id.startsWith('tst:')), 'files --json (enabled sources, not indexed)', r.out + r.err);
  r = cli(['lib', 'files', '--grep', 'THU']);
  ok(r.code === 0 && r.out.trim().split('\n').length === 1 && /tst:thump\.wav/.test(r.out), 'files --grep (case-insensitive)', r.out);
  r = cli(['lib', 'files', '--role', 'bogus']);
  ok(r.code !== 0 && /unknown role/.test(r.err), 'files: unknown role');
  r = cli(['lib', '--help']);
  ok(r.code === 0 && /lib info/.test(r.out) && /lib files/.test(r.out) && /weak/.test(r.out), 'lib --help', r.out + r.err);

  console.log('scene cue paths / stale audio cache (no browser or CLAP)');
  const savedEnv = { GFX_LIBRARY: process.env.GFX_LIBRARY, GFX_PROJECT: process.env.GFX_PROJECT };
  process.env.GFX_LIBRARY = LIB;
  process.env.GFX_PROJECT = proj;
  try {
    const I = await import('../runner/lib/library/indexer.js');
    const C = await import('../runner/lib/library/config.js');
    const dir = path.join(proj, 'scenes', 'demo');
    const audio = path.join(proj, 'out', 'demo', 'audio');
    const fix = path.join(dir, 'sound.json');
    const sample = path.join(proj, 'sfx', 'tap.wav');
    fs.copyFileSync(path.join(tmp, 'sounds', 'blip.wav'), sample);
    const librarySample = path.join(LIB, 'click.wav');
    fs.copyFileSync(sample, librarySample);
    const fileEntry = { id: 'proj-sfx:tap.wav', src: C.relSrc(sample), start: 0 };
    const segment = { ...fileEntry, id: 'proj-sfx:tap.wav#1.5', start: 1.5 };
    const libraryEntry = { id: 'proj-sfx:click.wav', src: C.relSrc(librarySample), start: 0 };
    const driveEntry = { id: 'proj-sfx:drive.wav', src: '/mnt/d/sounds/tap.wav', start: 0 };
    fs.mkdirSync(path.dirname(C.indexFile('proj-sfx')), { recursive: true });
    fs.writeFileSync(C.indexFile('proj-sfx'), [fileEntry, segment, libraryEntry, driveEntry].map((e) => JSON.stringify(e)).join('\n') + '\n');
    ok(path.isAbsolute(fileEntry.src), 'project outside library parent stores absolute src', fileEntry);
    let cues = [{ id: 'tap', sound: 'sample', src: 'sfx/tap.wav', stem: 'ui', t: 0 }];
    let reads = 0;
    const capture = async (name) => {
      if (name !== 'demo') throw new Error('unexpected scene');
      reads++;
      return { page: { evaluate: async () => structuredClone(cues) } };
    };
    const resolve = () => resolveRef(I, 'demo:tap', { capture });
    let resolved = await resolve();
    ok(resolved.query.id === fileEntry.id && resolved.role === 'ui', 'scene:cue matches project-relative sample to absolute indexed path');
    const priorExitCode = process.exitCode;
    let missingCue;
    try { await resolveRef(I, 'demo:nope', { capture }); } catch (e) { missingCue = e; }
    process.exitCode = priorExitCode;
    ok(missingCue?.handled && /no cue "nope"/.test(missingCue.message), 'similar: unknown cue');
    cues[0].src = sample;
    ok((await resolve()).query.id === fileEntry.id, 'absolute sample path matches');
    cues[0].src = 'sfx/../sfx/tap.wav';
    cues[0].start = 1.5;
    ok((await resolve()).query.id === segment.id, 'normalised path preserves segment start matching');
    cues[0].start = 0;
    cues[0].src = C.relSrc(librarySample);
    ok((await resolve()).query.id === libraryEntry.id, 'library-parent-relative sample matches');
    cues[0].src = librarySample;
    ok((await resolve()).query.id === libraryEntry.id, 'absolute sample matches library-relative indexed path');
    if (process.platform === 'linux' || process.platform === 'win32') {
      for (const src of ['D:/sounds/tap.wav', 'D:\\sounds\\tap.wav', '/mnt/d/sounds/tap.wav']) {
        cues[0].src = src;
        ok((await resolve()).query.id === driveEntry.id, `Windows/WSL sample path matches: ${src}`);
      }
      driveEntry.src = 'D:/sounds/tap.wav';
      fs.appendFileSync(C.indexFile('proj-sfx'), JSON.stringify({ ...driveEntry, id: 'proj-sfx:reverse.wav', start: 2 }) + '\n');
      cues[0].src = '/mnt/d/sounds/tap.wav';
      cues[0].start = 2;
      ok((await resolve()).query.id === 'proj-sfx:reverse.wav', 'Windows indexed path matches WSL cue path');
    }

    cues = [{ id: 'tap', sound: 'sample', src: 'sfx/tap.wav', stem: 'ui', t: 0, gain: -3 }];
    fs.writeFileSync(fix, JSON.stringify({ cues: { tap: { gain: -25 } } }));
    fs.mkdirSync(audio, { recursive: true });
    const cache = path.join(audio, 'cues.json');
    fs.writeFileSync(cache, JSON.stringify({ cues: [{ ...cues[0], gain: -25 }] }));
    const future = new Date(Date.now() + 60000);
    fs.utimesSync(cache, future, future);
    ok((await sceneCues('demo', capture))[0].gain === -25, 'fresh scene read applies current sound.json');
    fs.unlinkSync(fix);
    const before = reads;
    ok((await sceneCues('demo', capture))[0].gain === -3 && reads === before + 1, 'deleting sound.json ignores newer cached overrides and reads scene fresh');
    const input = path.join(dir, 'cues.js');
    fs.writeFileSync(input, '// scene cue input');
    cues.push({ id: 'extra', sound: 'click', t: 1 });
    fs.unlinkSync(input);
    ok((await sceneCues('demo', capture)).length === 2, 'deleting another scene input ignores newer audio cache');
    fs.writeFileSync(cache, 'invalid JSON');
    ok((await sceneCues('demo', capture)).length === 2, 'unverifiable or malformed cache reads scene fresh');
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(path.join(proj, '.gfx'), { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(MODELS, 'Xenova', 'clap-htsat-unfused', 'onnx', 'audio_model_quantized.onnx'))) console.log('  skip CLAP parts (no library/.models)');
  else {
    fs.symlinkSync(MODELS, path.join(LIB, '.models'));
    console.log('lib index (v2) + v1 -> v2 re-tag');
    r = cli(['lib', 'index', 'tst']);
    ok(r.code === 0 && /tst\s+3 files -> 3 entries/.test(r.out), 'index tst', r.out + r.err);
    const idx = path.join(LIB, 'index', 'tst.jsonl'), metaF = path.join(LIB, 'index', 'tst.meta.json');
    const read = () => fs.readFileSync(idx, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let E = read(), meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    ok(meta.version === 2 && meta.rank === RANK_VERSION && meta.entries === 3, 'meta: version 2, rank, entries', meta);
    ok(E.every((e) => e.tags && e.tags.labels.length === 3 && ROLES.includes(e.tags.role) && e.tags.bands.length === 3 && Math.abs(e.tags.bands.reduce((a, b) => a + b, 0) - 1) < 0.01), 'every entry tagged', E.map((e) => e.tags));
    const thump = E.find((e) => e.id.endsWith('thump.wav')), blip = E.find((e) => e.id.endsWith('blip.wav'));
    ok(thump.tags.bands[0] > 0.8 && blip.tags.bands[1] > 0.8, 'bands: 80 Hz low, 1.5 kHz mid', [thump.tags.bands, blip.tags.bands]);
    // make it v1: drop tags, swap the two embeddings (a re-embed would swap them back), meta version 1
    const v1 = E.map((e) => { const { tags, ...rest } = e; return rest; });
    const ea = v1[0].emb; v1[0].emb = v1[1].emb; v1[1].emb = ea;
    fs.writeFileSync(idx, v1.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(metaF, JSON.stringify({ model: meta.model, version: 1 }) + '\n');
    r = cli(['lib', 'list']);
    ok(/v1 index/.test(r.out), 'list flags a v1 index', r.out);
    r = cli(['lib', 'index', 'tst']);
    E = read(); meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    ok(r.code === 0 && /3 re-tagged/.test(r.out) && meta.version === 2, 'v1 index upgraded by re-tagging', r.out + r.err);
    ok(E[0].emb === v1[0].emb && E[1].emb === v1[1].emb, 'stored embeddings kept (no CLAP audio pass)');
    ok(E.every((e) => e.tags?.bands?.length === 3 && e.tags.labels.length === 3), 'tags + bands after the upgrade');
    // rank change: labels / role again from stored emb, bands kept without a decode
    fs.writeFileSync(metaF, JSON.stringify({ ...meta, rank: 0 }) + '\n');
    const before = E.map((e) => e.tags.bands.join());
    r = cli(['lib', 'index', 'tst']);
    ok(r.code === 0 && /3 re-tagged/.test(r.out) && read().map((e) => e.tags.bands.join()).join('|') === before.join('|'), 'RANK_VERSION change re-tags, bands kept', r.out);
    r = cli(['lib', 'index', 'tst']);
    ok(/3 reused, 0 failed/.test(r.out), 'up to date: nothing re-tagged', r.out);

    console.log('lib search / similar --json');
    const shape = (h) => h && ['id', 'source', 'src', 'start', 'dur', 'score', 'role', 'labels', 'license'].every((k) => k in h);
    r = cli(['lib', 'search', 'a low thump', '--json', '--n', '2']);
    j = json(r);
    ok(r.code === 0 && j?.length === 2 && j.every(shape) && j[0].source === 'tst' && j[0].license === 'CC0', 'search --json shape', r.out + r.err);
    const roleOfThump = read().find((e) => e.id.endsWith('thump.wav')).tags.role;
    r = cli(['lib', 'search', 'sound', '--json', '--role', roleOfThump, '--max-dur', '0.3']);
    j = json(r);
    ok(r.code === 0 && j.every((h) => h.dur <= 0.3 && (h.role === roleOfThump || !h.role)), '--role / --max-dur filter', j);
    r = cli(['lib', 'search', 'blip', '--json']);
    j = json(r);
    const bh = j?.find((h) => h.id === 'tst:blip.wav');
    ok(r.code === 0 && bh?.kw === 1 && bh.weak === false && Math.abs(bh.score - (bh.clap + KW.weight)) < 1e-3 && j.every((h) => typeof h.clap === 'number' && typeof h.weak === 'boolean' && (h === bh || h.kw === 0)) && j.every((h, i) => !i || j[i - 1].score >= h.score), 'search: file name word adds weight * kw (score = clap + 0.3), clap / kw / weak fields, sorted by score', j);
    r = cli(['lib', 'info', 'tst:blip.wav', '--json']);
    j = json(r);
    ok(r.code === 0 && j?.indexed && j.entries.length === 1 && ROLES.includes(j.entries[0].role) && j.entries[0].labels.length === 3 && j.dur === j.entries[0].dur && j.start === j.entries[0].start, 'info after index: entry tags, start / dur = the indexed region', j);
    r = cli(['lib', 'files', '--role', j.entries[0].role, '--json']);
    ok(r.code === 0 && json(r)?.some((x) => x.id === 'tst:blip.wav' && x.indexed), 'files --role (index tags)', r.out);
    r = cli(['lib', 'search', 'x', '--role', 'bogus']);
    ok(r.code !== 0 && /unknown role/.test(r.err + r.out), 'unknown role rejected');
    r = cli(['lib', 'similar', 'tst:blip.wav', '--json', '--role', 'any', '--min-dur', '0.01', '--max-dur', '5']);
    j = json(r);
    ok(r.code === 0 && j?.length >= 1 && j.every(shape) && j.every((h) => typeof h.why === 'string' && h.id !== 'tst:blip.wav'), 'similar <entry id> --json (+ why, no self)', r.out + r.err);
    r = cli(['lib', 'similar', path.join(tmp, 'sounds', 'thump.wav'), '--json', '--role', 'any', '--min-dur', '0.01', '--max-dur', '5']);
    j = json(r);
    ok(r.code === 0 && j?.length === 2 && !j.some((h) => h.id === 'tst:thump.wav'), 'similar <audio file>: embedded on the fly, own entry excluded', r.out + r.err);
    r = cli(['lib', 'similar', 'nothing-here']);
    ok(r.code !== 0 && /not an index entry id/.test(r.err), 'similar: bad ref');
    r = cli(['context', 'demo', '--project', proj]);
    ok(/Sound library: tst \(3, CC0\)/.test(r.out), 'context counts entries', r.out);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
