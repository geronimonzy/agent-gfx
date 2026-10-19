// Sound library config + filesystem helpers (Node only).
import fs from 'node:fs';
import path from 'node:path';
import { libraryDir, projectRoot, projectConfig } from '../paths.js';

// Library = per-user folder (docs/FOUNDATION.md §1): GFX_LIBRARY, else <engine>/library if present, else the platform
// data dir. Relative paths (sources.json `path`, cue/index `src`) are relative to ROOT = the library's parent, so
// `library/kenney/...` means the same thing in this repo and in a global library.
export const LIB = libraryDir();
export const ROOT = path.dirname(LIB);
export const SOURCES_FILE = path.join(LIB, 'sources.json');
export const INDEX_DIR = path.join(LIB, 'index');
export const MODELS_DIR = path.join(LIB, '.models');
export const AUDIO_EXT = new Set(['.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.opus']);

/** Global sources + the project's gfx.json `library.sources[]` (marked `project: <dir>`, paths relative to it). */
export function loadSources({ project = true } = {}) {
  const j = fs.existsSync(SOURCES_FILE) ? JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) : { sources: [{ id: 'synth', kind: 'synth', license: 'own', enabled: true }] };
  const sources = j.sources || [];
  if (project) {
    const dir = projectRoot();
    for (const s of projectConfig(dir).library?.sources || []) {
      if (!s || !s.id || sources.some((x) => x.id === s.id)) continue;
      sources.push({ kind: 'folder', enabled: true, license: 'unspecified', ...s, project: dir });
    }
  }
  return { ...j, sources };
}
/** Writes only the global sources (project sources live in gfx.json). */
export function saveSources(cfg) {
  fs.mkdirSync(LIB, { recursive: true });
  // atomic: a reader (the studio) never sees a half-written file
  const tmp = `${SOURCES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...cfg, sources: cfg.sources.filter((s) => !s.project) }, null, 2) + '\n');
  fs.renameSync(tmp, SOURCES_FILE);
}
/** Absolute folder of a `folder` source (path relative to the library parent, or to the project for gfx.json
 * sources, or absolute; "D:/x" is mapped to /mnt/d/x under WSL). */
export function sourceDir(src) {
  let p = src.path;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p || '');
  if (m && process.platform === 'linux' && fs.existsSync('/mnt/' + m[1].toLowerCase())) p = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
  return path.resolve(src.project || ROOT, p);
}
/** Path relative to the library parent with forward slashes when inside it, else the absolute path. */
export function relSrc(abs) {
  const r = path.relative(ROOT, abs);
  return r.startsWith('..') || path.isAbsolute(r) ? abs : r.split(path.sep).join('/');
}
export function walkAudio(dir) {
  const out = [];
  const rec = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()) && !/^preview\./i.test(e.name)) out.push(p); // Kenney "Preview" = a mashup of the pack
    }
  };
  if (fs.existsSync(dir)) rec(dir);
  return out;
}
/** Project indexes (including metadata) belong to the project, even when source ids coincide. */
export function indexFile(source) {
  const src = typeof source === 'string' ? loadSources().sources.find((s) => s.id === source) || { id: source } : source;
  const dir = src.project ? path.join(src.project, '.gfx', 'index') : INDEX_DIR;
  return path.join(dir, `${src.id}.jsonl`);
}
export function readIndex(id) {
  const f = indexFile(id);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** `<id>.meta.json` of a source's index ({ model, version, sfx?, entries? }) or null. */
export function indexMeta(source) {
  const f = indexFile(source).replace(/\.jsonl$/, '.meta.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
/** Number of index entries (lines; no JSON parse). */
export function indexCount(source) {
  try { const s = fs.readFileSync(indexFile(source), 'utf8'); let n = 0; for (const l of s.split('\n')) if (l.trim()) n++; return n; } catch { return 0; }
}
/** Paths the page/dev server may serve: under the library or inside an enabled-or-not registered folder source. */
export function isAllowedAudioPath(abs) {
  const real = (() => { try { return fs.realpathSync(abs); } catch { return null; } })();
  if (!real || !AUDIO_EXT.has(path.extname(real).toLowerCase())) return false;
  const roots = [LIB, ...loadSources().sources.filter((s) => s.kind === 'folder').map(sourceDir)];
  return roots.some((r) => {
    let rr; try { rr = fs.realpathSync(r); } catch { return false; }
    const rel = path.relative(rr, real);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}
/** Resolve a cue `src` (absolute, project-relative, or relative to the library parent) to an absolute path. */
export function resolveSrc(src) {
  if (path.isAbsolute(src)) return path.resolve(src);
  const own = path.resolve(projectRoot(), src);
  return fs.existsSync(own) ? own : path.resolve(ROOT, src);
}
