// Looks (docs/LOOKS.md §2-3): a folder `looks/<id>/` (LOOK.md, preset.js?, sounds.json?, refs/) kept in a machine
// Library and pinned into a project by copy. Every path is checked to stay inside its root; ids are slugs; symlinks are
// never followed when copying or hashing (only regular files count).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE, readJson } from './paths.js';

export const STARTERS = path.join(ENGINE, 'templates', 'looks');
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const validId = (id) => typeof id === 'string' && SLUG.test(id);
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
// Library-side files (docs/LOOK-PIPELINE.md §2): the sample scene and its preview, the measurements and the studio's
// BRIEF.md. They are not
// part of the content hash, `look use` / `update` never copy them into a project, and `look save` keeps the Library's.
export const LIBRARY_SIDE = ['sample', 'thumb.jpg', 'thumb.png', 'preview.mp4', 'analysis.json', 'BRIEF.md'];
/** True for a look-relative path ('/'-separated) that is Library-side: `sample/**` or one of the top-level files. */
export const isLibrarySide = (rel) => LIBRARY_SIDE.includes(rel.split('/')[0]) && (rel.split('/')[0] === 'sample' ? rel.includes('/') : !rel.includes('/'));

/** True when `p` is `root` itself or below it, lexically and (for the parts that exist) after resolving symlinks. */
export function inside(root, p) {
  const lex = (a, b) => { const r = path.relative(a, b); return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r)); };
  if (!lex(path.resolve(root), path.resolve(p))) return false;
  let rr; try { rr = fs.realpathSync(root); } catch { return true; } // root not created yet: lexical is all we have
  let q = path.resolve(p), rest = [];
  while (!fs.existsSync(q)) { rest.unshift(path.basename(q)); const up = path.dirname(q); if (up === q) break; q = up; }
  let rq; try { rq = fs.realpathSync(q); } catch { return false; }
  return lex(rr, path.join(rq, ...rest));
}

/** `<root>/looks/<id>`; throws on a bad id or a path that escapes root. */
export function lookDir(root, id) {
  if (!validId(id)) throw new Error(`invalid look id "${id}" (lowercase letters, digits and dashes)`);
  const d = path.join(root, 'looks', id);
  if (!inside(root, d)) throw new Error(`look folder ${d} is outside ${root}`);
  return d;
}

const validRel = (rel) => rel && !path.isAbsolute(rel) && !/^[a-z]:/i.test(rel) && !rel.split('/').some((s) => s === '..' || s === '' || s === '.');

/** Regular files under dir ('/'-separated, sorted by code point); symlinks and OS junk files are skipped. */
export function lookFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (JUNK.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile() && validRel(r)) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Content hash of a look folder: sha256 over "<rel>\n<sha256 of the bytes>\n" per file in sorted order, Library-side
 * files (LIBRARY_SIDE) left out; null if missing. */
export function lookHash(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash('sha256');
  for (const rel of lookFiles(dir)) if (!isLibrarySide(rel)) h.update(`${rel}\n${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex')}\n`);
  return h.digest('hex');
}

/** Replace `dest` (inside `root`) with a copy of the regular files of `src`: staged next to it, then swapped in.
 * `side` picks where the Library-side files (sample/, thumb, preview, analysis) come from: 'src' (everything is
 * copied: seed), 'dest' (src's are never copied, dest's own are kept: use / update into a project), 'dest-or-src' (per
 * entry: dest's kept, src's only where dest has none: save into the Library). */
export function copyLook(src, dest, root, { side = 'src' } = {}) {
  if (!inside(root, dest)) throw new Error(`refusing to write outside ${root}: ${dest}`);
  const parent = path.dirname(dest), base = path.basename(dest);
  fs.mkdirSync(parent, { recursive: true });
  const stage = path.join(parent, `.${base}.staging-${process.pid}`), old = path.join(parent, `.${base}.old-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  const plan = [];
  const destSide = side === 'src' ? new Set() : new Set(lookFiles(dest).filter(isLibrarySide).map((r) => r.split('/')[0]));
  for (const rel of lookFiles(src)) {
    if (side !== 'src' && isLibrarySide(rel) && (side === 'dest' || destSide.has(rel.split('/')[0]))) continue;
    plan.push([src, rel]);
  }
  if (side !== 'src') for (const rel of lookFiles(dest)) if (isLibrarySide(rel) && destSide.has(rel.split('/')[0])) plan.push([dest, rel]);
  for (const [from, rel] of plan) {
    const to = path.join(stage, ...rel.split('/'));
    if (!inside(stage, to)) throw new Error(`invalid path in look: ${rel}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, fs.readFileSync(path.join(from, ...rel.split('/'))));
  }
  fs.mkdirSync(stage, { recursive: true });
  fs.rmSync(old, { recursive: true, force: true });
  let had = false;
  try { fs.lstatSync(dest); had = true; } catch {}
  if (had) fs.renameSync(dest, old);
  try { fs.renameSync(stage, dest); } catch (e) { if (had) fs.renameSync(old, dest); throw e; }
  fs.rmSync(old, { recursive: true, force: true });
  return dest;
}

