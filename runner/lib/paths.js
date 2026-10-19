// Engine vs project resolution (docs/FOUNDATION.md §1). Node only, no dependencies.
// Engine = this checkout (runner/, style/, templates/, node_modules). Project = a folder with gfx.json
// (scenes/, style/presets, out/). This repo is both: its gfx.json makes the project == the engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_FILE = 'gfx.json';

/** Parsed JSON file, or `dflt` when missing/invalid. */
export const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } };
export const engineVersion = () => readJson(path.join(ENGINE, 'package.json'), {}).version || '0.0.0';

/** Nearest folder at or above `start` that contains gfx.json, else null. */
export function findProject(start = process.cwd()) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, PROJECT_FILE))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/**
 * The project folder: `--project` (the CLI stores it in GFX_PROJECT before running a command), else GFX_PROJECT,
 * else the nearest gfx.json above cwd, else the engine root (back-compat). Resolved on every call (cheap) so tests
 * and the Vite config see env changes.
 */
export function projectRoot() {
  if (process.env.GFX_PROJECT) return path.resolve(process.env.GFX_PROJECT);
  return findProject() || ENGINE;
}
export const isEngineProject = (p = projectRoot()) => samePath(p, ENGINE);
export const projectConfig = (p = projectRoot()) => readJson(path.join(p, PROJECT_FILE), {});

export function samePath(a, b) {
  const n = (x) => { let r = path.resolve(x); try { r = fs.realpathSync(r); } catch {} return process.platform === 'win32' ? r.toLowerCase() : r; };
  return n(a) === n(b);
}

/** Style preset file: project `style/presets/<name>.js` wins over the engine's. */
export function presetFile(name, p = projectRoot()) {
  const rel = path.join('style', 'presets', `${name}.js`);
  const own = path.join(p, rel);
  return fs.existsSync(own) ? own : path.join(ENGINE, rel);
}

/** Map a root-absolute URL path (`/style/...`, `/runner/...`) to the file that serves it (project first for style/). */
export function urlToFile(urlPath, p = projectRoot()) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (rel.startsWith('runner/')) return path.join(ENGINE, rel);
  if (rel.startsWith('style/')) { const own = path.join(p, rel); return fs.existsSync(own) ? own : path.join(ENGINE, rel); }
  return path.join(p, rel);
}

/**
 * Per-user sound library: GFX_LIBRARY, else `<engine>/library` when it exists (back-compat for this repo),
 * else %APPDATA%/gfx/library (Windows), ~/Library/Application Support/gfx/library (mac), $XDG_DATA_HOME or
 * ~/.local/share/gfx/library (Linux).
 */
export function libraryDir() {
  if (process.env.GFX_LIBRARY) return path.resolve(process.env.GFX_LIBRARY);
  const legacy = path.join(ENGINE, 'library');
  if (fs.existsSync(legacy)) return legacy;
  return path.join(userDataDir(), 'library');
}
/** Per-user gfx data folder (parent of the default library and bin/). */
export function userDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'gfx');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'gfx');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'gfx');
}
/** Base for relative library paths (`library/kenney/...` in sources.json and cue `src`): the library's parent. */
export const libraryBase = () => path.dirname(libraryDir());
/** Where `gfx setup ffmpeg` puts binaries: `<library-parent>/bin`. */
export const binDir = () => path.join(libraryBase(), 'bin');

/** First match of `name` on PATH (adds PATHEXT on Windows), else null. No shell. */
export function which(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const f = path.join(dir.replace(/^"|"$/g, ''), name + (path.extname(name) ? '' : ext));
      try { if (fs.statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}
