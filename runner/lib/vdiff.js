// Visual diff preview server (docs/VISUAL-DIFF.md §2): serve one version of the project (a read-only checkout in the OS
// temp folder, or the project folder itself for `now`) with the engine's Vite config, so the studio can load the live
// bridge for each side and seek both. One process per side; it exits on a signal or when nobody asked for anything for
// `idle` seconds, and removes its checkout. Ports 5260-5299 (never the E2E / Live range 5177-5199).
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ENGINE, isEngineProject } from './paths.js';
import * as V from './version.js';

export const PORT_MIN = 5260, PORT_MAX = 5299;
export const vdiffBase = () => path.join(os.tmpdir(), 'gfx-vdiff');
const fail = (msg) => Object.assign(new Error(msg), { code: 'GFX_VERSION' });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** Remove checkouts `<sha12>-<pid>` whose process is gone (a hard kill skips the exit cleanup). -> removed names. */
export function pruneStale(base = vdiffBase()) {
  const gone = [];
  let names = [];
  try { names = fs.readdirSync(base); } catch { return gone; }
  for (const n of names) {
    const m = /^[0-9a-f]{12}-(\d+)$/.exec(n);
    if (!m || (Number(m[1]) !== process.pid && alive(Number(m[1])))) continue;
    try { fs.rmSync(path.join(base, n), { recursive: true, force: true }); gone.push(n); } catch { /* in use (Windows): next time */ }
  }
  return gone;
}

/** Scene folders (with a scene.json) under <dir>/scenes, sorted; `_`-prefixed test fixtures last. */
export function sceneNames(dir) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'scenes')).filter((n) => fs.existsSync(path.join(dir, 'scenes', n, 'scene.json'))); } catch { /* none */ }
  return names.sort((a, b) => (a.startsWith('_') - b.startsWith('_')) || a.localeCompare(b));
}

const tryPort = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

/**
 * Start a preview for `rev` ('now' = the project folder). Resolves { info, server, close } once it listens.
 * info = { type: 'vdiff', rev, sha, short, msg, time, url, port, dir, scenes }.
 */
export async function startPreview(root, { rev = 'now', port = null, idle = 45, base = vdiffBase(), log = () => {} } = {}) {
  const now = rev === 'now';
  let meta = { sha: null, short: 'now', msg: 'Current files', time: null }, dir = root, own = null;
  if (!now) {
    meta = V.revInfo(root, rev);
    pruneStale(base);
    own = path.join(base, `${meta.sha.slice(0, 12)}-${process.pid}`);
    fs.rmSync(own, { recursive: true, force: true });
    try { V.exportTree(root, { sha: meta.sha, dir: own }); } catch (e) { fs.rmSync(own, { recursive: true, force: true }); throw e; }
    dir = own;
  }
  const removeOwn = () => { if (own) { try { fs.rmSync(own, { recursive: true, force: true }); } catch { /* best effort */ } own = null; } };
  const cacheDir = now
    ? (isEngineProject(root) ? path.join(ENGINE, 'node_modules', '.vite-gfx-vdiff') : path.join(root, 'out', '.cache', 'vite-gfx-vdiff'))
    : path.join(dir, 'out', '.cache', 'vite-gfx-vdiff');
  const { createServer } = await import('vite');
  const ports = port ? [Number(port)] : Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i);
  let server = null, last = Date.now(), err = null, onIdle = null;
  const idleDone = new Promise((r) => { onIdle = r; });
  // POST /__gfx/vdiff-stop: the studio's graceful stop (a killed process cannot remove its checkout)
  const stopPlugin = { name: 'gfx-vdiff-stop', configureServer(s) { s.middlewares.use('/__gfx/vdiff-stop', (req, res) => { res.setHeader('access-control-allow-origin', '*'); res.end('{"ok":true}'); if (req.method === 'POST') { log('stop requested'); setTimeout(onIdle, 50); } }); } };
  try {
    for (const p of ports) {
      if (!(await tryPort(p))) continue;
      const s = await createServer({
        root: dir, configFile: path.join(ENGINE, 'vite.config.js'), logLevel: 'warn', cacheDir,
        server: { port: p, strictPort: true, host: '127.0.0.1', ...(now ? {} : { watch: null }) },
        plugins: [stopPlugin],
      });
      try { await s.listen(); server = s; break; }
      catch (e) { err = e; await s.close().catch(() => {}); if (e.code !== 'EADDRINUSE' && !/already in use/i.test(e.message)) throw e; } // lost a race: next port
    }
  } catch (e) { removeOwn(); throw e; }
  if (!server) { removeOwn(); throw fail(port ? `port ${port} is in use` : `no free port in ${PORT_MIN}-${PORT_MAX}${err ? ` (${err.message})` : ''}`); }
  server.httpServer.on('request', () => { last = Date.now(); });
  const addr = server.httpServer.address();
  let timer = null, closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await server.close().catch(() => {});
    removeOwn();
  };
  if (idle > 0) timer = setInterval(() => { if (Date.now() - last > idle * 1000) { log(`idle for ${idle} s: stopping`); onIdle(); } }, Math.min(1000, idle * 250));
  process.on('exit', removeOwn); // last resort (sync)
  const info = { type: 'vdiff', rev: now ? 'now' : meta.sha, ...meta, url: `http://127.0.0.1:${addr.port}`, port: addr.port, dir, scenes: sceneNames(dir) };
  return { info, server, close, idleDone };
}
