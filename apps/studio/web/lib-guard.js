// Dev-shim twin of the Rust `resolve_lib_in` guard (apps/studio/src-tauri/src/lib.rs): which files the studio may read
// through the `gfxlib://` scheme. Allowed: model/index/audio files in the engine's sound library (`library/...`), the index
// of a project source (`.gfx/index/<id>.jsonl`), and audio files inside the `path` of a registered folder source
// (sources.json: relative to the library's parent or absolute; gfx.json `library.sources[]`: relative to the project or
// absolute). Everything else is rejected.
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT = ['.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.opus'];
export const LIB_EXT = ['.onnx', '.json', '.jsonl', '.txt'];
const MIME = {
  '.onnx': 'application/octet-stream', '.json': 'application/json', '.jsonl': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.m4a': 'audio/mp4',
};
export const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || null;

const isAbs = (p) => p.startsWith('/') || /^[a-zA-Z]:/.test(p);
function key(p) {
  let s = p.replace(/\\/g, '/').toLowerCase();
  const m = s.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (m) s = `${m[1]}:${m[2] || ''}`;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}
const under = (p, dir) => p === dir || p.startsWith(dir + '/');
function native(p) {
  const s = p.replace(/\\/g, '/');
  const m = s.match(/^([a-zA-Z]):(\/.*)?$/);
  return m && process.platform !== 'win32' ? `/mnt/${m[1].toLowerCase()}${m[2] || ''}` : s;
}
const relParts = (p) => String(p).replace(/\\/g, '/').split('/').filter((c) => c && c !== '.');
/** `{ id, path }` of the folder sources in a JSON file (`pick` selects the object holding `sources`). */
function sourcesOf(file, pick = (j) => j) {
  try {
    return (pick(JSON.parse(fs.readFileSync(file, 'utf8')))?.sources || [])
      .filter((s) => s && typeof s.path === 'string')
      .map((s) => ({ id: String(s.id || ''), path: s.path.replace(/\\/g, '/') }));
  } catch { return []; }
}

/**
 * @param root the open project
 * @param req the request path (decoded)
 * @param scope `{ lib }`: the engine's sound library folder (`gfx lib list --json` -> `library`); none = `<root>/library`
 * @returns absolute filesystem path, or throws.
 */
export function resolveLib(root, req, scope = {}) {
  req = String(req).replace(/\\/g, '/');
  if (req.includes('\0') || req.split('/').includes('..')) throw new Error('path escapes');
  const ext = path.extname(req).toLowerCase(), audio = AUDIO_EXT.includes(ext);
  const lib = scope.lib ? path.resolve(scope.lib) : path.join(root, 'library'), base = path.dirname(lib), libName = path.basename(lib).toLowerCase();
  const srcs = sourcesOf(path.join(lib, 'sources.json'));
  const psrcs = sourcesOf(path.join(root, 'gfx.json'), (j) => j?.library);
  if (!isAbs(req)) {
    const parts = relParts(req);
    if (!parts.length) throw new Error('empty path');
    const k = key(parts.join('/'));
    const relUnder = (list) => list.some((s) => !isAbs(s.path) && !s.path.split('/').includes('..') && under(k, key(relParts(s.path).join('/'))));
    // Registered project audio takes precedence over the global library alias.
    if (audio && relUnder(psrcs)) return path.join(root, ...parts);
    const first = parts[0].toLowerCase();
    if (first === 'library' || first === libName) {
      if (parts.length < 2) throw new Error(`not a file: ${req}`);
      if (LIB_EXT.includes(ext) || audio) return path.join(lib, ...parts.slice(1));
      throw new Error(`file type not served: ${req}`);
    }
    if (parts.length === 3 && parts[0] === '.gfx' && parts[1] === 'index') {
      const id = parts[2].replace(/\.jsonl$|\.meta\.json$/, '');
      if (id && id !== parts[2] && psrcs.some((s) => s.id === id)) return path.join(root, ...parts);
      throw new Error(`not a project source index: ${req}`);
    }
    if (!audio) throw new Error(`not in library: ${req}`);
    if (relUnder(srcs)) return path.join(base, ...parts);
    throw new Error(`not in library: ${req}`);
  }
  if (!audio) throw new Error(`not in a registered source: ${req}`);
  const k = key(req), r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const dirs = [...srcs.filter((s) => isAbs(s.path)).map((s) => s.path), ...psrcs.map((s) => (isAbs(s.path) ? s.path : `${r}/${s.path}`))];
  for (const d of dirs) if (!d.split('/').includes('..') && under(k, key(d))) return native(req);
  throw new Error(`not in a registered source: ${req}`);
}