/** Minimal frontmatter reader: `name`, `description`, `tags` ([a, b] or a, b). */
export function lookMeta(dir) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, 'LOOK.md'), 'utf8'); } catch {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  const tags = meta.tags ? meta.tags.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  return { name: meta.name || null, description: meta.description || null, tags };
}

/** One look's summary for `gfx look list`. */
export function lookInfo(dir, id) {
  const meta = lookMeta(dir);
  let sounds = 0;
  const pal = readJson(path.join(dir, 'sounds.json'), null);
  if (Array.isArray(pal)) sounds = pal.length;
  const file = (f) => { try { return fs.lstatSync(path.join(dir, f)).isFile(); } catch { return false; } };
  return {
    id, pending: !file('LOOK.md'), name: meta.name || id, description: meta.description, tags: meta.tags, preset: fs.existsSync(path.join(dir, 'preset.js')), sounds, refs: lookFiles(path.join(dir, 'refs')).length, hash: lookHash(dir), path: dir,
    // Library-side (docs/LOOK-PIPELINE.md §2): thumbnail file name or null, preview clip, sample scene, measurements
    thumb: file('thumb.jpg') ? 'thumb.jpg' : file('thumb.png') ? 'thumb.png' : null, preview: file('preview.mp4'), sample: file('sample/scene.json'), analysis: file('analysis.json'), brief: file('BRIEF.md'),
  };
}

/** Looks under `<root>/looks/` (valid ids only). */
export function listLooks(root) {
  const d = path.join(root, 'looks');
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch {}
  return ents.filter((e) => e.isDirectory() && validId(e.name)).map((e) => e.name).sort().map((id) => lookInfo(path.join(d, id), id));
}

/** Single-line, marker-free text for the managed CLAUDE.md block. */
const oneLine = (s, max = 80) => String(s).replace(/<!--|-->/g, '').replace(/[\r\n\t`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Managed-block line for the project's look, or null (no look / invalid id / folder missing). */
export function lookLine(dest, cfg) {
  const id = cfg && cfg.look;
  if (!validId(id)) return null;
  const dir = path.join(dest, 'looks', id);
  if (!fs.existsSync(path.join(dir, 'LOOK.md'))) return null;
  const name = oneLine(lookMeta(dir).name || id) || id;
  const preset = lookPresetName(dest, cfg) ? ` Style preset: \`look-${id}\`.` : '';
  return `Look: ${name} (looks/${id}/LOOK.md): read it at the brief, style, build and sound steps; use its sound palette first.${preset}`;
}

/** Default style preset of a project (its look's preset), or null. */
export function lookPresetName(dest, cfg) {
  const id = cfg && cfg.look;
  return validId(id) && fs.existsSync(path.join(dest, 'looks', id, 'preset.js')) && fs.existsSync(path.join(dest, 'style', 'presets', `look-${id}.js`)) ? `look-${id}` : null;
}

/** Write `style/presets/look-<id>.js` from the look's preset.js (if any). -> written path or null. */
export function writeLookPreset(dest, id) {
  const src = path.join(lookDir(dest, id), 'preset.js');
  if (!fs.existsSync(src) || !fs.lstatSync(src).isFile()) return null;
  const out = path.join(dest, 'style', 'presets', `look-${id}.js`);
  if (!inside(dest, out)) throw new Error(`refusing to write outside ${dest}: ${out}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `// Generated by gfx from looks/${id}/preset.js (gfx look use/update rewrites it): edit that file instead.\n` + fs.readFileSync(src, 'utf8'));
  return out;
}
