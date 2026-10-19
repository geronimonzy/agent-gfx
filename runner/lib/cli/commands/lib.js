// gfx lib — sound library (docs/VOX.md, docs/SOUND-LIBRARY.md).
import fs from 'node:fs';
import path from 'node:path';
import { openSynthRenderer, openCapture } from '../capture.js';
import { die, num, sceneDir, readJson } from '../util.js';
import { progress } from '../progress.js';
import { resolveCues } from '../../sfx.js';

const USAGE = 'usage: gfx lib list|add|remove|enable|disable|fetch|index|search|similar|info|files';
const HELP = `gfx lib — the sound library (docs/SOUND-LIBRARY.md)
  lib list [--json]                     sources (synth, Kenney, folders, project sources) with file / index counts
  lib add <id> <path> [--license ".."] | remove <id> | enable <id> | disable <id>
  lib fetch kenney [--packs ..] | fetch freesound --query "<q>"
  lib index [<id>...] [--force]         CLAP index (labels, role, bands) of the enabled sources
  lib search "<text>" [--role hits|motion|ui|accents|any] [--max-dur s] [--source id]... [--n 10] [--json]
                                        hybrid: CLAP text score + file name / folder / label words; score = clap + 0.3 * kw;
                                        weak: true = nothing fits well (low CLAP score, no word match): use the synth
  lib similar <entry id | audio file | scene:cueId> [--role r] [--max-dur s] [--min-dur s] [--source id]... [--n 8] [--json]
  lib info <src | entry id | path> [--json]   one file: resolved path, licence, duration, labels, role, bands, segments;
                                        exit 1 when it is not installed (a palette entry then uses its alt)
  lib files [--source <id>]... [--grep <text>] [--role <r>] [--json]   browse files (index tags when indexed)`;

