// gfx look list|use|update|save|new|seed|analyze|preview|check|audition (docs/LOOKS.md §2-3, docs/LOOK-PIPELINE.md).
// The Library path comes from the studio's setting (`--library`); Claude only ever reads the project copy `looks/<id>/`.
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ENGINE, PROJECT_FILE, projectRoot, findProject, projectConfig, samePath, readJson } from '../../paths.js';
import { STARTERS, validId, lookDir, lookHash, copyLook, listLooks, writeLookPreset, inside, lookFiles, lookMeta } from '../../looks.js';
import { SOUND_NAMES, VARIANTS } from '../../sfx.js';
import { resolveSrc } from '../../library/config.js';
import { die } from '../util.js';
import { writeManagedBlock } from './project.js';
import { rememberMachineWorkflow } from '../../workflow.js';
import { progress } from '../progress.js';
import { analyzeLook } from '../../look-analyze.js';
import { defaultLibraryDir } from '../../templates.js';
import { makePreview, phaseLine } from './template.js';

const NEW_TEMPLATE = path.join(STARTERS, '_new');

function project({ write = false } = {}) {
  const dest = projectRoot();
  if (!fs.existsSync(path.join(dest, PROJECT_FILE))) die(`${dest} is not a gfx project (no ${PROJECT_FILE})`);
  if (write && samePath(dest, ENGINE)) die('refusing to change looks in the engine repo (it is not a looks project)');
  return dest;
}
const writeConfig = (dest, cfg) => fs.writeFileSync(path.join(dest, PROJECT_FILE), JSON.stringify(cfg, null, 2) + '\n');
const libraryOf = (o, cfg, id) => {
  const lib = o.library || (id === cfg.look && cfg.lookSource && typeof cfg.lookSource.library === 'string' ? cfg.lookSource.library : null);
  return lib ? path.resolve(lib) : null;
};
const safe = (fn) => { try { return fn(); } catch (e) { return die(e.message); } };
const short = (h) => (h ? h.slice(0, 12) : '-');

/** Project side after a look change: preset look-<id>, managed block (with --workflow remembered first). */
function afterChange(dest, id, o) {
  if (o.workflow !== undefined) safe(() => rememberMachineWorkflow(dest, o.workflow));
  const preset = safe(() => writeLookPreset(dest, id));
  writeManagedBlock(dest);
  return preset;
}

function report(o, obj, lines) {
  if (o.json) console.log(JSON.stringify(obj));
  else for (const l of lines) console.log(l);
}

/** Status of the project's pinned look against the library: hashes, edited, updateAvailable, conflict. */
export function lookStatus(dest, cfg, library) {
  if (!validId(cfg.look)) return null;
  const dir = path.join(dest, 'looks', cfg.look);
  const src = cfg.lookSource && typeof cfg.lookSource === 'object' ? cfg.lookSource : null;
  const hash = lookHash(dir), recorded = src && typeof src.hash === 'string' ? src.hash : null;
  const lib = library || (src && typeof src.library === 'string' ? src.library : null);
  let libraryHash = null;
  if (lib) { try { libraryHash = lookHash(lookDir(path.resolve(lib), cfg.look)); } catch {} }
  const edited = !!recorded && hash !== recorded;
  const changed = !!libraryHash && !!recorded && libraryHash !== recorded;
  return {
    id: cfg.look, path: dir, exists: hash !== null, hash, lookSource: src, library: lib ? path.resolve(lib) : null, libraryHash,
    edited, updateAvailable: changed && !edited && libraryHash !== hash, conflict: changed && edited && libraryHash !== hash,
  };
}

function cmdList(o) {
  const dest = projectRoot();
  const isProject = fs.existsSync(path.join(dest, PROJECT_FILE));
  const cfg = isProject ? projectConfig(dest) : {};
  const lib = o.library ? path.resolve(o.library) : null;
  const projectLooks = isProject ? listLooks(dest) : [];
  const looks = lib ? listLooks(lib) : [];
  const status = isProject ? lookStatus(dest, cfg, lib) : null;
  if (o.json) return console.log(JSON.stringify({ project: isProject ? dest : null, look: status, projectLooks, library: lib, looks }));
  const row = (l, mark) => `${mark} ${l.id.padEnd(22)} ${String(l.name).padEnd(24)} ${l.preset ? 'preset' : '      '} ${String(l.sounds).padStart(3)} sounds  ${l.tags.join(', ')}${l.pending ? '  pending (LOOK.md missing)' : ''}`;
  if (isProject) {
    console.log(`project ${dest}`);
    if (!projectLooks.length) console.log('  (no looks)');
    for (const l of projectLooks) console.log('  ' + row(l, l.id === cfg.look ? '*' : ' '));
    if (status) console.log(`  look: ${status.id}${status.lookSource ? ` (pinned from ${status.lookSource.library})` : ' (project-only)'}${status.edited ? ', edited here' : ''}${status.updateAvailable ? ', library has a newer version (gfx look update)' : ''}${status.conflict ? ', library changed too (pick one: gfx look update shows both)' : ''}`);
  }
  if (lib) {
    console.log(`library ${lib}`);
    if (!looks.length) console.log('  (no looks; `gfx look seed --library <dir>` adds the starters)');
    for (const l of looks) console.log('  ' + row(l, ' '));
  }
}

