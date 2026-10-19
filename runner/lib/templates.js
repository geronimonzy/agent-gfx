// Project templates (docs/TEMPLATES.md): built-in (<engine>/templates/projects) + the user templates in the Library
// folder (`<library>/templates/`, beside `looks/`; GFX_TEMPLATES overrides). One folder format for both: template.json +
// thumb.jpg + preview.mp4 + the project files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE, readJson, userDataDir } from './paths.js';

export const BUILTIN_DIR = path.join(ENGINE, 'templates', 'projects');

/** This environment's Documents folder: Windows %USERPROFILE%\Documents, Linux/WSL XDG_DOCUMENTS_DIR (user-dirs.dirs)
 *  else ~/Documents, mac ~/Documents. */
export function documentsDir() {
  const d = documentsPath(), home = os.homedir();
  // a Documents entry that can't be a folder (a symlink loop, a file): use the home folder instead of failing every save
  try { if (!fs.statSync(d).isDirectory()) return home; } catch (e) { if (e.code !== 'ENOENT') return home; }
  return d;
}
function documentsPath() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.USERPROFILE || home, 'Documents');
  if (process.platform === 'linux') {
    try {
      const m = /^XDG_DOCUMENTS_DIR="?([^"\n]+)"?/m.exec(fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs'), 'utf8'));
      const d = m && m[1].replace(/^\$HOME/, home);
      if (d && path.isAbsolute(d) && path.resolve(d) !== path.resolve(home)) return d;
    } catch { /* no user-dirs.dirs */ }
  }
  return path.join(home, 'Documents');
}
/** The Library folder's default (docs/LOOKS.md §3, same as gfx studio's `libraryDir` default). */
export const defaultLibraryDir = () => path.join(documentsDir(), 'gfx library');

let libraryOverride = null;
/** `--library <dir>` (gfx studio passes its Library folder setting when it is in the engine's environment). */
export const setTemplateLibrary = (dir) => { libraryOverride = dir ? path.resolve(dir) : null; };
/** The user template library: GFX_TEMPLATES, else `<library>/templates` (created on first save). */
export const userTemplatesDir = () => path.resolve(process.env.GFX_TEMPLATES || path.join(libraryOverride || defaultLibraryDir(), 'templates'));
/** The first build's default (`<user data>/templates`): still listed, read-only, when it exists and holds templates. */
export const legacyTemplatesDir = () => path.join(userDataDir(), 'templates');
const legacyDir = () => {
  if (process.env.GFX_TEMPLATES) return null;
  const d = legacyTemplatesDir();
  return path.resolve(d) !== userTemplatesDir() && isDir(d) ? d : null;
};

/** Template-root names that describe the template and never land in a project. */
export const META_FILES = ['template.json', 'thumb.jpg', 'thumb.png', 'preview.mp4', 'preview.webm'];
/** Root names init writes or owns: never taken from a template, never saved into one. */
export const OWNED = ['gfx.json', 'CLAUDE.md', 'AGENTS.md', '.gfx', '.claude', '.git', 'out', 'node_modules', '.gitignore'];
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const slugId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const listDirs = (d) => (isDir(d) ? fs.readdirSync(d).filter((n) => !n.startsWith('_') && !n.startsWith('.') && !n.endsWith('.tmp') && isDir(path.join(d, n))).sort() : []);

