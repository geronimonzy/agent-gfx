// Code workspace write scope (docs/CODE-VERSIONS.md §3). Twin of check_source_writable in src-tauri/src/lib.rs; used by the
// dev shim (vite.config.js) and by the file tree (read-only marks).
export const SKIP_DIRS = ['.git', '.gfx', 'node_modules', 'out'];

/** Clean components of a project-relative path; throws on absolute / drive / `..` / empty / NUL (normalize_rel). */
export function relParts(rel) {
  const s = String(rel ?? '');
  if (s.includes('\0')) throw new Error('invalid path');
  const f = s.replace(/\\/g, '/');
  if (f.startsWith('/') || f.includes(':')) throw new Error(`absolute path not allowed: ${rel}`);
  const parts = [];
  for (const p of f.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') throw new Error(`path escapes root: ${rel}`);
    parts.push(p);
  }
  if (!parts.length) throw new Error('empty path');
  return parts;
}

/** `scenes/**`, `style/**`, `*.md` at the project root, `gfx.json`; never inside .git/ .gfx/ node_modules/ out/. Throws. */
export function checkSourceWritable(rel) {
  const parts = relParts(rel);
  const bad = () => new Error(`write not allowed (only scenes/**, style/**, *.md at the root, gfx.json): ${rel}`);
  if (parts.some((p) => SKIP_DIRS.includes(p))) throw bad();
  const ok = parts.length === 1
    ? parts[0] === 'gfx.json' || (parts[0].toLowerCase().endsWith('.md') && parts[0].length > 3)
    : parts[0] === 'scenes' || parts[0] === 'style';
  if (!ok) throw bad();
  return parts.join('/');
}
export const isSourceWritable = (rel) => { try { checkSourceWritable(rel); return true; } catch { return false; } };

/** Reject a stale editor snapshot before touching the file (dev twin of write_source_file). */
export function checkSourceVersion(mtime, text, expectMtime, expectText) {
  if (mtime !== expectMtime || (expectText !== undefined && text !== expectText)) {
    throw Object.assign(new Error('Changed on disk'), { code: 'conflict', mtime, text });
  }
}