function cmdUse(id, o) {
  const dest = project({ write: true });
  const cfg = projectConfig(dest);
  const projDir = safe(() => lookDir(dest, id));
  const requireLook = (dir) => {
    let ready = false;
    try { ready = fs.lstatSync(path.join(dir, 'LOOK.md')).isFile(); } catch {}
    if (ready) return true;
    const message = `look "${id}" is pending: LOOK.md is missing (${dir}); finish the look before using it`;
    report(o, { look: id, status: 'pending', pending: true, message }, [message]);
    process.exitCode = 2;
    return false;
  };
  let source = null;
  if (o.library) {
    const lib = path.resolve(o.library);
    const libDir = safe(() => lookDir(lib, id));
    if (!fs.existsSync(libDir) || !fs.statSync(libDir).isDirectory()) die(`look "${id}" not found in the library (${libDir})`);
    if (!requireLook(libDir)) return [];
    const libHash = lookHash(libDir), projHash = lookHash(projDir);
    const pinnedUnedited = cfg.look === id && cfg.lookSource && projHash === cfg.lookSource.hash;
    if (projHash && projHash !== libHash && !pinnedUnedited && !o.force) die(`looks/${id} already exists in this project and differs from the library copy; --force replaces it (or gfx look save ${id} --library <dir> keeps yours)`);
    if (projHash !== libHash) safe(() => copyLook(libDir, projDir, dest, { side: 'dest' }));
    source = { library: lib, hash: libHash };
  } else if (!requireLook(projDir)) return [];
  const next = { ...cfg, look: id };
  if (source) next.lookSource = source; else delete next.lookSource;
  writeConfig(dest, next);
  const preset = afterChange(dest, id, o);
  report(o, { look: id, lookSource: source, path: projDir, preset }, [
    `look "${id}" ${source ? `pinned from ${source.library} (copied to looks/${id}/)` : 'from this project'}${preset ? `; style preset look-${id}` : ''}; CLAUDE.md block refreshed`,
  ]);
  return [projDir];
}

function cmdUpdate(o) {
  const dest = project({ write: true });
  const cfg = projectConfig(dest);
  if (!validId(cfg.look)) die('this project has no look (gfx look use <id> --library <dir>)');
  const id = cfg.look;
  const lib = libraryOf(o, cfg, id);
  if (!lib) die('no library: pass --library <dir> (the project look has no lookSource)');
  const libDir = safe(() => lookDir(lib, id)), projDir = safe(() => lookDir(dest, id));
  if (!fs.existsSync(libDir)) die(`look "${id}" not found in the library (${libDir})`);
  const libHash = lookHash(libDir), projHash = lookHash(projDir);
  const recorded = cfg.lookSource && samePath(String(cfg.lookSource.library || ''), lib) ? cfg.lookSource.hash : null;
  const base = { look: id, library: lib, projectHash: projHash, libraryHash: libHash, recorded };
  if (libHash === projHash) {
    if (recorded !== libHash) writeConfig(dest, { ...cfg, lookSource: { library: lib, hash: libHash } });
    return report(o, { ...base, status: 'up-to-date' }, [`look "${id}" is up to date with ${lib}`]);
  }
  if (projHash === null || (recorded && projHash === recorded)) {
    safe(() => copyLook(libDir, projDir, dest, { side: 'dest' }));
    writeConfig(dest, { ...cfg, lookSource: { library: lib, hash: libHash } });
    const preset = afterChange(dest, id, o);
    report(o, { ...base, status: 'updated', preset }, [`look "${id}" updated from ${lib}${preset ? `; style preset look-${id} rewritten` : ''}; CLAUDE.md block refreshed`]);
    return [projDir];
  }
  if (recorded && libHash === recorded) {
    return report(o, { ...base, status: 'local-edits' }, [`look "${id}": the library has no newer version; this project's copy has edits (gfx look save keeps them in the library)`]);
  }
  // both sides differ from the pin (or there is no pin for this library): show both, change nothing
  report(o, { ...base, status: 'conflict' }, [
    `look "${id}": the project copy was edited and the library copy differs; nothing changed.`,
    `  project looks/${id}/       ${short(projHash)}`,
    `  library ${libDir}  ${short(libHash)}`,
    `  pinned                     ${short(recorded)}`,
    `  keep yours: gfx look save --library "${lib}" --force   take the library's: gfx look use ${id} --library "${lib}" --force`,
  ]);
  process.exitCode = 2;
}

function cmdSave(id, o) {
  const dest = project();
  const cfg = projectConfig(dest);
  id = id || cfg.look;
  if (!id) die('usage: gfx look save [<id>] --library <dir> (this project has no look)');
  const projDir = safe(() => lookDir(dest, id));
  if (!fs.existsSync(path.join(projDir, 'LOOK.md'))) die(`looks/${id}/LOOK.md not found in this project`);
  const lib = libraryOf(o, cfg, id);
  if (!lib) die('no library: pass --library <dir>');
  const libDir = safe(() => lookDir(lib, id));
  const projHash = lookHash(projDir), libHash = lookHash(libDir);
  const pinned = id === cfg.look && cfg.lookSource && samePath(String(cfg.lookSource.library || ''), lib) ? cfg.lookSource.hash : null;
  const base = { look: id, library: lib, path: libDir, projectHash: projHash, libraryHash: libHash, recorded: pinned };
  if (libHash !== projHash) {
    if (libHash !== null && libHash !== pinned && !o.force) {
      report(o, { ...base, status: 'conflict' }, [
        `look "${id}": the library has a different version (${short(libHash)}) than this project pinned (${short(pinned)}); nothing saved.`,
        `  --force overwrites it with the project copy (${short(projHash)}); gfx look update shows both`,
      ]);
      process.exitCode = 2;
      return;
    }
    safe(() => copyLook(projDir, libDir, lib, { side: 'dest-or-src' }));
  }
  if (id === cfg.look) writeConfig(dest, { ...cfg, lookSource: { library: lib, hash: projHash } });
  report(o, { ...base, status: libHash === projHash ? 'unchanged' : 'saved' }, [libHash === projHash ? `look "${id}" already matches ${libDir}` : `saved looks/${id}/ to ${libDir}`]);
  return [libDir];
}

