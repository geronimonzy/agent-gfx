// Download + zip helpers without external binaries (fflate for zip; works the same on Windows and Linux).
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const UA = 'Mozilla/5.0 (gfx-engine)';

/** Stream `url` into `file` (via file.part, renamed when complete). `onProgress(done, total|0)` ~every 256 KB. */
export async function downloadFile(url, file, { onProgress, headers = {} } = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow' });
  if (!r.ok || !r.body) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { status: r.status });
  const total = Number(r.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = file + '.part';
  const fd = fs.openSync(part, 'w');
  let done = 0, last = 0;
  try {
    for await (const chunk of r.body) {
      fs.writeSync(fd, chunk);
      done += chunk.length;
      if (onProgress && done - last >= 1 << 18) { last = done; onProgress(done, total); }
    }
  } finally { fs.closeSync(fd); }
  if (onProgress) onProgress(done, total || done);
  fs.renameSync(part, file);
  return { bytes: done };
}

/**
 * Extract a zip (path or Buffer) into `dest`. `filter(name)` -> false skips an entry, or returns a replacement
 * relative path (string) to rename it. Entries escaping `dest` (zip-slip) are refused. Returns written file paths.
 */
export function extractZip(zip, dest, { filter } = {}) {
  const buf = Buffer.isBuffer(zip) ? zip : fs.readFileSync(zip);
  const keep = (name) => !name.endsWith('/') && (!filter || filter(name) !== false);
  const files = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), { filter: (f) => keep(f.name) });
  const root = path.resolve(dest);
  const out = [];
  for (const [name, data] of Object.entries(files)) {
    const mapped = filter ? filter(name) : true;
    const rel = typeof mapped === 'string' ? mapped : name;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`zip entry escapes the target folder: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    out.push(target);
  }
  return out;
}
