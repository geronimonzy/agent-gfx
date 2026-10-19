// Vite plugin: serve a project folder with this engine (docs/FOUNDATION.md §1).
// Vite root = project. When the project is not the engine itself:
// - `/runner/*` is served from the engine, `/style/*` from the project when the file exists there, else the engine
//   (request rewrite to `/@fs/<engine>/...` for browser requests; resolveId for imports inside modules);
// - bare imports (`three`, `animejs`, any engine dependency) that the project cannot resolve resolve from the
//   engine's node_modules;
// - the dep optimizer is off (it resolves `optimizeDeps.include` from the root, which has no node_modules), so deps
//   are served as plain ESM: no late dependency discovery can reload a page mid-capture.
// When root == engine (this repo) the plugin does nothing, so existing scenes stay byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, samePath, urlToFile } from './paths.js';

const posix = (p) => p.split(path.sep).join('/');
const fsUrl = (file) => '/@fs' + (posix(file).startsWith('/') ? '' : '/') + posix(file);
const ENGINE_IMPORTER = path.join(ENGINE, 'runner', 'player', 'player.js');
const isBare = (id) => /^(@[\w.-]+\/)?[\w.-]+(\/.*)?$/.test(id) && !id.startsWith('.');

export function gfxProjectPlugin() {
  let root = null, active = false;
  return {
    name: 'gfx-project',
    enforce: 'pre',
    config(config) {
      root = path.resolve(config.root || process.cwd());
      active = !samePath(root, ENGINE);
      if (!active) return;
      config.optimizeDeps = { ...(config.optimizeDeps || {}), noDiscovery: true, include: [], entries: [] };
      return { server: { fs: { allow: [root, ENGINE] } } };
    },
    configureServer(server) {
      if (!active) return;
      server.middlewares.use((req, _res, next) => {
        const [p, q = ''] = (req.url || '').split(/\?(.*)/s, 2);
        if (p.startsWith('/runner/') || p.startsWith('/style/')) {
          const file = urlToFile(p, root);
          if (inEngine(file)) req.url = fsUrl(file) + (q ? '?' + q : '');
        }
        next();
      });
    },
    resolveId(id, importer, options) {
      return active ? resolveEngine.call(this, root, id, importer, options) : null;
    },
  };
}

const inEngine = (f) => { const r = path.relative(ENGINE, f.split('?')[0]); return !r.startsWith('..') && !path.isAbsolute(r); };

/** resolveId body: `/runner/*` -> engine, `/style/*` -> project then engine, unresolvable bare ids -> engine deps. */
async function resolveEngine(project, id, importer, options) {
  const [p, q] = id.split(/\?(.*)/s, 2);
  if (p.startsWith('/runner/') || p.startsWith('/style/')) {
    const file = urlToFile(p, project);
    return fs.existsSync(file) ? file + (q ? '?' + q : '') : null;
  }
  if (!isBare(id) || (importer && inEngine(importer))) return null;
  const own = await this.resolve(id, importer, { ...options, skipSelf: true });
  if (own) return own;
  return this.resolve(id, ENGINE_IMPORTER, { ...options, skipSelf: true });
}

/** Same resolution for `gfx export` (its build root is a temp folder, so it is always active). */
export function gfxEngineResolvePlugin(project) {
  return { name: 'gfx-engine-resolve', enforce: 'pre', resolveId(id, importer, options) { return resolveEngine.call(this, project, id, importer, options); } };
}