function cmdNew(id, o) {
  const dest = project({ write: true });
  const dir = safe(() => lookDir(dest, id));
  if (fs.existsSync(dir)) die(`looks/${id} already exists`);
  const name = o.name || id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const fill = (s) => s.replaceAll('{{id}}', id).replaceAll('{{name}}', name.replace(/[\r\n]+/g, ' '));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['LOOK.md', 'preset.js', 'sounds.json']) fs.writeFileSync(path.join(dir, f), fill(fs.readFileSync(path.join(NEW_TEMPLATE, f), 'utf8')));
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  report(o, { look: id, path: dir }, [`created looks/${id}/ (LOOK.md, preset.js, sounds.json, refs/); use it: gfx look use ${id}; share it: gfx look save ${id} --library <dir>`]);
  return [dir];
}

function cmdSeed(o) {
  if (!o.library) die('usage: gfx look seed --library <dir>');
  const lib = path.resolve(o.library);
  const seeded = [], skipped = [];
  const starters = fs.existsSync(STARTERS) ? fs.readdirSync(STARTERS).filter((n) => !n.startsWith('_') && validId(n) && fs.statSync(path.join(STARTERS, n)).isDirectory()).sort() : [];
  for (const d of ['looks', 'presets', 'palettes']) fs.mkdirSync(path.join(lib, d), { recursive: true });
  for (const id of starters) {
    const to = safe(() => lookDir(lib, id));
    if (fs.existsSync(to)) { skipped.push(id); continue; }
    if (!inside(lib, to)) die(`refusing to write outside ${lib}`);
    copyLook(path.join(STARTERS, id), to, lib);
    seeded.push(id);
  }
  report(o, { library: lib, seeded, skipped }, [`library ${lib}: seeded ${seeded.join(', ') || '-'}${skipped.length ? `; kept existing ${skipped.join(', ')}` : ''}`]);
  return seeded.map((id) => path.join(lib, 'looks', id));
}

/** gfx look analyze [--refs <file>]... [<file>...] [--from-project] [--out <file>] [--json] (docs/LOOK-PIPELINE.md §1). */
async function cmdAnalyze(o, positionals) {
  const refs = [...(o.refs || []), ...positionals.slice(1)];
  if (!refs.length && !o['from-project']) die('usage: gfx look analyze [--refs <file>...] [--from-project] [--out <file>] [--json]');
  let root = null;
  if (o['from-project']) {
    // no engine fallback here: outside a project, --from-project would silently measure the engine repo
    root = process.env.GFX_PROJECT ? projectRoot() : findProject();
    if (!root || !fs.existsSync(path.join(root, PROJECT_FILE))) die(`${root || process.cwd()} is not a gfx project (no ${PROJECT_FILE}); --from-project needs one (or --project <dir>)`);
  }
  let res;
  try {
    res = await analyzeLook({ refs, project: root, onProgress: (ph, i, n, label) => progress(ph, i, n, label ? { file: label } : undefined) });
  } catch (e) { return die(e.message); }
  res = { version: res.version, created: new Date().toISOString(), ...res };
  const text = JSON.stringify(res, null, 2) + '\n';
  if (o.out) {
    const out = path.resolve(o.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    if (o.json) console.log(JSON.stringify(res));
    else {
      const s = res.summary;
      console.log(`analysis of ${res.refs.length} reference(s)${res.project ? ' + this project' : ''} -> ${out}`);
      console.log(`  summary from ${s.source}${s.colourFrom === 'presets' ? ' (colours from the presets)' : ''}`);
      if (s.palette.length) console.log(`  palette ${s.palette.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join('  ')}`);
      if (s.light !== null) console.log(`  light ${s.light}  contrast ${s.contrast}  ink contrast ${s.inkContrast ?? "-"}  saturation ${s.saturation}  ${s.temperature}`);
      if (s.pacing) console.log(`  pacing: median shot ${s.pacing.shotLen?.median ?? '-'} s, ${s.pacing.cutsPerSec} cuts/s, motion ${s.pacing.motion} (${s.pacing.motionLabel})`);
      if (s.sound) console.log(`  sound: ${s.sound.onsetsPerSec} onsets/s, bands low ${s.sound.bands.low} mid ${s.sound.bands.mid} high ${s.sound.bands.high}${s.sound.lufs !== null ? `, ${s.sound.lufs} LUFS` : ''}`);
      for (const k of res.skipped) console.log(`  skipped ${k.file}: ${k.reason}`);
    }
    return [out];
  }
  process.stdout.write(o.json ? JSON.stringify(res) + '\n' : text);
  return [];
}

/** Run this engine's CLI in `cwd` / on `project`; resolves with { code, out, err }. */
function gfxRun(args, project) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (project) env.GFX_PROJECT = project; else delete env.GFX_PROJECT;
    const ch = spawn(process.execPath, [path.join(ENGINE, 'runner', 'cli.js'), ...args], { env, cwd: project || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out = (out + d).slice(-20000); });
    ch.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    ch.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    ch.on('close', (code) => resolve({ code, out, err }));
  });
}
const lastLine = (s) => s.trim().split('\n').pop() || '';

// lstat never follows a preview destination. Refuse special entries, including dangling symlinks.
function checkPreviewTarget(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!st.isFile()) throw new Error(`refusing to publish preview: ${file} is not a regular file (symlinks are not allowed)`);
}
function publishPreview(src, dest) {
  const temp = path.join(path.dirname(dest), `.gfx-preview-${randomUUID()}.tmp`);
  try {
    fs.copyFileSync(src, temp, fs.constants.COPYFILE_EXCL);
    checkPreviewTarget(dest);
    fs.renameSync(temp, dest);
  } finally { fs.rmSync(temp, { force: true }); }
}