export async function cmdLib(sub, o, pos) {
  if (!sub || sub === 'help' || o.help) { console.log(HELP); return; }
  const C = await import('../../library/config.js');
  const args = pos.slice(1);
  const kenneySummary = (r) => r.map((x) => `${x.pack}: ${x.error ? 'FAILED ' + x.error : x.files + ' files'}`).join('\n');
  const out = (v) => console.log(JSON.stringify(v, null, 2));
  switch (sub) {
    case 'list': {
      const cfg = C.loadSources();
      const rows = cfg.sources.map((s) => {
        let files = null, missing = false;
        if (s.kind === 'folder') { const d = C.sourceDir(s); if (fs.existsSync(d)) files = C.walkAudio(d).length; else missing = true; }
        const meta = C.indexMeta(s);
        const r = { id: s.id, kind: s.kind, path: s.path ?? null, dir: s.kind === 'folder' ? C.sourceDir(s) : null, license: s.license || 'unspecified', enabled: !!s.enabled, files, indexed: C.indexCount(s), version: meta?.version ?? null };
        if (missing) r.missing = true;
        if (s.project) r.project = s.project;
        return r;
      });
      if (o.json) {
        const I = await import('../../library/indexer.js');
        for (const r of rows) if (r.kind === 'synth') r.files = I.synthRecipes().length;
        out({ library: C.LIB, sources: rows });
        return;
      }
      for (const r of rows) console.log(`${r.id.padEnd(16)} ${r.kind.padEnd(7)} ${r.enabled ? 'enabled ' : 'disabled'} files ${String(r.kind === 'synth' ? 'built-in' : r.missing ? 'missing' : r.files).padStart(6)}  indexed ${String(r.indexed).padStart(6)}  ${r.license}${r.version === 1 ? '  (v1 index: gfx lib index re-tags)' : ''}`);
      return;
    }
    case 'add': {
      const [id, p] = args;
      if (!id || !p) die('usage: gfx lib add <id> <path> [--license "..."] [--json]');
      if (!/^[\w.-]+$/.test(id)) die('invalid source id');
      const cfg = C.loadSources();
      if (cfg.sources.some((s) => s.id === id)) die(`source "${id}" already exists`);
      const s = { id, kind: 'folder', path: p, license: o.license || 'unspecified', enabled: true };
      cfg.sources.push(s);
      C.saveSources(cfg);
      const dir = C.sourceDir(s);
      if (!fs.existsSync(dir)) console.error(`gfx: warning: folder not found (${dir})`);
      if (o.json) out({ ...s, dir, exists: fs.existsSync(dir) });
      else console.log(`added ${id} -> ${p}`);
      return;
    }
    case 'remove': {
      const id = args[0];
      if (!id) die('usage: gfx lib remove <id> [--json]   (the audio files stay where they are)');
      const cfg = C.loadSources();
      const s = cfg.sources.find((x) => x.id === id);
      if (!s) die(`unknown source "${id}"`);
      if (s.kind === 'synth') die('the synth source is built in and cannot be removed (gfx lib disable synth)');
      if (s.project) die(`source "${s.id}" comes from ${s.project}/gfx.json (library.sources); edit it there`);
      const files = [C.indexFile(s), C.indexFile(s).replace(/\.jsonl$/, '.meta.json')].filter((f) => fs.existsSync(f));
      C.saveSources({ ...cfg, sources: cfg.sources.filter((x) => x !== s) });
      for (const f of files) fs.rmSync(f, { force: true });
      if (o.json) out({ removed: id, deleted: files });
      else console.log(`removed ${id} (index deleted; audio files in ${s.path} kept)`);
      return;
    }
    case 'enable': case 'disable': {
      const cfg = C.loadSources();
      const s = cfg.sources.find((x) => x.id === args[0]);
      if (!s) die(`unknown source "${args[0]}"`);
      if (s.project) die(`source "${s.id}" comes from ${s.project}/gfx.json (library.sources); edit it there`);
      s.enabled = sub === 'enable';
      C.saveSources(cfg);
      console.log(`${s.id}: ${sub}d`);
      return;
    }
    case 'fetch': {
      const F = await import('../../library/fetch.js');
      if (args[0] === 'kenney') {
        const r = await F.fetchKenney(o.packs, console.log, progress);
        console.log(kenneySummary(r));
        if (r.every((x) => x.error)) die('no pack could be downloaded');
        ensureSource(C, 'kenney', C.relSrc(path.join(C.LIB, 'kenney')), 'CC0');
        return r.filter((x) => !x.error).map((x) => path.join(C.LIB, 'kenney', x.pack));
      } else if (args[0] === 'freesound') {
        if (!o.query) die('usage: gfx lib fetch freesound --query "<q>" [--n 50] [--min-dur 0.05 --max-dur 6]');
        const r = await F.fetchFreesound({ query: o.query, n: num(o.n, 50), minDur: num(o['min-dur'], 0.05), maxDur: num(o['max-dur'], 6) }, console.log, progress);
        if (r.missingKey) { console.error(F.FREESOUND_HELP); process.exitCode = 2; return; }
        ensureSource(C, 'freesound-cc0', C.relSrc(path.join(C.LIB, 'freesound-cc0')), 'CC0');
        console.log(`freesound: ${r.got} new files in ${r.dir} (${r.total} total, credits.json written)`);
        return [r.dir];
      }
      die('usage: gfx lib fetch kenney|freesound');
      return;
    }
    case 'index': {
      const I = await import('../../library/indexer.js');
      const cfg = C.loadSources();
      const ids = args.length ? args : cfg.sources.filter((s) => s.enabled).map((s) => s.id);
      let renderSynth = null;
      if (ids.some((id) => cfg.sources.find((s) => s.id === id)?.kind === 'synth')) renderSynth = await openSynthRenderer();
      const t0 = Date.now();
      const stats = await I.indexSources(args, { force: !!o.force, renderSynth, progress });
      for (const s of stats) console.log(`${s.id.padEnd(16)} ${s.missing ? 'folder missing' : `${s.files} files -> ${s.entries} entries (${s.reused} reused, ${s.retagged ? `${s.retagged} re-tagged, ` : ''}${s.failed || 0} failed) ${s.secs}s ${s.filesPerSec} files/s`}`);
      console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${C.INDEX_DIR}`);
      return stats.filter((s) => !s.missing).map((s) => C.indexFile(s.id));
    }
    case 'search': {
      const text = args.join(' ');
      if (!text) die('usage: gfx lib search "<text>" [--role hits|motion|ui|accents] [--max-dur s] [--source id]... [--n 10] [--json]');
      const I = await import('../../library/indexer.js');
      const hits = await I.searchLibrary(text, { sources: o.source || [], n: num(o.n, 10), role: o.role, maxDur: num(o['max-dur'], 0) });
      printHits(hits, o, licenses(C), '(no indexed entries match; run gfx lib index)');
      if (!o.json && hits[0]?.weak) console.log(`(weak match: nothing in the library fits "${text}" well; try other words, gfx lib files --grep, or a synth sound)`);
      return;
    }
    case 'similar': {
      const ref = args[0];
      if (!ref) die('usage: gfx lib similar <entry id | audio file | scene:cueId> [--role r] [--max-dur s] [--min-dur s] [--source id]... [--n 8] [--json]');
      const I = await import('../../library/indexer.js');
      const { query, role } = await resolveRef(I, ref);
      const hits = I.similarLibrary(query, { sources: o.source || [], role: o.role || role, n: num(o.n, 8), maxDur: num(o['max-dur'], 0), minDur: num(o['min-dur'], 0) });
      if (!o.json) console.log(`like ${query.id} (${query.dur}s${query.tags?.role ? ', ' + query.tags.role : ''})`);
      printHits(hits, o, licenses(C), '(nothing similar in the enabled sources; try --role or another --source)');
      return;
    }
    case 'info': {
      const ref = args.join(' ');
      if (!ref) die('usage: gfx lib info <src | entry id | path> [--json]   (exit 1 when not installed)');
      const r = await libInfo(C, ref);
      if (!r.installed) {
        if (o.json) out(r); else console.error(`gfx: not installed: ${ref} (no such file in the sound library or its sources${r.why ? '; ' + r.why : ''})`);
        process.exitCode = 1;
        return;
      }
      if (o.json) { out(r); return; }
      console.log(`${r.synth ? r.id : r.src}${r.source ? `  (${r.source}, ${r.license})` : ''}`);
      if (r.path) console.log(`path      ${r.path}`);
      if (r.fileDur != null) console.log(`file      ${r.fileDur}s`);
      if (r.dur != null) console.log(`sound     start ${r.start}s dur ${r.dur}s (silence trimmed; a cue's / palette entry's start / dur)`);
      if (r.synth) console.log(`synth     ${JSON.stringify(r.synth)}`);
      if (!r.indexed) console.log('not indexed (gfx lib index' + (r.source ? ' ' + r.source : '') + ')');
      for (const e of r.entries) console.log(`${e.id}  start ${e.start}s dur ${e.dur}s  ${e.role || '-'}${e.roleScore != null ? ` (${e.roleScore})` : ''}  ${e.labels.map((l) => `${l[0]} ${l[1]}`).join(', ')}${e.bands ? `  bands ${e.bands.join('/')}` : ''}`);
      return;
    }
    case 'files': {
      if (o.role && o.role !== 'any' && !['hits', 'motion', 'ui', 'accents'].includes(o.role)) die(`unknown role "${o.role}" (one of hits, motion, ui, accents, any)`);
      const rows = libFiles(C, { sources: o.source || [], grep: o.grep, role: o.role });
      if (o.json) { out(rows); return; }
      if (!rows.length) console.log('(no files match)');
      for (const r of rows) console.log(`${r.id}  ${r.dur != null ? r.dur.toFixed(2) + 's' : '?'}  ${r.role || '-'}${r.labels.length ? '  ' + r.labels.map((l) => l[0]).join('/') : ''}${r.segments > 1 ? `  ${r.segments} segments` : ''}${r.indexed ? '' : '  (not indexed)'}  [${r.license}]`);
      return;
    }
    default: die(USAGE);
  }
}

const entryJson = (e) => ({ id: e.id, start: e.start ?? 0, dur: e.dur, role: e.tags?.role ?? null, roleScore: e.tags?.roleScore ?? null, labels: e.tags?.labels ?? [], bands: e.tags?.bands ?? null });
const realOr = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
/**
 * One library file (or synth entry) by cue src (`library/kenney/...`, as lib search reports it), `<source>/<file>`,
 * entry id (`kenney:impact/Audio/x.ogg`, `synth:beep/soft`), project-relative or absolute path.
 * -> { installed, src, path, source, license, dur, fileDur, indexed, entries[] } | { installed: false, ref, why? }
 */
export async function libInfo(C, ref) {
  const cfg = C.loadSources();
  const lic = (s) => s?.license || 'unspecified';
  const I = await import('../../library/indexer.js');
  const byId = I.findEntry(ref.replace(/#[\d.]+$/, '')) || I.findEntry(ref);
  if (byId?.synth) {
    const s = cfg.sources.find((x) => x.kind === 'synth');
    return { installed: true, id: byId.id, src: null, path: null, source: s?.id || 'synth', license: lic(s), synth: byId.synth, start: 0, dur: byId.dur, fileDur: null, indexed: true, entries: [entryJson(byId)] };
  }
  if (/^synth:/.test(ref)) return { installed: false, ref, why: 'no such synth entry (gfx lib files --source synth)' };
  // candidate absolute paths
  const cands = [];
  if (byId?.src) cands.push(C.resolveSrc(byId.src));
  const m = /^([\w.-]+):(.+)$/.exec(ref);
  const folder = (id) => cfg.sources.find((s) => s.id === id && s.kind === 'folder');
  if (m && folder(m[1]) && !/^[A-Za-z]$/.test(m[1])) cands.push(path.join(C.sourceDir(folder(m[1])), m[2].replace(/#[\d.]+$/, '')));
  cands.push(C.resolveSrc(ref), path.join(C.LIB, ref));
  const first = ref.split(/[\\/]/)[0], rest = ref.slice(first.length + 1);
  if (folder(first) && rest) cands.push(path.join(C.sourceDir(folder(first)), rest));
  const abs = cands.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!abs) return { installed: false, ref };
  if (!C.AUDIO_EXT.has(path.extname(abs).toLowerCase())) return { installed: false, ref, why: 'not an audio file' };
  const real = realOr(abs);
  // owning source: the folder source whose dir contains the file
  let source = null, rel = null;
  for (const s of cfg.sources.filter((x) => x.kind === 'folder')) {
    const d = realOr(C.sourceDir(s)), r = path.relative(d, real);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) { source = s; rel = r; break; }
  }
  const src = C.relSrc(abs);
  const entries = source ? C.readIndex(source).filter((e) => e.src && realOr(C.resolveSrc(e.src)) === real) : [];
  let fileDur = null;
  try { const pcm = await I.decodeFile(abs); fileDur = +(pcm.length / 48000).toFixed(3); } catch { /* no ffmpeg / undecodable */ }
  const one = entries.length === 1 ? entries[0] : null;
  return {
    installed: true, src, path: abs, source: source?.id ?? null, sourcePath: rel ? rel.split(path.sep).join('/') : null,
    license: source ? lic(source) : 'unspecified', start: one ? one.start ?? 0 : 0, dur: one ? one.dur : fileDur, fileDur,
    indexed: entries.length > 0, entries: entries.map(entryJson),
  };
}
/** Files of the chosen (or enabled) sources with their index tags; synth = its index entries. grep: words over id + labels. */
export function libFiles(C, { sources = [], grep, role } = {}) {
  const cfg = C.loadSources();
  const pick = sources.length ? sources.map((id) => cfg.sources.find((s) => s.id === id) || die(`unknown source "${id}"`)) : cfg.sources.filter((s) => s.enabled);
  const words = grep ? String(grep).toLowerCase().split(/\s+/).filter(Boolean) : [];
  const rows = [];
  for (const s of pick) {
    const lic = s.license || 'unspecified';
    const idx = C.readIndex(s);
    if (s.kind === 'synth') {
      for (const e of idx) rows.push({ id: e.id, source: s.id, src: null, synth: e.synth, start: 0, dur: e.dur, role: e.tags?.role ?? null, labels: e.tags?.labels ?? [], segments: 1, indexed: true, license: lic });
      continue;
    }
    const dir = C.sourceDir(s);
    const bySrc = new Map();
    for (const e of idx) { if (!bySrc.has(e.src)) bySrc.set(e.src, []); bySrc.get(e.src).push(e); }
    for (const f of C.walkAudio(dir)) {
      const src = C.relSrc(f), es = bySrc.get(src) || [], e = es[0];
      rows.push({ id: `${s.id}:${path.relative(dir, f).split(path.sep).join('/')}`, source: s.id, src, start: e?.start ?? 0, dur: es.length === 1 ? e.dur : null, role: e?.tags?.role ?? null, labels: e?.tags?.labels ?? [], segments: es.length, indexed: es.length > 0, license: lic });
    }
  }
  return rows.filter((r) => {
    if (role && role !== 'any' && r.role !== role) return false;
    if (!words.length) return true;
    const hay = `${r.id} ${r.labels.map((l) => l[0]).join(' ')}`.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.every((w) => hay.includes(w));
  });
}

const licenses = (C) => new Map(C.loadSources().sources.map((s) => [s.id, s.license || 'unspecified']));
function hitJson(h, lic) {
  const e = h.entry, t = e.tags;
  const o = { id: h.id, source: h.source, src: e.src ?? null, start: e.start ?? 0, dur: e.dur, score: +h.score.toFixed(4), role: t?.role ?? null, labels: t?.labels ?? [], license: lic.get(h.source) || 'unspecified' };
  if (e.synth) o.synth = e.synth;
  if (h.clap !== undefined) { o.clap = +h.clap.toFixed(4); o.kw = +h.kw.toFixed(3); o.weak = !!h.weak; }
  if (h.why !== undefined) o.why = h.why;
  return o;
}
function printHits(hits, o, lic, empty) {
  if (o.json) { console.log(JSON.stringify(hits.map((h) => hitJson(h, lic)), null, 2)); return; }
  if (!hits.length) console.log(empty);
  for (const h of hits) {
    const j = hitJson(h, lic);
    console.log(`${h.score.toFixed(3)}  ${h.id}  ${h.dur.toFixed(2)}s${j.role ? '  ' + j.role : ''}${j.labels.length ? '  ' + j.labels.map((l) => l[0]).join('/') : ''}${h.why ? '  · ' + h.why : ''}${h.weak ? '  (weak)' : ''}  [${j.license}]`);
  }
}

/** ref = index entry id, audio file, or <scene>:<cueId> (the cue's own entry). Role: the cue's stem when it is one. */
export async function resolveRef(I, ref, { capture = openCapture } = {}) {
  const e = I.findEntry(ref);
  if (e) return { query: e };
  if (fs.existsSync(ref) && fs.statSync(ref).isFile()) return { query: await I.entryForFile(ref) };
  const m = /^([^:]+):(.+)$/.exec(ref);
  if (m && fs.existsSync(path.join(sceneDir(m[1]), 'scene.json'))) {
    const cue = (await sceneCues(m[1], capture)).find((c) => c.id === m[2]);
    if (!cue) die(`no cue "${m[2]}" in ${m[1]} (ids: gfx audio ${m[1]} -> out/${m[1]}/audio/cues.json)`);
    const C = await import('../../library/config.js');
    const q = I.queryFromCue(cue, I.allEntries(), (src) => {
      // Compare a common library-relative/absolute key, including Windows paths viewed from WSL (and vice versa).
      let p = src.replace(/\\/g, '/');
      if (process.platform === 'linux') p = p.replace(/^([A-Za-z]):\//, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
      if (process.platform === 'win32') p = p.replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive}:/`);
      const key = C.relSrc(C.resolveSrc(p));
      return process.platform === 'win32' ? key.toLowerCase() : key;
    });
    if (!q) die(cue.sound === 'sample' ? `cue "${cue.id}": ${cue.src} is not in an indexed source` : `cue "${cue.id}": no synth entry for ${cue.sound}; run gfx lib index synth`);
    return { query: q, role: ['hits', 'motion', 'ui', 'accents'].includes(cue.stem) ? cue.stem : undefined };
  }
  die(`"${ref}" is not an index entry id, an audio file or <scene>:<cueId>`);
}
/** Read fresh: audio/cues.json has no dependency manifest, so timestamps cannot detect deleted scene inputs. */
export async function sceneCues(name, capture = openCapture) {
  const { page } = await capture(name);
  const fix = path.join(sceneDir(name), 'sound.json');
  return resolveCues(await page.evaluate(() => window.__gfx.cues), fs.existsSync(fix) ? readJson(fix) : {}).cues;
}

/** A fresh (per-user) library has only `synth`; register a fetched folder so `lib index` picks it up. */
function ensureSource(C, id, p, license) {
  const cfg = C.loadSources({ project: false });
  if (cfg.sources.some((s) => s.id === id)) return;
  cfg.sources.push({ id, kind: 'folder', path: p, license, enabled: true });
  C.saveSources(cfg);
  console.log(`registered source ${id} -> ${p}`);
}