/** Scenes of a template / project folder (folders under scenes/ with a scene.json), sorted. */
export function scenesIn(dir) {
  const s = path.join(dir, 'scenes');
  return listDirs(s).filter((n) => fs.existsSync(path.join(s, n, 'scene.json')));
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function aspectOf(w, h) {
  if (!(w > 0 && h > 0)) return null;
  const g = gcd(w, h), a = `${w / g}:${h / g}`;
  return { '16:9': 1, '9:16': 1, '1:1': 1, '4:5': 1, '4:3': 1, '21:9': 1 }[a] ? a : (w / h).toFixed(2);
}

/** Metadata of one template folder (no thumbnail bytes). */
export function describe(dir, source) {
  const id = path.basename(dir);
  const meta = readJson(path.join(dir, 'template.json'), {}) || {};
  const scenes = scenesIn(dir);
  const pv = meta.preview?.scene && scenes.includes(meta.preview.scene) ? meta.preview.scene : scenes[0];
  const sj = pv ? readJson(path.join(dir, 'scenes', pv, 'scene.json'), {}) : {};
  const thumb = ['thumb.jpg', 'thumb.png'].find((f) => fs.existsSync(path.join(dir, f))) || null;
  return {
    ref: source === 'user' ? `user/${id}` : id, id, source, dir,
    title: String(meta.title || id[0].toUpperCase() + id.slice(1)),
    description: String(meta.description || (scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}: ${scenes.join(', ')}` : 'An empty project.')),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    scenes, previewScene: pv || null,
    width: sj.width || null, height: sj.height || null, aspect: aspectOf(sj.width, sj.height), duration: sj.duration ?? null, kind: sj.kind || null,
    thumbFile: thumb ? path.join(dir, thumb) : null,
    preview: fs.existsSync(path.join(dir, 'preview.mp4')),
    created: meta.created || null, gfx: meta.gfx && typeof meta.gfx === 'object' ? meta.gfx : null, engine: meta.engine || null,
  };
}

/** Every template: built-ins first (blank, then by title), then the user's (newest first). */
export function listTemplates() {
  const b = listDirs(BUILTIN_DIR).map((n) => describe(path.join(BUILTIN_DIR, n), 'builtin'));
  b.sort((x, y) => (x.id === 'blank' ? -1 : y.id === 'blank' ? 1 : BUILTIN_ORDER(x.id) - BUILTIN_ORDER(y.id) || x.title.localeCompare(y.title)));
  const u = listDirs(userTemplatesDir()).filter((n) => ID_RE.test(n)).map((n) => describe(path.join(userTemplatesDir(), n), 'user'));
  const old = legacyDir();
  if (old) for (const n of listDirs(old)) if (ID_RE.test(n) && !u.some((t) => t.id === n)) u.push({ ...describe(path.join(old, n), 'user'), legacy: true });
  u.sort((x, y) => String(y.created || '').localeCompare(String(x.created || '')) || x.id.localeCompare(y.id));
  return [...b, ...u];
}
const ORDER = ['blank', 'promo', 'reel', 'square', 'explainer', 'sting'];
const BUILTIN_ORDER = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

/**
 * Resolve a template ref: `user/<id>`, a folder path, or a bare id (built-in first, then user). -> describe() or null.
 */
export function resolveTemplate(ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  if (r.startsWith('user/')) {
    const id = r.slice(5);
    return ID_RE.test(id) ? userTemplate(id) : null;
  }
  if (/[\\/]/.test(r)) {
    const d = path.resolve(r);
    return isDir(d) && (fs.existsSync(path.join(d, 'template.json')) || isDir(path.join(d, 'scenes'))) ? describe(d, 'folder') : null;
  }
  if (!/^[\w.-]+$/.test(r) || r.startsWith('_')) return null;
  if (isDir(path.join(BUILTIN_DIR, r))) return describe(path.join(BUILTIN_DIR, r), 'builtin');
  return ID_RE.test(r) ? userTemplate(r) : null;
}
/** A user template by id: the library first, then the old <user data>/templates (read-only, `legacy`). */
function userTemplate(id) {
  const d = path.join(userTemplatesDir(), id);
  if (isDir(d)) return describe(d, 'user');
  const old = legacyDir();
  return old && isDir(path.join(old, id)) ? { ...describe(path.join(old, id), 'user'), legacy: true } : null;
}

/** Copy a template's project files into `dest` (meta files and owned names skipped). `force=false` keeps existing files. */
export function copyTemplateFiles(dir, dest, { force = true } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const n of fs.readdirSync(dir)) {
    if (META_FILES.includes(n) || OWNED.includes(n)) continue;
    fs.cpSync(path.join(dir, n), path.join(dest, n), { recursive: true, force, errorOnExist: false });
  }
}

/** Thumbnail as a data: URL (null when the template has none or it is unreasonably big). */
export function thumbDataUrl(t) {
  if (!t.thumbFile) return null;
  const b = fs.readFileSync(t.thumbFile);
  if (b.length > 512 * 1024) return null;
  return `data:image/${t.thumbFile.endsWith('.png') ? 'png' : 'jpeg'};base64,${b.toString('base64')}`;
}

/** Safe keys of a project's gfx.json that a template carries into new projects. */
export function gfxKeys(cfg) {
  const out = {};
  if (typeof cfg?.look === 'string' && /^[\w.-]+$/.test(cfg.look)) out.look = cfg.look;
  if (cfg?.settings && typeof cfg.settings === 'object' && !Array.isArray(cfg.settings)) out.settings = cfg.settings;
  return Object.keys(out).length ? out : null;
}