/** Make a temp project (blank template) with look `id` from `lib` pinned and its sample/ copied to scenes/sample. */
async function sampleProject(id, lib, dir, tmp) {
  const proj = path.join(tmp, 'project');
  phaseLine(`look ${id}: temp project with the sample...`);
  let r = await gfxRun(['init', proj, '--template', 'blank', '--name', `look ${id} preview`], null);
  if (r.code !== 0) die(`could not make the temp project: ${lastLine(r.err) || `exit ${r.code}`}`);
  r = await gfxRun(['look', 'use', id, '--library', lib], proj);
  if (r.code !== 0) die(`gfx look use ${id} failed in the temp project: ${lastLine(r.err) || `exit ${r.code}`}`);
  const sample = path.join(dir, 'sample');
  for (const f of lookFiles(sample)) {
    const to = path.join(proj, 'scenes', 'sample', ...f.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(sample, ...f.split('/')), to);
  }
  return proj;
}

/** The Library look folder with a runnable sample; -> { lib, dir, sj }. */
function librarySample(id, o) {
  const lib = path.resolve(o.library || defaultLibraryDir());
  const dir = safe(() => lookDir(lib, id));
  if (!fs.existsSync(path.join(dir, 'LOOK.md'))) die(`look "${id}" not found in the library (${dir})`);
  const sample = path.join(dir, 'sample');
  if (!fs.existsSync(path.join(sample, 'scene.json'))) die(`look "${id}" has no sample scene (${path.join(sample, 'scene.json')} is missing): build sample/ from templates/looks/_sample/BRIEF.md first`);
  const sj = readJson(path.join(sample, 'scene.json'), null);
  if (!sj) die(`${path.join(sample, 'scene.json')} is not valid JSON`);
  return { lib, dir, sj };
}

/** Where a look side product goes: `--out`, else `<project>/out/<sub>/<file>` in the current project, else a kept temp dir. */
function sideOut(o, sub, file) {
  if (o.out) return path.resolve(o.out);
  const root = process.env.GFX_PROJECT ? projectRoot() : findProject();
  if (root && fs.existsSync(path.join(root, PROJECT_FILE))) return path.join(root, 'out', sub, file);
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `gfx-${sub}-`)), file);
}

