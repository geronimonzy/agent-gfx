// Vite plugin for live code reload (docs/FOUNDATION.md §5).
// - watches scenes/, style/ and engine runner/ via server.watcher; bursts are debounced (100 ms) into ONE custom HMR
//   event `gfx:changed` { files: [posix path relative to the Vite root, or absolute when outside it], v }.
// - swallows Vite's own HMR/full-reload for those files (the bridge rebuilds the scene in place; the dev player reloads).
// - cache-busting: `v` is bumped per event; pages import `scene.js?v=<v>` and this plugin rewrites the local imports of
//   scenes/, style/ and runner/lib modules to carry the same `?v=<v>`, so edited helper modules (markup.js...) are re-fetched.
import path from 'node:path';

const DEBOUNCE_MS = 100;
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])((?:\.{1,2}\/|\/(?:runner|style|scenes)\/)[^'"?]*\.(?:m?js|json))\2/g;

export function gfxReloadPlugin({ dirs } = {}) {
  let v = 0;
  let root = process.cwd();
  let watched = (dirs || ['scenes', 'style', 'runner/lib', 'runner/player']).map((d) => path.resolve(root, d));
  const inside = (file) => watched.some((d) => file === d || file.startsWith(d + path.sep));
  const skip = (file) => /[\\/](out|library|node_modules|\.git)[\\/]/.test(file);
  const shown = (file) => {
    const rel = path.relative(root, file);
    return (rel.startsWith('..') || path.isAbsolute(rel) ? file : rel).split(path.sep).join('/');
  };
  return {
    name: 'gfx-reload',
    enforce: 'pre',
    // A syntax error in a scene must not pop Vite's overlay over the bridge; the bridge reports it as {type:'error'}.
    config() { return { server: { hmr: { overlay: false } } }; },
    configResolved(cfg) {
      root = cfg.root;
      watched = (dirs || ['scenes', 'style', 'runner/lib', 'runner/player']).map((d) => path.resolve(root, d));
    },
    configureServer(server) {
      const outside = watched.filter((d) => path.relative(root, d).startsWith('..'));
      if (outside.length) server.watcher.add(outside);
      let pending = new Set();
      let timer = null;
      const flush = () => {
        timer = null;
        const files = [...pending]; pending = new Set();
        if (!files.length) return;
        v++;
        server.ws.send({ type: 'custom', event: 'gfx:changed', data: { files, v } });
      };
      const onFile = (file) => {
        file = path.resolve(file);
        if (!inside(file) || skip(file)) return;
        pending.add(shown(file));
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, DEBOUNCE_MS);
      };
      for (const ev of ['change', 'add', 'unlink']) server.watcher.on(ev, onFile);
    },
    handleHotUpdate({ file }) {
      if (inside(path.resolve(file))) return []; // no Vite HMR / full reload: our own message handles it
    },
    transform(code, id) {
      if (!v) return null;
      const f = id.split('?')[0];
      if (!/\.m?js$/.test(f) || !inside(path.resolve(f)) || /[\\/]runner[\\/]player[\\/]/.test(f)) return null;
      const out = code.replace(IMPORT_RE, (_, pre, q, spec) => `${pre}${q}${spec}?v=${v}${q}`);
      return out === code ? null : { code: out, map: null };
    },
  };
}
