// Vite plugin: GET /__gfx/ping -> { ok: true, root, engine } so the studio can detect a running `gfx serve`.
// root = the served project (Vite root); engine = the engine folder (both are this repo for the repo's own scenes).
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE } from './paths.js';

const TEXT = /\.(js|css|html|json)$/i;
/** Text files of scenes/<name>/ (recursive, no out/ node_modules/ .git/, <= 1 MB each): [{ path (posix, project-relative), text }]. */
function sceneFiles(root, name) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/^(out|node_modules|\.git|\.gfx)$/.test(e.name)) walk(path.join(dir, e.name)); continue; }
      const f = path.join(dir, e.name);
      if (!TEXT.test(e.name) || fs.statSync(f).size > 1e6) continue;
      out.push({ path: path.relative(root, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') });
    }
  };
  const base = path.join(root, 'scenes', name);
  if (fs.existsSync(base)) walk(base);
  return out;
}

export function gfxPingPlugin() {
  let root = ENGINE;
  return {
    name: 'gfx-ping',
    configResolved(cfg) { root = path.resolve(cfg.root); }, // Vite normalizes to forward slashes; report native
    configureServer(server) {
      server.middlewares.use('/__gfx/ping', (req, res) => {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ ok: true, root, engine: ENGINE }));
      });
      // GET /__gfx/scene-files?scene=<name> -> { files: [{ path, text }] }  (bridge `code`: static refs + snippets)
      server.middlewares.use('/__gfx/scene-files', (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        const name = new URL(req.url, 'http://x').searchParams.get('scene') || '';
        if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) { res.statusCode = 400; return res.end('{"error":"bad scene"}'); }
        try { res.end(JSON.stringify({ files: sceneFiles(root, name) })); }
        catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message || e) })); }
      });
    },
  };
}