/** gfx look preview <id> [--library <dir>] [--t <sec>] [--still-only] (docs/LOOK-PIPELINE.md §2). */
async function cmdPreview(id, o) {
  if (o.sheet) return cmdSheet(id, o);
  const { lib, dir, sj } = librarySample(id, o);
  const dur = Number(sj.duration) || 4;
  const t = o.t !== undefined ? Number(o.t) : +(dur * 0.7).toFixed(2);
  if (!Number.isFinite(t) || t < 0) die(`--t must be a number of seconds (got ${o.t})`);

  for (const f of ['thumb.jpg', 'thumb.png', ...(!o['still-only'] ? ['preview.mp4'] : [])]) safe(() => checkPreviewTarget(path.join(dir, f)));
  progress('copy', 0, 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gfx-look-preview-${id}-`));
  const work = path.join(tmp, 'media');
  try {
    const proj = await sampleProject(id, lib, dir, tmp);
    fs.mkdirSync(work, { recursive: true });
    progress('copy', 1, 1);
    const { t: at, warn } = await makePreview(proj, 'sample', work, { t, clip: !o['still-only'] });
    const thumb = ['thumb.jpg', 'thumb.png'].find((f) => fs.existsSync(path.join(work, f)));
    if (!thumb) die(`no thumbnail: ${warn.join('; ') || 'gfx still failed'}`);
    const written = [];
    for (const f of ['thumb.jpg', 'thumb.png']) if (f !== thumb) fs.rmSync(path.join(dir, f), { force: true });
    publishPreview(path.join(work, thumb), path.join(dir, thumb));
    written.push(path.join(dir, thumb));
    if (!o['still-only'] && fs.existsSync(path.join(work, 'preview.mp4'))) {
      publishPreview(path.join(work, 'preview.mp4'), path.join(dir, 'preview.mp4'));
      written.push(path.join(dir, 'preview.mp4'));
    }
    const res = { look: id, library: lib, t: at, thumb: path.join(dir, thumb), preview: written.length > 1 ? path.join(dir, 'preview.mp4') : null, warnings: warn };
    report(o, res, [`look "${id}": ${written.map((f) => path.basename(f)).join(' + ')} at t=${at}s -> ${dir}`, ...warn.map((w) => `  warning: ${w}`)]);
    if (warn.length && !o['still-only']) process.exitCode = 1;
    return written;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** gfx look preview <id> --sheet [--n 12] [--cols 4] [--t a,b,...] [--out <png>]: a contact sheet of the sample (frames
 * at full size, tiles as `gfx sheet`), plus full-size stills at the `--t` times next to it. Nothing in the look changes. */
async function cmdSheet(id, o) {
  const { lib, dir, sj } = librarySample(id, o);
  const dur = Number(sj.duration) || 4;
  const times = o.t !== undefined ? String(o.t).split(',').map((x) => Number(x.trim())) : [];
  if (times.some((x) => !Number.isFinite(x) || x < 0 || x > dur)) die(`--t must be seconds within 0..${dur}, comma-separated (got ${o.t})`);
  const n = o.n !== undefined ? Number(o.n) : 12, cols = o.cols !== undefined ? Number(o.cols) : 4;
  if (!Number.isInteger(n) || n < 1 || n > 60 || !Number.isInteger(cols) || cols < 1) die('--n must be 1..60 and --cols >= 1');
  const out = sideOut(o, 'look-sheets', `${id}.png`);
  if (!/\.png$/i.test(out)) die(`--out must be a .png file (got ${out})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gfx-look-sheet-${id}-`));
  try {
    progress('copy', 0, 1);
    const proj = await sampleProject(id, lib, dir, tmp);
    progress('copy', 1, 1);
    progress('sheet', 0, 1 + times.length);
    phaseLine(`look ${id}: contact sheet, ${n} frames...`);
    const t0 = Date.now();
    const sheet = path.join(tmp, 'sheet.png');
    const r = await gfxRun(['sheet', 'sample', '--n', String(n), '--cols', String(cols), '--out', sheet, '--mode', 'fast'], proj);
    if (r.code !== 0 || !fs.existsSync(sheet)) die(`gfx sheet failed: ${lastLine(r.err) || `exit ${r.code}`}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(sheet, out);
    const written = [out];
    for (let i = 0; i < times.length; i++) {
      progress('sheet', 1 + i, 1 + times.length);
      phaseLine(`look ${id}: full-size still at t=${times[i]}s...`);
      const still = out.replace(/\.png$/i, `-t${times[i]}.png`);
      const s = await gfxRun(['still', 'sample', '--t', String(times[i]), '--out', still, '--mode', 'fast'], proj);
      if (s.code !== 0 || !fs.existsSync(still)) die(`gfx still --t ${times[i]} failed: ${lastLine(s.err) || `exit ${s.code}`}`);
      written.push(still);
    }
    progress('sheet', 1 + times.length, 1 + times.length);
    report(o, { look: id, library: lib, sheet: out, stills: written.slice(1), n }, [
      `look "${id}": contact sheet (${n} frames) -> ${out}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`, ...written.slice(1).map((f) => `  still ${f}`),
    ]);
    return written;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- gfx look check ----------
const LOOK_MAX_BYTES = 2 * 1024 * 1024;
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const firstFamily = (stack) => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
const isNum0 = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Look folder for check / audition: --library <dir>, else the project's looks/<id>/, else the default Library. */
function anyLookDir(id, o) {
  if (!o.library) {
    const root = process.env.GFX_PROJECT ? projectRoot() : findProject();
    if (root && fs.existsSync(path.join(root, PROJECT_FILE))) {
      const d = safe(() => lookDir(root, id));
      if (fs.existsSync(d)) return { dir: d, where: 'project' };
    }
  }
  const lib = path.resolve(o.library || defaultLibraryDir());
  const d = safe(() => lookDir(lib, id));
  if (!fs.existsSync(d)) die(`look "${id}" not found (${d})`);
  return { dir: d, where: 'library' };
}

/** Is a palette `src` installed here (a regular file in the sound library / project)? */
export function srcInstalled(src) {
  try { return fs.statSync(resolveSrc(src)).isFile(); } catch { return false; }
}

/** Validate a look folder (docs/LOOK-PIPELINE.md "As built"): -> { errors, warnings, bytes }. */
export async function checkLook(dir, id) {
  const errors = [], warnings = [];
  const isFile = (f) => { try { return fs.lstatSync(path.join(dir, f)).isFile(); } catch { return false; } };
  // LOOK.md frontmatter
  if (!isFile('LOOK.md')) errors.push('LOOK.md is missing (the look is pending)');
  else {
    const m = lookMeta(dir);
    for (const k of ['name', 'description']) if (!m[k]) errors.push(`LOOK.md frontmatter has no ${k}`);
    if (!m.tags.length) errors.push('LOOK.md frontmatter has no tags');
  }
  // preset.js
  if (!isFile('preset.js')) warnings.push('no preset.js (scenes fall back to the project default preset)');
  else {
    let p = null;
    try { p = (await import(pathToFileURL(path.join(dir, 'preset.js')).href + `?check=${Date.now()}`)).default; } catch (e) { errors.push(`preset.js does not load: ${e.message}`); }
    if (p) {
      if (!p.colors || typeof p.colors !== 'object') errors.push('preset.js has no colors');
      else for (const k of ['bg', 'text', 'accent']) if (typeof p.colors[k] !== 'string' || !p.colors[k]) errors.push(`preset colors.${k} is missing`);
      const files = Array.isArray(p.fontFiles) ? p.fontFiles : [];
      const loaded = new Set();
      for (const f of files) {
        const url = String(f?.url || '');
        const m = /^\/style\/fonts\/([^/]+\.(?:woff2|woff|ttf|otf))$/.exec(url);
        if (!m) { errors.push(`fontFiles: ${url || '(no url)'} is not a bundled font (/style/fonts/<file>)`); continue; }
        if (!fs.existsSync(path.join(ENGINE, 'style', 'fonts', m[1]))) { errors.push(`fontFiles: ${m[1]} is not in the engine's style/fonts`); continue; }
        if (f.family) loaded.add(String(f.family));
      }
      if (!p.fonts || typeof p.fonts !== 'object') errors.push('preset.js has no fonts');
      else {
        for (const k of ['sans', 'mono']) if (typeof p.fonts[k] !== 'string') errors.push(`preset fonts.${k} is missing`);
        for (const [k, v] of Object.entries(p.fonts)) {
          if (typeof v !== 'string') { errors.push(`preset fonts.${k} is not a font stack string`); continue; }
          const fam = firstFamily(v);
          if (!GENERIC_FONTS.has(fam) && !loaded.has(fam)) errors.push(`preset fonts.${k}: "${fam}" is not loaded by fontFiles (only bundled fonts: style/fonts)`);
        }
      }
    }
  }
  // sounds.json
  if (!isFile('sounds.json')) warnings.push('no sounds.json (no sound palette)');
  else {
    const pal = readJson(path.join(dir, 'sounds.json'), undefined);
    if (!Array.isArray(pal)) errors.push('sounds.json is not a JSON array');
    else {
      const roles = new Map();
      const synth = (where, sound, variant) => {
        if (!SOUND_NAMES.includes(sound)) { errors.push(`${where}: unknown synth sound "${sound}" (one of ${SOUND_NAMES.join(', ')})`); return; }
        if (variant !== undefined && !(VARIANTS[sound] || []).includes(variant)) errors.push(`${where}: variant "${variant}" is not valid for ${sound}${VARIANTS[sound] ? ` (one of ${VARIANTS[sound].join(', ')})` : ' (it has none)'}`);
      };
      pal.forEach((e, i) => {
        const where = `sounds.json[${i}]${e && e.role ? ` (${e.role})` : ''}`;
        if (!e || typeof e !== 'object') { errors.push(`${where}: not an object`); return; }
        if (typeof e.role !== 'string' || !e.role) errors.push(`${where}: no role`);
        else roles.set(e.role, (roles.get(e.role) || 0) + 1);
        if (e.params !== undefined && (typeof e.params !== 'object' || Array.isArray(e.params) || e.params === null)) errors.push(`${where}: params must be an object of cue options`);
        if (e.sound === 'sample') {
          if (typeof e.src !== 'string' || !e.src) errors.push(`${where}: a sample entry needs src (the sound-library path from gfx lib search --json)`);
          else if (path.isAbsolute(e.src) || /^[a-z]:/i.test(e.src) || e.src.split(/[\\/]/).includes('..')) errors.push(`${where}: src "${e.src}" must be a library-relative path (library/<source>/<file>), not absolute or with ..`);
          else {
            if (!e.src.startsWith('library/')) warnings.push(`${where}: src "${e.src}" is not a sound-library path (library/<source>/<file>)`);
            if (!srcInstalled(e.src)) warnings.push(`${where}: ${e.src} is not installed on this machine (cues use the alt)`);
          }
          for (const k of ['start', 'dur']) if (e[k] !== undefined && !isNum0(e[k])) errors.push(`${where}: ${k} must be seconds >= 0`);
          for (const k of ['start', 'dur']) if (e.params && e.params[k] !== undefined && e[k] === undefined) warnings.push(`${where}: params.${k} on a sample: put the slice in top-level "${k}"`);
          if (!e.alt || typeof e.alt !== 'object') errors.push(`${where}: a sample entry needs an alt (synth fallback { sound, variant?, params? })`);
          else synth(`${where} alt`, e.alt.sound, e.alt.variant);
        } else if (typeof e.sound !== 'string') errors.push(`${where}: no sound`);
        else synth(where, e.sound, e.variant);
      });
      for (const [r, c] of roles) if (c > 1) warnings.push(`sounds.json: role "${r}" appears ${c} times (the first wins)`);
    }
  }
  // sample/
  if (!fs.existsSync(path.join(dir, 'sample'))) warnings.push('no sample/ (no preview for the Library card)');
  else {
    const sj = readJson(path.join(dir, 'sample', 'scene.json'), null);
    if (!sj || typeof sj !== 'object') errors.push('sample/scene.json is missing or not valid JSON');
    else {
      for (const k of ['width', 'height', 'fps', 'duration']) if (!(Number(sj[k]) > 0)) errors.push(`sample/scene.json: ${k} must be a positive number`);
      if (typeof sj.kind !== 'string') errors.push('sample/scene.json: no kind');
      if (sj.style !== `look-${id}`) warnings.push(`sample/scene.json: style is ${JSON.stringify(sj.style)}, expected "look-${id}"`);
    }
    if (!isFile('sample/scene.js')) errors.push('sample/scene.js is missing');
    else if (/\bcue\s*\(/.test(fs.readFileSync(path.join(dir, 'sample', 'scene.js'), 'utf8'))) warnings.push('sample/scene.js calls cue(): the sample is silent by design');
    if (isFile('sample/sound.json')) warnings.push('sample/sound.json: the sample is silent by design');
    if (!isFile('thumb.jpg') && !isFile('thumb.png')) warnings.push('no thumb.jpg yet (gfx look preview)');
  }
  // size
  let bytes = 0;
  for (const f of lookFiles(dir)) bytes += fs.statSync(path.join(dir, ...f.split('/'))).size;
  if (bytes > LOOK_MAX_BYTES) errors.push(`the look folder is ${(bytes / 1048576).toFixed(2)} MB (budget 2 MB)`);
  return { errors, warnings, bytes };
}

/** gfx look check <id> [--library <dir>] [--json]: exit 1 on errors. */
async function cmdCheck(id, o) {
  const { dir, where } = anyLookDir(id, o);
  const r = await checkLook(dir, id);
  const ok = !r.errors.length;
  report(o, { look: id, path: dir, where, ok, ...r }, [
    `look "${id}" (${where}: ${dir}): ${ok ? 'ok' : 'problems'}: ${r.errors.length} error(s), ${r.warnings.length} warning(s), ${Math.round(r.bytes / 1024)} KB`,
    ...r.errors.map((e) => `  error: ${e}`), ...r.warnings.map((w) => `  warning: ${w}`),
  ]);
  if (!ok) process.exitCode = 1;
  return [];
}

// ---------- gfx look audition ----------
const SLOT = 1.4;
/** Cue options of a palette entry: params + variant (+ src / start / dur for samples). */
const cueOpts = (e, id) => ({ ...(e.params || {}), ...(e.variant ? { variant: e.variant } : {}), ...(e.sound === 'sample' ? { src: e.src, ...(e.start !== undefined ? { start: e.start } : {}), ...(e.dur !== undefined ? { dur: e.dur } : {}) } : {}), id });
const altOpts = (a, id) => ({ ...(a.params || {}), ...(a.variant ? { variant: a.variant } : {}), id });

/** The audition plan: per palette entry a slot with the main cue (the alt when src is not installed) and the alt. */
export function auditionPlan(pal, sampleDir) {
  const cues = [], rows = [];
  pal.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const t0 = +(i * SLOT).toFixed(3), role = String(e.role || `entry ${i + 1}`), tag = `${i + 1}-${role.replace(/[^\w-]+/g, '-')}`;
    const isSample = e.sound === 'sample';
    let source = null, staged = null;
    if (isSample && typeof e.src === 'string') {
      try {
        // Resolve while still in the caller's project, before the render changes context.
        const file = fs.realpathSync(resolveSrc(e.src));
        if (fs.statSync(file).isFile()) {
          staged = file;
          if (sampleDir) {
            fs.mkdirSync(sampleDir, { recursive: true });
            staged = path.join(sampleDir, `${i + 1}${path.extname(file)}`);
            fs.copyFileSync(file, staged);
          }
          source = file;
        }
      } catch { /* Missing or unstageable samples use their alt. */ }
    }
    const have = source !== null;
    const alt = e.alt && typeof e.alt === 'object' && typeof e.alt.sound === 'string' ? e.alt : null;
    const describe = (s, v) => `${s}${v ? ' ' + v : ''}`;
    const row = { role, t0, main: null, alt: null, note: null };
    if (!isSample) { cues.push({ t: t0 + 0.1, sound: e.sound, opts: cueOpts(e, tag) }); row.main = describe(e.sound, e.variant); }
    else if (have) { cues.push({ t: t0 + 0.1, sound: 'sample', opts: { ...cueOpts(e, tag), src: staged } }); row.main = `sample ${e.src.split('/').slice(-1)[0]}`; row.source = source; }
    else if (alt) { cues.push({ t: t0 + 0.1, sound: alt.sound, opts: altOpts(alt, tag) }); row.main = `(${e.src || 'no src'} not installed) -> ${describe(alt.sound, alt.variant)}`; row.note = 'missing'; }
    else row.note = 'missing, no alt';
    if (isSample && have && alt) { cues.push({ t: t0 + 0.75, sound: alt.sound, opts: altOpts(alt, `${tag}-alt`) }); row.alt = describe(alt.sound, alt.variant); }
    rows.push(row);
  });
  return { cues, rows, duration: +(Math.max(1, rows.length) * SLOT + 0.6).toFixed(2) };
}

function auditionScene(id, plan) {
  return `// Generated by gfx look audition ${id}: one slot per sound-palette role (main cue, then its alt).
const ROWS = ${JSON.stringify(plan.rows)};
const CUES = ${JSON.stringify(plan.cues)};
const SLOT = ${SLOT};
let els = [];
export default {
  setup(ctx) {
    const { root } = ctx;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:48px 64px;display:flex;flex-direction:column;gap:6px;font:22px var(--gfx-font-mono);color:var(--gfx-text)';
    const head = document.createElement('div');
    head.textContent = ${JSON.stringify(`look ${id}: sound palette audition`)};
    head.style.cssText = 'font-size:28px;margin-bottom:12px';
    box.appendChild(head);
    els = ROWS.map((r, i) => {
      const d = document.createElement('div');
      d.setAttribute('data-gfx', 'row-' + (i + 1));
      d.style.cssText = 'padding:6px 12px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      d.textContent = (i * SLOT).toFixed(1) + 's  ' + r.role + ': ' + (r.main || '(nothing)') + (r.alt ? '   | alt ' + r.alt : '') + (r.note ? '   [' + r.note + ']' : '');
      box.appendChild(d);
      return d;
    });
    root.appendChild(box);
    for (const c of CUES) ctx.cue(c.t, c.sound, c.opts);
  },
  render(t) {
    const k = Math.floor(t / SLOT);
    els.forEach((d, i) => { d.style.background = i === k ? 'var(--gfx-accent)' : 'transparent'; d.style.color = i === k ? 'var(--gfx-bg)' : 'var(--gfx-text)'; });
  },
};
`;
}

/** gfx look audition <id> [--library <dir>] [--out <wav>]: every palette role in sequence -> wav + sync.png. */
async function cmdAudition(id, o) {
  const { dir, where } = anyLookDir(id, o);
  const pal = readJson(path.join(dir, 'sounds.json'), undefined);
  if (!Array.isArray(pal) || !pal.length) die(`look "${id}" has no sound palette (${path.join(dir, 'sounds.json')})`);
  const out = sideOut(o, 'look-audition', `${id}.wav`);
  if (!/\.wav$/i.test(out)) die(`--out must be a .wav file (got ${out})`);
  const sync = out.replace(/\.wav$/i, '.sync.png');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gfx-look-audition-${id}-`));
  try {
    progress('copy', 0, 1);
    const proj = path.join(tmp, 'project');
    let r = await gfxRun(['init', proj, '--template', 'blank', '--name', `look ${id} audition`], null);
    if (r.code !== 0) die(`could not make the temp project: ${lastLine(r.err) || `exit ${r.code}`}`);
    const sampleDir = path.join(proj, 'library', 'audition');
    const cfg = projectConfig(proj);
    cfg.library = { ...cfg.library, sources: [{ id: `gfx-look-audition-${randomUUID()}`, kind: 'folder', path: 'library/audition' }] };
    writeConfig(proj, cfg);
    const plan = auditionPlan(pal, sampleDir);
    if (!plan.cues.length) die(`look "${id}": no playable palette entry`);
    phaseLine(`look ${id}: audition of ${plan.rows.length} roles (${plan.cues.length} cues, ${plan.duration} s)...`);
    const sd = path.join(proj, 'scenes', 'audition');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'scene.json'), JSON.stringify({ kind: 'anime', width: 1280, height: 720, fps: 30, duration: plan.duration, title: `${id} audition` }, null, 2) + '\n');
    fs.writeFileSync(path.join(sd, 'scene.js'), auditionScene(id, plan));
    progress('copy', 1, 1);
    progress('audio', 0, 1);
    r = await gfxRun(['audio', 'audition'], proj);
    const ad = path.join(proj, 'out', 'audition', 'audio');
    if (r.code !== 0 || !fs.existsSync(path.join(ad, 'mix.wav'))) die(`gfx audio failed: ${lastLine(r.err) || `exit ${r.code}`}`);
    progress('audio', 1, 1);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(ad, 'mix.wav'), out);
    const written = [out];
    if (fs.existsSync(path.join(ad, 'sync.png'))) { fs.copyFileSync(path.join(ad, 'sync.png'), sync); written.push(sync); }
    const warns = (r.err.match(/^.*warning.*$/gim) || []).map((l) => l.replace(/^gfx:\s*warning:\s*/i, ''));
    const missing = plan.rows.filter((x) => x.note);
    report(o, { look: id, path: dir, where, wav: out, sync: written[1] || null, roles: plan.rows, warnings: warns }, [
      `look "${id}": ${plan.rows.length} roles, ${plan.cues.length} cues -> ${out}`, ...(written[1] ? [`  sync ${written[1]}`] : []),
      ...plan.rows.map((x) => `  ${x.t0.toFixed(1).padStart(5)}s ${x.role.padEnd(12)} ${x.main || '(nothing)'}${x.alt ? `  | alt ${x.alt}` : ''}`),
      ...missing.map((x) => `  note: ${x.role}: ${x.note}`), ...warns.map((w) => `  warning: ${w}`),
    ]);
    if (missing.some((x) => x.note === 'missing, no alt')) process.exitCode = 1;
    return written;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- help ----------
export const LOOK_HELP = {
  list: 'gfx look list [--library <dir>] [--json]\n  The project\'s looks and the Library\'s (id, name, preset, sounds, tags; pending = no LOOK.md yet).',
  use: 'gfx look use <id> [--library <dir>] [--force] [--workflow quick|full|<json>] [--json]\n  Pin a Library look into the project (copy to looks/<id>/, gfx.json look + lookSource, preset look-<id>, CLAUDE.md block).\n  Without --library: use the project\'s own looks/<id>/. A pending look (no LOOK.md) is refused (exit 2).',
  update: 'gfx look update [--library <dir>] [--json]\n  Take the Library\'s newer copy (only when the project copy is unedited; conflict = exit 2, nothing changed).',
  save: 'gfx look save [<id>] [--library <dir>] [--force] [--json]\n  Project look -> Library (--force overwrites a Library copy that differs from the pin).',
  new: 'gfx look new <id> [--name "Name"] [--json]\n  Scaffold looks/<id>/ (LOOK.md, preset.js, sounds.json, refs/) in the project.',
  seed: 'gfx look seed --library <dir> [--json]\n  Copy the starter looks into the Library (existing looks are kept).',
  analyze: 'gfx look analyze [--refs <file>]... [<file>...] [--from-project] [--out <file>] [--json]\n  Measure reference images / videos (palette, light, contrast, inkContrast, saturation, temperature, cuts, shot\n  length, motion, sound) and/or this project\'s scenes -> analysis.json (stdout without --out).',
  preview: 'gfx look preview <id> [--library <dir>] [--t <sec>] [--still-only] [--json]\n  Render the look\'s sample/ -> thumb.jpg (at --t, default 70 %) + preview.mp4 (480 px, 24 fps, <= 6 s) in the look folder.\ngfx look preview <id> --sheet [--n 12] [--cols 4] [--t a,b,...] [--out <png>] [--library <dir>] [--json]\n  A contact sheet of the sample (default out/look-sheets/<id>.png in the current project, else a temp folder, printed),\n  plus full-size stills at the --t times next to it (<sheet>-t<sec>.png). The look folder is not changed.',
  check: 'gfx look check <id> [--library <dir>] [--json]\n  Validate a look: LOOK.md frontmatter (name, description, tags), preset colors bg / text / accent, fonts only from\n  bundled files, synth sound names + variants, every sample src has an alt, sample/scene.json, folder <= 2 MB.\n  Without --library: the project\'s looks/<id>/ when it exists, else the default Library. Exit 1 on errors.',
  audition: 'gfx look audition <id> [--library <dir>] [--out <wav>] [--json]\n  Play the sound palette: one 1.4 s slot per role (the entry, then its alt) -> <id>.wav + <id>.sync.png (default\n  out/look-audition/ in the current project, else a temp folder). A src that is not installed plays its alt.',
};
const lookUsage = () => `gfx look <command>   (gfx look <command> --help)\n\n${Object.values(LOOK_HELP).join('\n\n')}`;

/** gfx look <sub> ... */
export async function cmdLook(sub, o, positionals = []) {
  const id = positionals[1];
  if (o.help || sub === 'help') { console.log(LOOK_HELP[sub === 'help' ? id : sub] || lookUsage()); return []; }
  switch (sub) {
    case 'list': return cmdList(o);
    case 'use': if (!id) die('usage: gfx look use <id> [--library <dir>] [--force]'); return cmdUse(id, o);
    case 'update': return cmdUpdate(o);
    case 'save': return cmdSave(id, o);
    case 'new': if (!id) die('usage: gfx look new <id>'); return cmdNew(id, o);
    case 'seed': return cmdSeed(o);
    case 'analyze': return cmdAnalyze(o, positionals);
    case 'preview': if (!id) die('usage: gfx look preview <id> [--library <dir>] [--t <sec>] [--still-only] | --sheet [--n 12] [--t a,b] [--out <png>]'); return cmdPreview(id, o);
    case 'check': if (!id) die('usage: gfx look check <id> [--library <dir>] [--json]'); return cmdCheck(id, o);
    case 'audition': if (!id) die('usage: gfx look audition <id> [--library <dir>] [--out <wav>] [--json]'); return cmdAudition(id, o);
    default: die('usage: gfx look list|use|update|save|new|seed|analyze|preview|check|audition (gfx look --help)');
  }
}
